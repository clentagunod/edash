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
const { fsGetTrash, fsWriteAuditedSettings_, fsUpdateMyTeacherPrefs, fsGetCertificatePreferences, fsSetCertificatePreferences, fsSubscribeCertificatePreferences } = await import('./firestore-api');
const { LPSApi } = await import('./sheets-api');
const { normalizeUserPreferences } = await import('./user-preferences');
const { normalizeCertificatePreferences } = await import('./certificate-preferences');

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
