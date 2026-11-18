import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectStudentTargets, uploadStudents } from './upload';

const mocks = vi.hoisted(() => ({
  documents: new Map<string, Record<string, unknown>>(),
  reads: [] as string[], writes: [] as { path: string; data: Record<string, unknown> }[],
  uid: 'teacher' as string | null, beforeTransaction: vi.fn(), refresh: vi.fn(),
  role: 'Teacher', assignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 6', section: 'POMELO' }],
}));
vi.mock('../app-config', () => ({
  APP_CONFIG: { schoolId: 'school-a' }, isSchoolAdmin: () => ['Developer', 'School Admin'].includes(mocks.role),
  isTeacher: () => mocks.role === 'Teacher', teacherAssignmentsForProfile: () => mocks.assignments,
}));
vi.mock('../firestore-api', () => ({ fsAudit_: vi.fn(), fsInvalidateReadCaches_: mocks.refresh, fsSchedulePublicStatsRefresh_: vi.fn() }));
vi.mock('../firebase', () => {
  function snapshot(path: string) {
    mocks.reads.push(path);
    return { exists: mocks.documents.has(path), data: () => mocks.documents.get(path) };
  }
  function collection(path: string) {
    return { doc: (id: string) => ({ path: `${path}/${id}`, collection: (name: string) => collection(`${path}/${id}/${name}`), get: async () => snapshot(`${path}/${id}`) }) };
  }
  return {
    auth: { get currentUser() { return mocks.uid ? { uid: mocks.uid } : null; } },
    db: {
      collection,
      runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
        await mocks.beforeTransaction();
        const writes: { path: string; data: Record<string, unknown>; merge: boolean }[] = [];
        const result = await callback({
          get: async (reference: { path: string }) => {
            if (writes.length) throw new Error('Read after write');
            return snapshot(reference.path);
          },
          set: (reference: { path: string }, data: Record<string, unknown>, options: { merge: boolean }) => writes.push({ path: reference.path, data, merge: options.merge }),
        });
        for (const write of writes) {
          mocks.writes.push(write);
          mocks.documents.set(write.path, { ...(write.merge ? mocks.documents.get(write.path) : {}), ...write.data });
        }
        return result;
      },
    },
  };
});

import { studentImportStore } from './firestore-store';
import { studentImportSections } from './access';
const year = '2026-2027';
const record = { learnerId: '123456789012', firstName: 'Juan', lastName: 'Cruz', schoolYear: year, gradeLevel: 'Grade 6', section: 'POMELO' };
const learnerPath = `schoolYears/${year}/learners/${record.learnerId}`;

describe('server-authorized student import store', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.documents.clear(); mocks.reads.length = 0; mocks.writes.length = 0; mocks.uid = 'teacher'; mocks.role = 'Teacher';
    mocks.beforeTransaction.mockReset();
    mocks.documents.set('users/teacher', { role: 'Teacher', status: 'Active', teacherAssignmentSecurityKeys: [`${year}::Grade 6::POMELO`] });
    mocks.documents.set('settings/toggles', { canTeacherImport: true });
    mocks.documents.set(`schoolYears/${year}/grades/grade-6/sections/pomelo`, { gradeLevel: 'Grade 6', section: 'POMELO' });
  });

  it.each([undefined, false, 'true'])('denies Teacher import when canTeacherImport is %s', async value => {
    mocks.documents.set('settings/toggles', value === undefined ? {} : { canTeacherImport: value });
    await expect(uploadStudents(studentImportStore, year, [record], 'skip')).rejects.toThrow('disabled for teachers');
    expect(mocks.writes).toHaveLength(0);
  });

  it.each(['Registrar', 'Visitor'])('denies the %s role even with the Teacher toggle enabled', async role => {
    mocks.documents.set('users/teacher', { role, status: 'Active' });
    await expect(studentImportStore.authorize(year, [record])).rejects.toThrow('role does not have access');
  });

  it('denies signed-out/inactive users and accepts active admins without the Teacher toggle', async () => {
    mocks.uid = null;
    await expect(studentImportStore.authorize()).rejects.toThrow('Sign in');
    mocks.uid = 'teacher';
    mocks.documents.set('users/teacher', { role: 'Teacher', status: 'Inactive' });
    await expect(studentImportStore.authorize()).rejects.toThrow('active account');
    mocks.documents.set('users/teacher', { role: 'School Admin', status: 'Active' });
    mocks.documents.delete('settings/toggles');
    await expect(studentImportStore.authorize(year, [record])).resolves.toMatchObject({ maxBatchSize: 25 });
  });

  it('uses server assignments and limits Teacher transactions to five students', async () => {
    await expect(studentImportStore.authorize(year, [record])).resolves.toMatchObject({ maxBatchSize: 5 });
    await expect(studentImportStore.authorize(year, [{ ...record, section: 'OTHER' }])).rejects.toThrow('assigned');
    await expect(studentImportStore.authorize('2025-2026', [{ ...record, schoolYear: '2025-2026' }])).rejects.toThrow('assigned');
  });

  it('blocks an outside-assignment duplicate before review, including skip mode', async () => {
    mocks.documents.set(learnerPath, { ...record, section: 'OTHER' });
    await expect(inspectStudentTargets(studentImportStore, year, [record])).rejects.toThrow('outside your assignments');
    await expect(uploadStudents(studentImportStore, year, [record], 'skip')).rejects.toThrow('outside your assignments');
    expect(mocks.writes).toHaveLength(0);
  });

  it('rechecks role/toggle and configured sections inside each transaction', async () => {
    mocks.beforeTransaction.mockImplementationOnce(() => mocks.documents.set('settings/toggles', { canTeacherImport: false }));
    await expect(uploadStudents(studentImportStore, year, [record], 'skip')).rejects.toThrow('disabled for teachers');
    expect(mocks.writes).toHaveLength(0);
    mocks.documents.set('settings/toggles', { canTeacherImport: true });
    mocks.beforeTransaction.mockImplementationOnce(() => mocks.documents.delete(`schoolYears/${year}/grades/grade-6/sections/pomelo`));
    await expect(uploadStudents(studentImportStore, year, [record], 'skip')).rejects.toThrow('no longer configured');
    expect(mocks.writes).toHaveLength(0);
  });

  it('stops safely when assignments change after review or a duplicate appears outside scope', async () => {
    await inspectStudentTargets(studentImportStore, year, [record]);
    mocks.beforeTransaction.mockImplementationOnce(() => mocks.documents.set('users/teacher', { role: 'Teacher', status: 'Active', teacherAssignmentSecurityKeys: [] }));
    await expect(uploadStudents(studentImportStore, year, [record], 'merge')).rejects.toThrow('assigned');
    expect(mocks.writes).toHaveLength(0);
  });

  it('stops later batches after Teacher access is revoked and reports already committed rows', async () => {
    mocks.beforeTransaction.mockImplementationOnce(() => {}).mockImplementationOnce(() => mocks.documents.set('settings/toggles', { canTeacherImport: false }));
    const students = Array.from({ length: 6 }, (_, index) => ({ ...record, learnerId: String(Number(record.learnerId) + index) }));
    const error = await uploadStudents(studentImportStore, year, students, 'skip').catch(error => error);
    expect(error.message).toContain('disabled for teachers');
    expect(error.progress).toMatchObject({ created: 5, processed: 5 });
    expect(mocks.writes).toHaveLength(5);
    expect(mocks.refresh).toHaveBeenCalledWith(year);
  });

  it('marks successful imports, preserves known fields, and reads before all writes', async () => {
    mocks.documents.set(learnerPath, { ...record, guardian: 'Maria Cruz', progressionSourceSchoolYear: '2025-2026', progressionType: 'promotion' });
    expect(await uploadStudents(studentImportStore, year, [{ ...record, firstName: 'Updated' }], 'merge')).toMatchObject({ updated: 1 });
    expect(mocks.documents.get(learnerPath)).toMatchObject({ firstName: 'Updated', guardian: 'Maria Cruz', progressionType: 'promotion', __studentImportId: expect.any(String) });
    expect(mocks.refresh).toHaveBeenCalledWith(year);
  });

  it('filters UI target sections by school-year assignment and permits administrators all configured sections', () => {
    const sections = [{ gradeLevel: 'Grade 6', section: 'POMELO' }, { gradeLevel: 'Grade 5', section: 'MANGO' }];
    expect(studentImportSections(year, sections)).toEqual([sections[0]]);
    expect(studentImportSections('2025-2026', sections)).toEqual([]);
    mocks.role = 'School Admin'; expect(studentImportSections(year, sections)).toEqual(sections);
    mocks.role = 'Registrar'; expect(studentImportSections(year, sections)).toEqual([]);
  });
});
