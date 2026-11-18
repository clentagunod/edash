import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'staff' }, setPersistence: vi.fn().mockResolvedValue(undefined), onAuthStateChanged: vi.fn() },
  db: { enablePersistence: vi.fn().mockResolvedValue(undefined), collection: vi.fn(), runTransaction: vi.fn() },
}));
vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mocks.auth, firestore: () => mocks.db, functions: () => ({}) })),
  auth: Object.assign(vi.fn(() => mocks.auth), { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
  firestore: Object.assign(vi.fn(() => mocks.db), { FieldValue: { serverTimestamp: vi.fn(() => 'server-time') } }),
});
const { setAppUserProfile } = await import('./app-config');
const { LPSApi } = await import('./sheets-api');
const { fsGetProfileEditingConfiguration, fsUpdateProfileValue, fsGetReadingProfiles, fsGetMathProfiles, fsUpdateLearner } = await import('./firestore-api');
const { LPSCache } = await import('./cache');

describe('Firestore profile editing', () => {
  let documents: Record<string, any>;
  let transaction: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let set: ReturnType<typeof vi.fn>;
  const year = '2026-2027', learnerPath = `schoolYears/${year}/learners/001`;
  const ref = (path: string): any => ({ path, id: path.split('/').pop(),
    collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`),
    get: vi.fn(async () => snapshot(path)), set: (...args: unknown[]) => set(path, ...args),
  });
  function snapshot(path: string) { return { exists: path in documents, data: () => documents[path] }; }
  beforeEach(() => {
    vi.useFakeTimers();
    LPSCache.clear();
    sessionStorage.clear();
    mocks.auth.currentUser = { uid: 'staff' };
    setAppUserProfile({ uid: 'staff', role: 'School Admin', status: 'Active' });
    documents = {
      [learnerPath]: { learnerId: '001', name: 'Learner', gradeLevel: 'Grade 2', section: 'A', gradesByTerm: { quarter1: { english: '87', math: '80' }, final: { math: '90' } }, math: '90' },
      [`schoolYears/${year}/grades/grade-2`]: { subjectIds: ['math', 'english'] },
      [`settings/gradeTerms/years/${year}`]: { termCount: 3 },
    };
    mocks.db.collection.mockReset().mockImplementation(ref);
    transaction = { get: vi.fn(async target => snapshot(target.path)), update: vi.fn() };
    mocks.db.runTransaction.mockReset().mockImplementation(async callback => callback(transaction));
    set = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
    setAppUserProfile(null); sessionStorage.clear();
  });
  const edit = (changes = {}) => ({ kind: 'grades' as const, term: 'quarter1', field: 'math', previousValue: '80', value: '85', ...changes });
  function teacher(section = 'A') {
    const profile = { uid: 'staff', role: 'Teacher', status: 'Active', teacherAssignments: [{ schoolYear: year, gradeLevel: 'Grade 2', section }] };
    setAppUserProfile(profile); sessionStorage.setItem('lps_user_profile', JSON.stringify(profile));
  }

  it('defaults existing schools to enabled and rejects malformed settings', async () => {
    expect(await fsGetProfileEditingConfiguration()).toEqual({ canTeacherEditProfiles: true, configured: false });
    documents['settings/toggles'] = { canTeacherEditProfiles: false };
    expect((await fsGetProfileEditingConfiguration()).canTeacherEditProfiles).toBe(false);
    documents['settings/toggles'] = { canTeacherEditProfiles: 'true' };
    await expect(fsGetProfileEditingConfiguration()).rejects.toThrow('true or false');
  });
  it('saves one term without changing other subjects or finals', async () => {
    await fsUpdateProfileValue(year, '001', edit());
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: learnerPath }), {
      gradesByTerm: { quarter1: { english: '87', math: '85' }, final: { math: '90' } },
    });
    expect(LPSApi.recordAuditEvent).toHaveBeenCalledWith('PROFILE_UPDATE', expect.objectContaining({ recordId: '001' }));
  });
  it('saves final grades in both canonical locations and supports legacy empty grade maps', async () => {
    documents[learnerPath].gradesByTerm = '';
    await fsUpdateProfileValue(year, '001', edit({ term: 'final', previousValue: '90', value: '' }));
    expect(transaction.update.mock.calls[0][1]).toEqual({ gradesByTerm: { final: { math: '' } }, math: '' });
  });
  it('supports a current school year using the legacy term-count setting', async () => {
    delete documents[`settings/gradeTerms/years/${year}`];
    documents[`schoolYears/${year}`] = { isCurrent: true };
    documents['settings/gradeTerms'] = { termCount: 4 };
    await fsUpdateProfileValue(year, '001', edit({ term: 'quarter4', previousValue: '' }));
    expect(transaction.update.mock.calls[0][1].gradesByTerm.quarter4).toEqual({ math: '85' });
  });
  it('includes learners without assessment results and assigns the appropriate reading instrument', async () => {
    mocks.db.collection.mockImplementation(path => {
      const target = ref(path);
      if (path !== 'schoolYears') return target;
      target.doc = (id: string) => {
        const yearRef = ref(`schoolYears/${id}`);
        yearRef.collection = (collection: string) => {
          const collectionRef = ref(`schoolYears/${id}/${collection}`);
          if (collection === 'learners') collectionRef.get = vi.fn(async () => ({ docs: [
            { id: '001', data: () => ({ ...documents[learnerPath] }) },
            { id: '002', data: () => ({ gradeLevel: 'Grade 5', section: 'A' }) },
          ] }));
          return collectionRef;
        };
        return yearRef;
      };
      return target;
    });
    const reading = await fsGetReadingProfiles(year);
    expect(reading.map(record => [record.learnerId, record.reference, record.bosy])).toEqual([
      ['001', 'CRLA', ''], ['002', 'Phil-IRI', ''],
    ]);
    expect(await fsGetMathProfiles(year)).toHaveLength(2);
  });
  it('blocks disabled teachers and teachers outside the assigned section', async () => {
    teacher(); documents['settings/toggles'] = { canTeacherEditProfiles: false };
    await expect(fsUpdateProfileValue(year, '001', edit())).rejects.toThrow('disabled');
    documents['settings/toggles'] = { canTeacherEditProfiles: true }; teacher('B');
    await expect(fsUpdateProfileValue(year, '001', edit())).rejects.toThrow('assigned grade and section');
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it('allows assigned teachers with the default enabled setting', async () => {
    teacher(); await expect(fsUpdateProfileValue(year, '001', edit())).resolves.toEqual({ updated: true, value: '85' });
  });
  it('does not recreate removed learners or overwrite a conflicting value', async () => {
    documents[learnerPath].gradesByTerm.quarter1.math = '82';
    await expect(fsUpdateProfileValue(year, '001', edit())).rejects.toThrow('changed since');
    delete documents[learnerPath];
    await expect(fsUpdateProfileValue(year, '001', edit())).rejects.toThrow('moved or removed');
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it('rejects invalid grades, unassigned subjects, unconfigured terms and mismatched assessments', async () => {
    await expect(fsUpdateProfileValue(year, '001', edit({ value: '101' }))).rejects.toThrow('0 to 100');
    await expect(fsUpdateProfileValue(year, '001', edit({ field: 'science' }))).rejects.toThrow('not assigned');
    await expect(fsUpdateProfileValue(year, '001', edit({ term: 'quarter4' }))).rejects.toThrow('configured grade term');
    await expect(fsUpdateProfileValue(year, '001', { kind: 'reading', field: 'bosyPhilIRI', previousValue: '', value: 'Independent' })).rejects.toThrow('valid assessment field');
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it('saves reading and math classifications to their original source fields', async () => {
    await fsUpdateProfileValue(year, '001', { kind: 'reading', field: 'bosyCRLA', previousValue: '', value: 'Developing' });
    await fsUpdateProfileValue(year, '001', { kind: 'math', field: 'mosyRMA', previousValue: '', value: 'Proficient' });
    expect(transaction.update.mock.calls.map(call => call[1])).toEqual([{ bosyCRLA: 'Developing' }, { mosyRMA: 'Proficient' }]);
  });
  it('preserves omitted profile fields in ordinary learner updates', async () => {
    await fsUpdateLearner(year, '001', { firstName: 'Updated' });
    const patch = set.mock.calls[0][1];
    expect(patch.firstName).toBe('Updated');
    for (const key of ['gradesByTerm', 'math', 'english', 'bosyCRLA', 'mosyPhilIRI', 'eosyRMA', 'extra']) expect(patch).not.toHaveProperty(key);
  });
});
