import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceImportEntry } from './sf2';

const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, any>>(),
  role: 'Teacher', uid: 'staff' as string | null,
  beforeTransaction: vi.fn(), refresh: vi.fn(), audit: vi.fn(),
  writes: [] as { path: string; data: Record<string, any> }[],
}));
vi.mock('../app-config', () => ({
  APP_CONFIG: { schoolId: 'sample-school' },
  isSchoolAdmin: () => ['Developer', 'School Admin'].includes(state.role),
  isRegistrar: () => state.role === 'Registrar', isTeacher: () => state.role === 'Teacher',
  teacherAssignmentsForProfile: () => [{ schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'A' }],
}));
vi.mock('../firestore-api', () => ({
  fsAudit_: state.audit, fsInvalidateReadCaches_: state.refresh,
  fsIsActiveLearner_: (learner: Record<string, unknown>) => !learner.transferOut && !['DROPPED_OUT', 'TRANSFERRED_OUT'].includes(String(learner.enrollmentStatus)),
}));
vi.mock('../firebase', () => {
  const snapshot = (path: string) => ({ exists: state.documents.has(path), data: () => state.documents.get(path) });
  function collection(path: string, filters: [string, unknown][] = []): any {
    return {
      doc: (id: string) => ({ path: `${path}/${id}`, collection: (name: string) => collection(`${path}/${id}/${name}`), get: async () => snapshot(`${path}/${id}`) }),
      where: (field: string, _operation: string, value: unknown) => collection(path, [...filters, [field, value]]),
      get: async () => ({ docs: [...state.documents.entries()].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1 && filters.every(([field, expected]) => value[field] === expected)).map(([key]) => ({ id: key.split('/').at(-1), ...snapshot(key) })) }),
    };
  }
  return { auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } }, db: {
    collection,
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => {
      await state.beforeTransaction();
      const pending: typeof state.writes = [];
      const result = await callback({
        get: async (reference: { path: string }) => { if (pending.length) throw new Error('Read after write'); return snapshot(reference.path); },
        update: (reference: { path: string }, data: Record<string, any>) => pending.push({ path: reference.path, data }),
      });
      for (const write of pending) state.documents.set(write.path, { ...state.documents.get(write.path), ...write.data });
      state.writes.push(...pending);
      return result;
    },
  } };
});
import { attendanceImportSections, importSf2Attendance, loadAttendanceImportTargets } from './store';

const year = '2026-2027', placement = { gradeLevel: 'Grade 2', section: 'A' };
const learnerId = '123456789012', learnerPath = `schoolYears/${year}/learners/${learnerId}`;
const learner = { learnerId, schoolYear: year, ...placement, firstName: 'Sample', lastName: 'Learner', teacherComments: ['Preserve'], math: '90', attendance: { daysPresent: { Jun: '19' }, daysAbsent: { Jun: '1' }, classDays: { Jun: '20' } } };
async function entry(): Promise<AttendanceImportEntry> {
  const target = (await loadAttendanceImportTargets(year, placement))[0];
  return { learnerId, name: 'Learner, Sample', sourceName: 'Learner, Sample', rowNumber: 13, daysPresent: '20', daysAbsent: '2', classDays: '22', expectedAttendance: structuredClone(target.attendance), expectedIdentity: target.expectedIdentity };
}
const save = (entries: AttendanceImportEntry[], overwriteExisting = false, month = 'Jul') => importSf2Attendance({ schoolYear: year, placement, month, entries, overwriteExisting });

beforeEach(() => {
  vi.clearAllMocks(); state.documents.clear(); state.writes.length = 0; state.uid = 'staff'; state.role = 'Teacher'; state.beforeTransaction.mockReset();
  state.documents.set('users/staff', { role: 'Teacher', status: 'Active', teacherAssignmentSecurityKeys: [`${year}::Grade 2::A`] });
  state.documents.set('settings/toggles', { canTeacherImportAttendance: true });
  state.documents.set(`schoolYears/${year}/grades/grade-2/sections/a`, placement);
  state.documents.set(learnerPath, structuredClone(learner));
});

describe('SF2 attendance persistence and access', () => {
  it('updates one month atomically, preserves other learner data and reads before writing', async () => {
    expect(await save([await entry()])).toEqual({ updated: 1, unchanged: 0 });
    expect(state.documents.get(learnerPath)).toMatchObject({
      math: '90', teacherComments: ['Preserve'], attendance: { daysPresent: { Jun: '19', Jul: '20' }, daysAbsent: { Jun: '1', Jul: '2' }, classDays: { Jun: '20', Jul: '22' } },
      __attendanceImportId: expect.any(String),
    });
    expect(state.refresh).toHaveBeenCalledWith(year);
    expect(state.audit.mock.calls[0][1].newValue).not.toContain('Sample');
    expect(await save([await entry()])).toEqual({ updated: 0, unchanged: 1 });
    expect(state.writes).toHaveLength(1);
  });

  it.each(['Developer', 'School Admin', 'Registrar'])('permits active %s without a teacher toggle', async role => {
    state.documents.set('users/staff', { role, status: 'Active' }); state.documents.delete('settings/toggles');
    expect(await save([await entry()])).toEqual({ updated: 1, unchanged: 0 });
  });

  it('fails closed for inactive, signed-out, disallowed or unassigned accounts', async () => {
    state.uid = null;
    await expect(loadAttendanceImportTargets(year, placement)).rejects.toThrow('Sign in');
    state.uid = 'staff'; state.documents.set('users/staff', { role: 'Teacher', status: 'Inactive' });
    await expect(loadAttendanceImportTargets(year, placement)).rejects.toThrow('active account');
    state.documents.set('users/staff', { role: 'Visitor', status: 'Active' });
    await expect(loadAttendanceImportTargets(year, placement)).rejects.toThrow('role');
    state.documents.set('users/staff', { role: 'Teacher', status: 'Active', teacherAssignmentSecurityKeys: [] });
    await expect(loadAttendanceImportTargets(year, placement)).rejects.toThrow('assigned');
  });

  it('rechecks revocation and the section inside the saving transaction', async () => {
    const row = await entry();
    state.beforeTransaction.mockImplementation(() => state.documents.set('settings/toggles', { canTeacherImportAttendance: false }));
    await expect(save([row])).rejects.toThrow('disabled for teachers');
    expect(state.writes).toHaveLength(0);
    state.documents.set('settings/toggles', { canTeacherImportAttendance: true });
    state.beforeTransaction.mockImplementation(() => state.documents.delete(`schoolYears/${year}/grades/grade-2/sections/a`));
    await expect(save([row])).rejects.toThrow('no longer configured');
  });

  it('requires reviewed replacement and detects selected-month concurrent edits', async () => {
    await save([await entry()]);
    const replacement = { ...await entry(), daysAbsent: '1', classDays: '21' };
    await expect(save([replacement])).rejects.toThrow('allow replacement');
    expect(await save([replacement], true)).toEqual({ updated: 1, unchanged: 0 });
    const stale = await entry();
    state.documents.get(learnerPath)!.attendance.daysPresent.Jul = '18';
    await expect(save([stale], true)).rejects.toThrow('changed after review');
  });

  it('rejects stale identities, placement changes and invalid totals before writes', async () => {
    const row = await entry();
    await expect(save([{ ...row, classDays: '99' }])).rejects.toThrow('Total Classes');
    await expect(save([row, row])).rejects.toThrow('unique learner');
    state.documents.get(learnerPath)!.lastName = 'Changed';
    await expect(save([row])).rejects.toThrow('name or placement changed');
    state.documents.get(learnerPath)!.section = 'B';
    await expect(save([row])).rejects.toThrow('no longer in the selected section');
    expect(state.writes).toHaveLength(0);
  });

  it('maps month labels to Card Preferences and preserves an unrelated concurrent month', async () => {
    state.documents.set('settings/cardPrintingPreferences', { attendanceMonths: ['June', 'July'] });
    const row = await entry();
    state.documents.get(learnerPath)!.attendance.daysPresent.Jun = '18';
    await save([row]);
    expect(state.documents.get(learnerPath)!.attendance.daysPresent).toEqual({ Jun: '18', July: '20' });
    state.documents.set('settings/cardPrintingPreferences', { attendanceMonths: ['Jul', 'July'] });
    await expect(save([await entry()], true)).rejects.toThrow('more than one label');
  });

  it('treats equal decimal counts and alias synchronization as idempotent without requiring replacement', async () => {
    state.documents.get(learnerPath)!.attendance = { daysPresent: { July: '20.0' }, daysAbsent: { July: '2.00' }, classDays: { July: '22' } };
    expect(await save([await entry()])).toEqual({ updated: 1, unchanged: 0 });
    expect(state.documents.get(learnerPath)!.attendance.daysPresent).toEqual({ July: '20', Jul: '20' });
    expect(await save([await entry()])).toEqual({ updated: 0, unchanged: 1 });
  });

  it('shows all configured sections to registrars and only assigned sections to teachers', () => {
    const sections = [placement, { gradeLevel: 'Grade 3', section: 'B' }];
    expect(attendanceImportSections(year, sections)).toEqual([placement]);
    expect(attendanceImportSections('2025-2026', sections)).toEqual([]);
    state.role = 'Registrar'; expect(attendanceImportSections(year, sections)).toEqual(sections);
    state.role = 'Visitor'; expect(attendanceImportSections(year, sections)).toEqual([]);
  });
});
