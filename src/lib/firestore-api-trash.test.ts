import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: null,
  setPersistence: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
};
const mockDb = {
  enablePersistence: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(),
  batch: vi.fn(),
  runTransaction: vi.fn(),
};
const mockFunctions = { httpsCallable: vi.fn() };

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mockAuth, firestore: () => mockDb, functions: () => mockFunctions })),
  auth: Object.assign(vi.fn(() => mockAuth), { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
  firestore: Object.assign(vi.fn(() => mockDb), {
    FieldValue: { serverTimestamp: vi.fn(() => 'server-time') },
  }),
});

const { setAppUserProfile } = await import('./app-config');
const { fsGetTrash, fsWriteAuditedSettings_, fsUpdateMyTeacherPrefs, fsGetCertificatePreferences, fsSetCertificatePreferences, fsSubscribeCertificatePreferences, fsGetRecordDocumentPreferences, fsSetRecordDocumentPreference, fsSaveSection, fsSectionAdviser_, fsCanonicalLearner_, fsUpdateArchiveRecord } = await import('./firestore-api');
const { LPSApi } = await import('./sheets-api');
const { fsMarkSf10RequestEmailed } = await import('./firestore-api');

describe('confirmed SF10 request email tracking', () => {
  const receipt = { messageId: 'confirmed-gmail-id', sentAt: '2026-10-31T17:05:00.000Z', to: ['records@example.edu'], cc: ['registrar@example.edu'], bcc: [] };
  let transaction: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    mockAuth.currentUser = { uid: 'registrar' } as never;
    setAppUserProfile({ uid: 'registrar', role: 'Registrar', status: 'Active' });
    vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    const ref = (path: string): any => ({ path, collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`) });
    mockDb.collection.mockImplementation(ref);
    transaction = { get: vi.fn(async () => ({ exists: true })), update: vi.fn() };
    mockDb.runTransaction.mockReset().mockImplementation(async (action) => action(transaction));
  });
  afterEach(() => { mockAuth.currentUser = null; setAppUserProfile(null); sessionStorage.clear(); vi.restoreAllMocks(); });

  it('updates only the captured year and learners, preserving other dates with a field-level patch', async () => {
    await fsMarkSf10RequestEmailed('2026-2027', ['001', '002', '001'], receipt, 'registrar');
    expect(transaction.update.mock.calls.map(([ref]) => ref.path)).toEqual([
      'schoolYears/2026-2027/learners/001', 'schoolYears/2026-2027/learners/002',
    ]);
    expect(transaction.update.mock.calls[0][1]).toEqual({ documentStatus: 'Emailed', 'documentStatusDates.Emailed': '2026-11-01', sf10Email: receipt });
    expect(Math.max(...transaction.get.mock.invocationCallOrder)).toBeLessThan(Math.min(...transaction.update.mock.invocationCallOrder));
    expect(LPSApi.recordAuditEvent).toHaveBeenCalledWith('SF10_REQUEST_EMAILED', expect.objectContaining({ recordId: '001, 002' }));
    expect(fsCanonicalLearner_({ sf10Email: receipt }).sf10Email).toEqual(receipt);
    expect(fsCanonicalLearner_({ firstName: 'Updated' })).not.toHaveProperty('sf10Email');
  });

  it('does not recreate a learner removed or archived while the email was sending', async () => {
    transaction.get.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['001', 'missing'], receipt, 'registrar')).rejects.toThrow('moved or removed');
    expect(transaction.update).not.toHaveBeenCalled();
    expect(LPSApi.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects missing Gmail confirmation, invalid paths, and a changed or unauthorized account', async () => {
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['001'], { ...receipt, messageId: '' }, 'registrar')).rejects.toThrow('confirmed Gmail receipt');
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['../002'], receipt, 'registrar')).rejects.toThrow('Valid learner IDs');
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['001'], receipt, 'different-account')).rejects.toThrow('same authorized school account');
    setAppUserProfile({ uid: 'registrar', role: 'Teacher', status: 'Active' });
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['001'], receipt, 'registrar')).rejects.toThrow('authorized school account');
    expect(mockDb.runTransaction).not.toHaveBeenCalled();
  });

  it('uses bounded transactions for large batches and reports failed commits without auditing success', async () => {
    await fsMarkSf10RequestEmailed('2026-2027', Array.from({ length: 201 }, (_, index) => String(index)), receipt, 'registrar');
    expect(mockDb.runTransaction).toHaveBeenCalledTimes(2);
    expect(transaction.update).toHaveBeenCalledTimes(201);
    vi.mocked(LPSApi.recordAuditEvent).mockClear();
    mockDb.runTransaction.mockRejectedValueOnce(new Error('Commit unavailable'));
    await expect(fsMarkSf10RequestEmailed('2026-2027', ['001'], receipt, 'registrar')).rejects.toThrow('Commit unavailable');
    expect(LPSApi.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('section adviser updates', () => {
  it('uses the explicitly saved name ahead of stale linked teacher metadata', () => {
    expect(fsSectionAdviser_({ adviser: 'Clent C. Agunod', adviserOverride: true }, { teacherName: 'Clent Agunod' })).toBe('Clent C. Agunod');
    expect(fsSectionAdviser_({ adviser: '', adviserOverride: true }, { teacherName: 'Clent Agunod' })).toBe('');
    expect(fsSectionAdviser_({ adviser: '' }, { teacherName: 'Assigned Teacher' })).toBe('Assigned Teacher');
    expect(fsSectionAdviser_({}, { teacherName: 'Legacy Teacher' })).toBe('Legacy Teacher');
  });
  it('persists a middle-initial correction on the section and its linked teacher', async () => {
    const teacherRef = { set: vi.fn().mockResolvedValue(undefined) };
    const teachers = { get: vi.fn().mockResolvedValue({ docs: [{ ref: teacherRef }] }) };
    const sectionRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ adviser: 'Clent Agunod' }) }), set: vi.fn().mockResolvedValue(undefined), collection: vi.fn(() => teachers) };
    const gradeRef = { set: vi.fn().mockResolvedValue(undefined), collection: () => ({ doc: () => sectionRef }) };
    const grades = { doc: () => gradeRef };
    const years = { doc: () => ({ collection: () => grades }) };
    const users = { where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) };
    const write = { set: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
    mockDb.batch.mockReturnValue(write);
    mockDb.collection.mockImplementation((name) => name === 'users' ? users : years);
    await fsSaveSection({ id: '2026-2027|grade-1|a', schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', adviser: 'Clent C. Agunod' });
    expect(write.set).toHaveBeenCalledWith(sectionRef, expect.objectContaining({ adviser: 'Clent C. Agunod', adviserOverride: true }), { merge: true });
    expect(write.set).toHaveBeenCalledWith(teacherRef, expect.objectContaining({ teacherName: 'Clent C. Agunod' }), { merge: true });
    expect(write.commit).toHaveBeenCalledOnce();
  });
  it('includes persistent transfer school fields in the canonical learner schema', () => {
    expect(fsCanonicalLearner_({ transferSchoolId: '001234', transferSchool: 'Previous School', transferSchoolAddress: 'Town', transferSchoolZipCode: '0010' })).toMatchObject({ transferSchoolId: '001234', transferSchool: 'Previous School', transferSchoolAddress: 'Town', transferSchoolZipCode: '0010' });
  });
});

describe('transfer record persistence', () => {
  const school = { transferSchoolId: '001234', transferSchool: 'Receiving School', transferSchoolAddress: 'Receiving Town', transferSchoolZipCode: '0010' };
  it('persists all mandatory school fields when editing an archived learner', async () => {
    const ref = { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ learnerId: '123456789012', transferOut: true, transferType: 'Transfer Out', ...school }) }), set: vi.fn().mockResolvedValue(undefined) };
    mockDb.collection.mockReturnValue({ doc: () => ({ collection: () => ({ doc: () => ref }) }) });
    await fsUpdateArchiveRecord('transferredOut', '2026-2027', '123456789012', { ...school, transferType: 'Transfer Out', transferOut: true });
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining(school), { merge: true });
  });
  it('moves a changed outgoing record into active learners atomically instead of leaving it in the envelope list', async () => {
    const original = { learnerId: '123456789012', transferType: 'Transfer Out', transferOut: true, ...school };
    const sourceRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => original }) };
    const targetRef = {};
    mockDb.collection.mockReturnValue({ doc: () => ({ collection: (name: string) => ({ doc: () => name === 'learners' ? targetRef : sourceRef }) }) });
    const transaction = { get: vi.fn(async (ref) => ref === sourceRef ? { exists: true, data: () => original } : { exists: false }), set: vi.fn(), delete: vi.fn() };
    mockDb.runTransaction.mockImplementation(async (action) => action(transaction));
    await fsUpdateArchiveRecord('transferredOut', '2026-2027', original.learnerId, { ...school, transferType: 'Transfer In', transferIn: true, transferOut: false, enrollmentStatus: 'ACTIVE' });
    expect(transaction.set).toHaveBeenCalledWith(targetRef, expect.objectContaining({ transferType: 'Transfer In', transferOut: false, transferSchoolZipCode: '0010' }));
    expect(transaction.delete).toHaveBeenCalledWith(sourceRef);
  });
});
const { normalizeUserPreferences } = await import('./user-preferences');
const { normalizeCertificatePreferences } = await import('./certificate-preferences');
const { normalizeRecordDocumentPreferences } = await import('./record-document-preferences');

describe('record preferences in settings/toggles', () => {
  afterEach(() => { setAppUserProfile(null); sessionStorage.clear(); vi.restoreAllMocks(); });
  it('reads persisted settings and saves one document without replacing other toggles', async () => {
    setAppUserProfile({ role: 'School Admin', uid: 'admin' });
    const preferences = normalizeRecordDocumentPreferences();
    const before = { canParentAccess: false, canPromoteStudents: true, printables: preferences };
    const ref = { get: vi.fn().mockResolvedValue({ exists: true, data: () => before }), set: vi.fn().mockResolvedValue(undefined) };
    const doc = vi.fn(() => ref);
    mockDb.collection.mockReturnValue({ doc });
    vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    expect(await fsGetRecordDocumentPreferences()).toEqual(preferences);
    const changed = { ...preferences['outgoing-envelope'], defaultTextSize: 90 };
    await fsSetRecordDocumentPreference('outgoing-envelope', changed);
    expect(doc).toHaveBeenCalledWith('toggles');
    expect(ref.set).toHaveBeenCalledWith({ printables: { 'outgoing-envelope': changed } }, { mergeFields: ['printables.outgoing-envelope'] });
    expect(before.canParentAccess).toBe(false);
    expect(before.printables['sf10-request'].defaultPaperSize).toBe('a4');
  });
  it('rejects registrar or teacher configuration writes before contacting Firestore', async () => {
    for (const role of ['Registrar', 'Teacher']) {
      setAppUserProfile({ role, uid: 'user' });
      mockDb.collection.mockClear();
      await expect(fsSetRecordDocumentPreference('sf10-request', normalizeRecordDocumentPreferences()['sf10-request'])).rejects.toThrow('School Admin');
      expect(mockDb.collection).not.toHaveBeenCalled();
    }
  });
});

describe('shared certificate preference persistence', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('persists and reloads preferences at settings/certificatePreferences with audit metadata', async () => {
    const record = vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    let stored: Record<string, unknown> | undefined;
    const ref = {
      path: 'settings/certificatePreferences',
      get: vi.fn(async () => ({ exists: Boolean(stored), data: () => stored })),
      set: vi.fn(async (value) => { stored = value; }),
    };
    const doc = vi.fn(() => ref);
    mockDb.collection.mockReturnValue({ doc });
    expect(await fsGetCertificatePreferences()).toEqual(normalizeCertificatePreferences());
    const value = normalizeCertificatePreferences({ defaultPaperSize: 'legal', showSealNotice: false, templates: { enrollment: { defaultTemplate: 'sres' } } });
    await fsSetCertificatePreferences(value);
    expect(mockDb.collection).toHaveBeenCalledWith('settings');
    expect(doc).toHaveBeenCalledWith('certificatePreferences');
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({ ...value, updatedAt: 'server-time', updatedBy: '' }), { merge: true });
    expect(await fsGetCertificatePreferences()).toEqual(value);
    expect(record).toHaveBeenCalledWith('SETTINGS_UPDATE', expect.objectContaining({ recordId: 'settings/certificatePreferences' }));
    ref.set.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(fsSetCertificatePreferences(value)).rejects.toThrow('Permission denied');
  });

  it('delivers remote preference changes, listener errors, and unsubscribe to the studio', () => {
    const unsubscribe = vi.fn();
    const onSnapshot = vi.fn((_next, _error) => unsubscribe);
    mockDb.collection.mockReturnValue({ doc: vi.fn(() => ({ onSnapshot })) });
    const next = vi.fn();
    const error = vi.fn();
    expect(fsSubscribeCertificatePreferences(next, error)).toBe(unsubscribe);
    onSnapshot.mock.calls[0][0]({ exists: false });
    expect(next).toHaveBeenLastCalledWith(normalizeCertificatePreferences());
    onSnapshot.mock.calls[0][0]({ exists: true, data: () => ({ allowSchoolDetailsOverride: false }) });
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ allowSchoolDetailsOverride: false }));
    onSnapshot.mock.calls[0][1](new Error('Offline'));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Offline' }));
  });

  it('rejects invalid preferences before accessing Firestore', async () => {
    mockDb.collection.mockClear();
    await expect(fsSetCertificatePreferences({})).rejects.toThrow();
    expect(mockDb.collection).not.toHaveBeenCalled();
  });
});

describe('account preference persistence', () => {
  afterEach(() => { mockAuth.currentUser = null; sessionStorage.clear(); setAppUserProfile(null); vi.restoreAllMocks(); });

  it('writes complete preferences to the current account without changing access or assignments', async () => {
    mockAuth.currentUser = { uid: 'teacher-1' };
    const original = { uid: 'teacher-1', role: 'Teacher', teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }] };
    sessionStorage.setItem('lps_user_profile', JSON.stringify(original));
    const update = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn(() => ({ update }));
    mockDb.collection.mockReturnValue({ doc });
    const prefs = normalizeUserPreferences({ theme: 'Forest', tablePageSize: 25, hiddenLearnerColumns: ['guardian'] });
    await expect(fsUpdateMyTeacherPrefs(prefs)).resolves.toEqual(prefs);
    expect(doc).toHaveBeenCalledWith('teacher-1');
    expect(update).toHaveBeenCalledWith({ teacherPrefs: prefs });
    expect(JSON.parse(sessionStorage.getItem('lps_user_profile')!)).toEqual({ ...original, teacherPrefs: prefs });
  });

  it('rejects malformed preferences before writing anything', async () => {
    mockAuth.currentUser = { uid: 'teacher-1' };
    const update = vi.fn();
    mockDb.collection.mockReturnValue({ doc: () => ({ update }) });
    await expect(fsUpdateMyTeacherPrefs({ ...normalizeUserPreferences(), tablePageSize: 999 })).rejects.toThrow('Invalid account preferences');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('settings audit writes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records changed fields after persistence and excludes server metadata', async () => {
    const record = vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    const ref = {
      path: 'settings/toggles',
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ canParentAccess: true, roundType: 'nearest' }) }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    await fsWriteAuditedSettings_(ref, { canParentAccess: false, roundType: 'nearest', updatedAt: 'server-time' });
    expect(record).toHaveBeenCalledWith('SETTINGS_UPDATE', expect.objectContaining({
      recordId: 'settings/toggles', oldValue: '{"canParentAccess":true}', newValue: '{"canParentAccess":false}',
    }));
    expect(ref.set.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
  });

  it('does not audit unchanged settings or failed writes', async () => {
    const record = vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({ recorded: true });
    const ref = {
      path: 'settings/toggles',
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ canParentAccess: false }) }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    await fsWriteAuditedSettings_(ref, { canParentAccess: false });
    expect(record).not.toHaveBeenCalled();
    ref.set.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(fsWriteAuditedSettings_(ref, { canParentAccess: true })).rejects.toThrow('Permission denied');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('fsGetTrash teacher scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const profile = {
      uid: 'teacher-1',
      role: 'Teacher',
      status: 'Active',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
        { schoolYear: '2025-2026', gradeLevel: 'Grade 2', section: 'C' },
      ],
    };
    setAppUserProfile(profile);
    sessionStorage.setItem('lps_user_profile', JSON.stringify(profile));
  });

  afterEach(() => {
    setAppUserProfile(null);
    sessionStorage.removeItem('lps_user_profile');
    vi.restoreAllMocks();
  });

  it('queries only the teacher’s grade/sections assigned for the selected year', async () => {
    const docsForKey = new Map([
      ['2026-2027::Grade 1::A', [{ id: 'trash-1', data: () => ({ learnerId: 'LRN-001' }) }]],
      ['2026-2027::Grade 5::B', [{ id: 'trash-2', data: () => ({ learnerId: 'LRN-002' }) }]],
    ]);
    const where = vi.fn((_field: string, _operator: string, key: string) => ({
      get: vi.fn().mockResolvedValue({ docs: docsForKey.get(key) || [] }),
    }));
    const trashCollection = { where };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ collection: vi.fn(() => trashCollection) })),
    }));

    const items = await fsGetTrash('2026-2027');

    expect(where.mock.calls).toEqual([
      ['teacherAssignmentSecurityKey', '==', '2026-2027::Grade 1::A'],
      ['teacherAssignmentSecurityKey', '==', '2026-2027::Grade 5::B'],
    ]);
    expect(items.map(({ trashId }) => trashId)).toEqual(['trash-1', 'trash-2']);
  });
});
