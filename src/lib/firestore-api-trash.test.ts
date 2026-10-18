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
const { fsGetTrash } = await import('./firestore-api');

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
