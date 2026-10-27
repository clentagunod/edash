
import preferenceDefaults from '../../shared/user-preferences.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: null,
  setPersistence: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
};

const mockAuthNamespace = {
  Persistence: {
    LOCAL: 'local',
    SESSION: 'session',
  },
};

const mockDb = {
  enablePersistence: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn() })) })),
  batch: vi.fn(),
  runTransaction: vi.fn(),
};
const mockFunctions = { httpsCallable: vi.fn() };

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mockAuth, firestore: () => mockDb, functions: () => mockFunctions })),
  auth: Object.assign(vi.fn(() => mockAuth), { Auth: mockAuthNamespace }),
  firestore: Object.assign(vi.fn(() => mockDb), {
    FieldValue: { serverTimestamp: vi.fn(() => 'server-time') },
  }),
});

const { APP_CONFIG, APP_LOGIN_PATH, appBrandAssetUrl, appDocumentTitle, appSchoolFilePrefix, ensureVisitorSession, isVisitorSession, setAppUserProfile, updateSchoolFavicon } = await import('./app-config');
const { LPSApi } = await import('./sheets-api');
const { loadDashboardData, renderRecentTable } = await import('./dashboard');
const { sentenceCaseName } = await import('./learner-list');
const firestoreApi = await import('./firestore-api');
const demoData = await import('./demo-data');

describe('shared application configuration', () => {
  it('centralizes school identity, browser branding, and Firestore schema names', () => {
    expect(APP_CONFIG.branding).toMatchObject({
      schoolName: 'E-Dash',
      nickname: 'E-Dash',
      logoFile: 'edash/edash.png',
      faviconFile: 'favicon.png',
    });
    expect(appBrandAssetUrl(`${APP_CONFIG.assetsPath}${APP_CONFIG.branding.logoFile}`)).toBe('/assets/edash/edash.png');
    expect(appSchoolFilePrefix()).toBe('e-dash');
    expect(APP_LOGIN_PATH).toBe('/login');
    expect(appDocumentTitle('Statistics')).toBe('Statistics — E-Dash Realtime Enrollment Dashboard');
    expect(appDocumentTitle(APP_CONFIG.branding.schoolName)).toBe('E-Dash — Realtime Enrollment Dashboard');
    expect(APP_CONFIG.firestore.collections).toMatchObject({
      users: 'users',
      schoolYears: 'schoolYears',
      grades: 'grades',
      learners: 'learners',
      dropouts: 'dropouts',
      transferredOut: 'transferredOut',
      publicStats: 'publicStats',
    });
    expect(APP_CONFIG.firestore.collections).not.toHaveProperty('sections');
    expect(APP_CONFIG.firestore.collections).not.toHaveProperty('advisory');
    expect(APP_CONFIG.firestore.paths.sections).toBe('sections');
    expect(APP_CONFIG.firestore.paths.assignmentHistory).toBe('assignmentHistory');
    expect(APP_CONFIG.firestore.paths.gradeTermYears).toBe('years');
    expect(APP_CONFIG.firestore.documents.currentSchoolYear).toBe('currentSchoolYear');
    expect(APP_CONFIG.firestore.documents.gradeTerms).toBe('gradeTerms');
    expect(APP_CONFIG.firestore.documents.toggles).toBe('toggles');
    expect(APP_CONFIG.firestore.settingsDefaults.toggles).toEqual({ canParentAccess: true, canPromoteStudents: false });
    expect(APP_CONFIG.firestore.schoolDefaults.gradeTerms).toEqual({ termCount: 3, passingThreshold: 75, gradeLevels: {} });
    expect(APP_CONFIG.firestore.schoolYearDefaults).toEqual({ gradeTerms: { termCount: 3, passingThreshold: 75, gradeLevels: {} }, isCurrent: false });
    expect(APP_CONFIG.firestore.userDefaults.teacherPrefs).toEqual(preferenceDefaults);
    expect(APP_CONFIG.firestore.learnerFields).toContain('eosyNutritionalStatus');
    expect(APP_CONFIG.firestore.learnerFields).toContain('suffix');
    expect(APP_CONFIG.firestore.schemaVersion).toBe(3);
    expect(Object.isFrozen(APP_CONFIG.firestore.learnerFields)).toBe(true);
  });

  it('creates and updates the browser-tab icon from the selected school logo', () => {
    document.querySelector('link[rel="icon"]')?.remove();
    document.querySelector('link[data-school-logo-preload]')?.remove();

    updateSchoolFavicon('/assets/another-school/logo.png');

    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    expect(favicon?.getAttribute('href')).toBe('/assets/another-school/logo.png');
    expect(favicon?.hasAttribute('onerror')).toBe(false);
    const preload = document.querySelector<HTMLLinkElement>('link[data-school-logo-preload]');
    expect(preload?.rel).toBe('preload');
    expect(preload?.as).toBe('image');
    expect(preload?.href).toBe(`${window.location.origin}/assets/another-school/logo.png`);
    expect(preload?.getAttribute('fetchpriority')).toBe('high');

    updateSchoolFavicon('/assets/another-school/logo.png');
    expect(document.querySelectorAll('link[data-school-logo-preload]')).toHaveLength(1);
  });
});

describe('school-year rollover', () => {
  it('allows a previously configured year to become current and retains teacher assignment history', async () => {
    const historyRef = { id: 'teacher-history-2026' };
    const teacherRef = {
      id: 'teacher-1',
      collection: vi.fn(() => ({ doc: vi.fn(() => historyRef) })),
    };
    const alreadyUnassignedRef = {
      id: 'teacher-2',
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: 'teacher-history-empty' })) })),
    };
    const adminRef = { id: 'admin-1' };
    const year2026Ref = { id: 'year-2026' };
    const year2027Ref = { id: 'year-2027' };
    const year2025Ref = { id: 'year-2025' };
    const settingRef = { id: 'current-year-setting', get: async () => ({ exists: true, data: () => ({ value: '2027-2028' }) }) };
    const teacherProfiles = [
      { ref: teacherRef, data: () => ({ role: 'Teacher', teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }] }) },
      { ref: alreadyUnassignedRef, data: () => ({ role: 'Teacher', teacherAssignments: [], teacherAssignment: null }) },
      { ref: adminRef, data: () => ({ role: 'School Admin' }) },
    ];
    const years = [
      { id: '2025-2026', ref: year2025Ref },
      { id: '2026-2027', ref: year2026Ref },
      { id: '2027-2028', ref: year2027Ref },
    ];
    const commits = [];
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'schoolYears') {
        return {
          doc: (id) => ({ get: async () => ({ exists: years.some((year) => year.id === id), data: () => ({ isCurrent: id === '2027-2028' }) }) }),
          get: async () => ({ docs: years }),
        };
      }
      if (name === 'users') return { get: async () => ({ docs: teacherProfiles }) };
      if (name === 'settings') return { doc: (id) => ({ ...settingRef, get: settingRef.get, id }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    const batchSpy = vi.spyOn(mockDb, 'batch').mockImplementation(() => {
      const writes = [];
      const batch = {
        set: vi.fn((ref, data, options) => { writes.push({ ref, data, options }); return batch; }),
        commit: vi.fn(async () => { commits.push(writes); }),
      };
      return batch;
    });

    try {
      const result = await firestoreApi.fsSetCurrentSchoolYear('2025-2026');

      expect(result).toMatchObject({
        schoolYear: '2025-2026',
        isCurrent: true,
        resetTeacherAssignments: 0,
        preservedTeacherAssignments: 1,
      });
      expect(commits).toHaveLength(3);
      expect(commits[0]).toEqual([
        {
          ref: historyRef,
          data: {
            schoolYear: '2026-2027',
            assignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
            updatedAt: 'server-time',
            updatedBy: '',
          },
          options: { merge: true },
        },
      ]);
      expect(commits[1]).toContainEqual({ ref: teacherRef, data: { activeSchoolYear: '2025-2026' }, options: { merge: true } });
      expect(commits[1]).toContainEqual({ ref: alreadyUnassignedRef, data: { activeSchoolYear: '2025-2026' }, options: { merge: true } });
      expect(commits[2]).toEqual([
        { ref: year2025Ref, data: { isCurrent: true }, options: { merge: true } },
        { ref: year2026Ref, data: { isCurrent: false }, options: { merge: true } },
        { ref: year2027Ref, data: { isCurrent: false }, options: { merge: true } },
        { ref: expect.objectContaining({ id: 'currentSchoolYear' }), data: { value: '2025-2026' }, options: { merge: true } },
      ]);
    } finally {
      collectionSpy.mockRestore();
      batchSpy.mockRestore();
    }
  });

  it('automatically moves teacher views to the year marked current by an admin', async () => {
    const { syncSchoolYearsLive } = await import('./school-year');
    const schoolYearModule = await import('./school-year');
    const appConfigModule = await import('./app-config');
    const previousProfile = appConfigModule.APP_USER_PROFILE;
    const previousYear = schoolYearModule.getSelectedSchoolYear();
    const previousStoredYear = schoolYearModule.readStoredSchoolYear_();
    const mount = document.createElement('div');
    mount.innerHTML = '<strong class="year-readonly-value">2026-2027</strong>';
    document.body.append(mount);
    const onChange = vi.fn();
    setAppUserProfile({ role: 'Teacher', status: 'Active' });

    try {
      syncSchoolYearsLive(mount, onChange, [
        { schoolYear: '2026-2027', isCurrent: false },
        { schoolYear: '2027-2028', isCurrent: true },
      ]);

      expect(mount.querySelector('.year-readonly-value')?.textContent).toBe('2027-2028');
      expect(onChange).toHaveBeenCalledWith('2027-2028');
    } finally {
      setAppUserProfile(previousProfile);
      schoolYearModule.setSelectedSchoolYear(previousYear);
      schoolYearModule.writeStoredSchoolYear_(previousStoredYear);
      mount.remove();
    }
  });

  it('moves other signed-in dashboard roles when the app-wide current year changes', async () => {
    const schoolYearModule = await import('./school-year');
    const appConfigModule = await import('./app-config');
    const previousProfile = appConfigModule.APP_USER_PROFILE;
    const previousYear = schoolYearModule.getSelectedSchoolYear();
    const previousStoredYear = schoolYearModule.readStoredSchoolYear_();
    const mount = document.createElement('div');
    const onChange = vi.fn();
    setAppUserProfile({ role: 'Registrar', status: 'Active' });
    schoolYearModule.setSelectedSchoolYear('2026-2027');
    schoolYearModule.writeStoredSchoolYear_('2026-2027');

    try {
      schoolYearModule.syncSchoolYearsLive(mount, onChange, [
        { schoolYear: '2026-2027', isCurrent: true },
        { schoolYear: '2027-2028', isCurrent: false },
      ]);
      onChange.mockClear();
      schoolYearModule.syncSchoolYearsLive(mount, onChange, [
        { schoolYear: '2026-2027', isCurrent: false },
        { schoolYear: '2027-2028', isCurrent: true },
      ]);

      expect(schoolYearModule.getSelectedSchoolYear()).toBe('2027-2028');
      expect(onChange).toHaveBeenCalledWith('2027-2028');
    } finally {
      setAppUserProfile(previousProfile);
      schoolYearModule.setSelectedSchoolYear(previousYear);
      schoolYearModule.writeStoredSchoolYear_(previousStoredYear);
    }
  });
});

describe('Parent Access setting', () => {
  it('uses the tenant toggle document and defaults to enabled until explicitly configured', async () => {
    const togglesRef = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') return { doc: vi.fn((id) => {
        expect(id).toBe('toggles');
        return togglesRef;
      }) };
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      await expect(firestoreApi.fsGetParentAccessConfiguration()).resolves.toEqual({
        canParentAccess: true,
        configured: false,
      });
      togglesRef.get.mockResolvedValue({ exists: true, data: () => ({ canParentAccess: false }) });
      await expect(firestoreApi.fsGetParentAccessConfiguration()).resolves.toEqual({
        canParentAccess: false,
        configured: true,
      });
      await expect(firestoreApi.fsGetParentAccessEnabled()).resolves.toBe(false);
      await expect(firestoreApi.fsSetParentAccessEnabled(false)).resolves.toBe(false);
      expect(togglesRef.set).toHaveBeenCalledWith({ canParentAccess: false }, { merge: true });
      await expect(firestoreApi.fsSetParentAccessEnabled('false')).rejects.toThrow('must be enabled or disabled');
    } finally {
      collectionSpy.mockRestore();
    }
  });
});

describe('Promotion access setting', () => {
  it('defaults teacher promotion to disabled and reads/writes canPromoteStudents', async () => {
    const togglesRef = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') return { doc: vi.fn((id) => {
        expect(id).toBe('toggles');
        return togglesRef;
      }) };
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      await expect(firestoreApi.fsGetPromotionConfiguration()).resolves.toEqual({
        canPromoteStudents: false,
        configured: false,
      });
      togglesRef.get.mockResolvedValue({ exists: true, data: () => ({ canPromoteStudents: true }) });
      await expect(firestoreApi.fsGetPromotionConfiguration()).resolves.toEqual({
        canPromoteStudents: true,
        configured: true,
      });
      await expect(firestoreApi.fsSetCanPromoteStudents(false)).resolves.toBe(false);
      expect(togglesRef.set).toHaveBeenCalledWith({ canPromoteStudents: false }, { merge: true });
      await expect(firestoreApi.fsSetCanPromoteStudents('false')).rejects.toThrow('must be enabled or disabled');
    } finally {
      collectionSpy.mockRestore();
    }
  });

  it('creates a new succeeding-year learner record and leaves the source year unchanged', async () => {
    const sourceLearner = {
      firstName: 'Avery',
      lastName: 'Learner',
      learnerId: '123456789012',
      gradeLevel: 'Grade 1',
      section: 'A',
      age: 7,
      eosyStatus: 'Promoted',
      guardian: 'Parent',
      unrelatedField: 'preserved',
    };
    const sourceRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => sourceLearner }),
      set: vi.fn(),
    };
    const targetRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    let targetExists = false;
    const transaction = {
      get: vi.fn((ref) => Promise.resolve(ref === sourceRef
        ? { exists: true, data: () => sourceLearner }
        : { exists: targetExists })),
      set: vi.fn(),
    };
    const transactionSpy = vi.spyOn(mockDb, 'runTransaction').mockImplementation((callback) => callback(transaction));
    const sectionRef = {
      collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })),
    };
    const sectionDoc = {
      id: 'a',
      data: () => ({ schoolYear: '2031-2032', gradeLevel: 'Grade 2', section: 'A' }),
      ref: sectionRef,
    };
    const gradeOneSectionDoc = {
      id: 'b',
      data: () => ({ schoolYear: '2031-2032', gradeLevel: 'Grade 1', section: 'A' }),
      ref: sectionRef,
    };
    const gradeDoc = {
      data: () => ({ gradeLevel: 'Grade 2' }),
      ref: { collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [sectionDoc, gradeOneSectionDoc] }) })) },
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'schoolYears') return {
        doc: vi.fn((year) => ({
          collection: vi.fn((path) => path === 'learners'
            ? { doc: vi.fn(() => year === '2030-2031' ? sourceRef : targetRef) }
            : { get: vi.fn().mockResolvedValue({ docs: [gradeDoc] }) }),
        })),
      };
      throw new Error(`Unexpected collection ${name}`);
    });
    const auditSpy = vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setAppUserProfile({ uid: 'admin-promotion-test', role: 'School Admin' });
    vi.useFakeTimers();

    try {
      await expect(firestoreApi.fsPromoteLearner('2030-2031', '2031-2032', sourceLearner.learnerId, {
        ...sourceLearner,
        gradeLevel: 'Grade 2',
        section: 'A',
        age: 8,
      })).resolves.toEqual({
        learnerId: sourceLearner.learnerId,
        sourceSchoolYear: '2030-2031',
        schoolYear: '2031-2032',
      });
      expect(sourceRef.set).not.toHaveBeenCalled();
      expect(transaction.set).toHaveBeenCalledWith(targetRef, expect.objectContaining({
        learnerId: sourceLearner.learnerId,
        schoolYear: '2031-2032',
        gradeLevel: 'Grade 2',
        section: 'A',
        age: 8,
        guardian: 'Parent',
        unrelatedField: 'preserved',
        enrollmentStatus: 'ACTIVE',
        eosyStatus: '',
        transferOut: false,
        progressionSourceSchoolYear: '2030-2031',
        progressionType: 'promotion',
      }));
      expect(auditSpy).toHaveBeenCalledWith('LEARNER_PROMOTE', expect.anything());
      targetExists = true;
      await expect(firestoreApi.fsPromoteLearner('2030-2031', '2031-2032', sourceLearner.learnerId, {
        ...sourceLearner,
        gradeLevel: 'Grade 2',
        section: 'A',
        age: 8,
      })).rejects.toThrow('no record was overwritten');
      expect(transaction.set).toHaveBeenCalledOnce();

      targetExists = false;
      sourceLearner.gradeLevel = 'Grade 2';
      sourceLearner.eosyStatus = 'Retained';
      await expect(firestoreApi.fsPromoteLearner('2030-2031', '2031-2032', sourceLearner.learnerId, {
        ...sourceLearner,
        gradeLevel: 'Grade 2',
        section: 'A',
        age: 8,
      }, 'retention')).resolves.toEqual({
        learnerId: sourceLearner.learnerId,
        sourceSchoolYear: '2030-2031',
        schoolYear: '2031-2032',
      });
      expect(transaction.set).toHaveBeenLastCalledWith(targetRef, expect.objectContaining({
        gradeLevel: 'Grade 2',
        progressionType: 'retention',
        progressionSourceSchoolYear: '2030-2031',
      }));
      expect(auditSpy).toHaveBeenCalledWith('LEARNER_RETAIN', expect.anything());
      await expect(firestoreApi.fsPromoteLearner('2030-2031', '2031-2032', sourceLearner.learnerId, {
        ...sourceLearner,
        gradeLevel: 'Grade 1',
        section: 'A',
        age: 8,
      }, 'retention')).rejects.toThrow('must stay in the same grade level');
      expect(transaction.set).toHaveBeenCalledTimes(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      setAppUserProfile(null);
      auditSpy.mockRestore();
      consoleError.mockRestore();
      transactionSpy.mockRestore();
      collectionSpy.mockRestore();
    }
  });

  it('blocks teacher promotions when canPromoteStudents is absent or disabled', async () => {
    const togglesRef = { get: vi.fn().mockResolvedValue({ exists: false }) };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') return { doc: vi.fn(() => togglesRef) };
      throw new Error(`Unexpected collection ${name}`);
    });
    setAppUserProfile({ uid: 'teacher-promotion-test', role: 'Teacher' });
    try {
      await expect(firestoreApi.fsPromoteLearner('2030-2031', '2031-2032', '123456789012', {}))
        .rejects.toThrow('disabled for teachers');
      expect(togglesRef.get).toHaveBeenCalledOnce();
    } finally {
      setAppUserProfile(null);
      collectionSpy.mockRestore();
    }
  });
});

describe('teacher live learner updates', () => {
  it('streams changes from each assigned grade-section query without a refresh', () => {
    const userId = 'teacher-live-test';
    const assignments = [
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'B' },
      { schoolYear: '2025-2026', gradeLevel: 'Grade 3', section: 'C' },
    ];
    const queryListeners = [];
    const queryUnsubscribers = [];
    let profileListener;
    const userRef = {
      onSnapshot: vi.fn((next) => {
        profileListener = next;
        next({ exists: true, data: () => ({ role: 'Teacher', teacherAssignments: assignments }) });
        return vi.fn();
      }),
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'users') return { doc: vi.fn(() => userRef) };
      if (name === 'schoolYears') return {
        doc: vi.fn((year) => ({
          collection: vi.fn(() => {
            let filters = [];
            const query = {
              where: vi.fn((field, operator, value) => {
                filters = [...filters, [field, operator, value]];
                return query;
              }),
              onSnapshot: vi.fn((next, error) => {
                queryListeners.push({ filters, next, error });
                const unsubscribe = vi.fn();
                queryUnsubscribers.push(unsubscribe);
                return unsubscribe;
              }),
            };
            expect(year).toBe('2026-2027');
            return query;
          }),
        })),
      };
      throw new Error(`Unexpected collection ${name}`);
    });
    const userProfile = { uid: userId, userId, role: 'Teacher', teacherAssignments: assignments };
    mockAuth.currentUser = { uid: userId };
    setAppUserProfile(userProfile);
    const onChange = vi.fn();
    const onError = vi.fn();
    const unsubscribe = firestoreApi.fsSubscribeLearners('2026-2027', onChange, onError);
    const documents = (items) => ({
      docs: items.map(([id, data]) => ({ id, data: () => data })),
    });

    try {
      expect(queryListeners).toHaveLength(2);
      expect(queryListeners.map(({ filters }) => filters)).toEqual(expect.arrayContaining([
        [['gradeLevel', '==', 'Grade 1'], ['section', '==', 'A']],
        [['gradeLevel', '==', 'Grade 2'], ['section', '==', 'B']],
      ]));
      queryListeners[0].next(documents([['learner-a', { gradeLevel: 'Grade 1', section: 'A' }]]));
      queryListeners[1].next(documents([['learner-b', { gradeLevel: 'Grade 2', section: 'B' }]]));
      expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({ learnerId: 'learner-a' }),
        expect.objectContaining({ learnerId: 'learner-b' }),
      ]));

      queryListeners[0].next(documents([
        ['learner-a', { gradeLevel: 'Grade 1', section: 'A' }],
        ['learner-c', { gradeLevel: 'Grade 1', section: 'A' }],
        ['inactive', { gradeLevel: 'Grade 1', section: 'A', enrollmentStatus: 'DROPPED_OUT' }],
      ]));
      expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({ learnerId: 'learner-a' }),
        expect.objectContaining({ learnerId: 'learner-b' }),
        expect.objectContaining({ learnerId: 'learner-c' }),
      ]));
      expect(onChange.mock.lastCall[0].some((learner) => learner.learnerId === 'inactive')).toBe(false);

      profileListener({
        exists: true,
        data: () => ({
          role: 'Teacher',
          teacherAssignments: [
            assignments[0],
            { schoolYear: '2026-2027', gradeLevel: 'Grade 3', section: 'C' },
          ],
        }),
      });
      expect(queryUnsubscribers.slice(0, 2).every((stop) => stop.mock.calls.length === 1)).toBe(true);
      expect(queryListeners).toHaveLength(4);
      queryListeners[2].next(documents([['learner-a', { gradeLevel: 'Grade 1', section: 'A' }]]));
      queryListeners[3].next(documents([['learner-c', { gradeLevel: 'Grade 3', section: 'C' }]]));
      expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
        expect.objectContaining({ learnerId: 'learner-a' }),
        expect.objectContaining({ learnerId: 'learner-c' }),
      ]));
      expect(onChange.mock.lastCall[0].some((learner) => learner.learnerId === 'learner-b')).toBe(false);

      unsubscribe();
      expect(queryUnsubscribers).toHaveLength(4);
      queryUnsubscribers.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
      expect(profileListener).toBeTypeOf('function');
    } finally {
      setAppUserProfile(null);
      mockAuth.currentUser = null;
      collectionSpy.mockRestore();
    }
  });
});

describe('year-scoped grade term settings', () => {
  it('reads and writes the selected school year document', async () => {
    const yearTermRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ termCount: 4 }) }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const legacyTermRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ termCount: 2 }) }),
    };
    const schoolYearDoc = { id: '2026-2027', data: () => ({ schoolYear: '2026-2027', isCurrent: true }) };
    const settingsCollection = {
      doc: vi.fn((id) => id === 'gradeTerms'
        ? { collection: vi.fn(() => ({ doc: vi.fn(() => yearTermRef) })), ...legacyTermRef }
        : { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ value: '2026-2027' }) }) }),
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'schoolYears') return { get: vi.fn().mockResolvedValue({ docs: [schoolYearDoc] }) };
      if (name === 'settings') return settingsCollection;
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      await expect(firestoreApi.fsGetGradeTermCount('2026-2027')).resolves.toBe(4);
      expect(yearTermRef.get).toHaveBeenCalled();
      await expect(firestoreApi.fsSetGradeTermCount(2, '2026-2027')).resolves.toBe(2);
      expect(yearTermRef.set).toHaveBeenCalledWith(expect.objectContaining({
        schoolYear: '2026-2027',
        termCount: 2,
      }), { merge: true });
      expect(legacyTermRef.get).not.toHaveBeenCalled();
    } finally {
      collectionSpy.mockRestore();
    }
  });

  it('explains when Firestore rules reject a grade-term write', async () => {
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const settingsRef = { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }), set: vi.fn().mockRejectedValue(permissionError) };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => ({ doc: vi.fn(() => settingsRef) })) })) };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      await expect(firestoreApi.fsSetGradeTermCount(2, '2026-2027'))
        .rejects.toThrow('Sign in with an active School Admin account and deploy the latest firestore.rules');
    } finally {
      collectionSpy.mockRestore();
    }
  });

  it('reads and updates grading type and letter equivalencies for a specific grade in the selected year', async () => {
    const savedDocument = {
      schoolYear: '2026-2027',
      gradeLevels: {
        grade3: {
          gradeLevel: 'Grade 3',
          gradingType: 'letter',
          letterScale: [{ letter: 'A', min: 90, max: 100 }],
        },
      },
    };
    const yearTermRef = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => savedDocument }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => ({ doc: vi.fn(() => yearTermRef) })) })) };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      const settings = await firestoreApi.fsGetGradeLevelGradingConfigurations('2026-2027');
      expect(settings.gradeLevels.grade3).toMatchObject({
        gradeLevel: 'Grade 3',
        gradingType: 'letter',
        letterScale: [{ letter: 'A', min: 90, max: 100 }],
      });
      await firestoreApi.fsSetGradeLevelGradingConfiguration('2026-2027', 'Grade 4', {
        gradingType: 'numerical',
        finalGradeMode: 'manual',
      });
      expect(yearTermRef.set).toHaveBeenCalledWith(expect.objectContaining({
        schoolYear: '2026-2027',
        gradeLevels: expect.objectContaining({
          grade3: savedDocument.gradeLevels.grade3,
          grade4: {
            gradeLevel: 'Grade 4',
            gradingType: 'numerical',
            letterScale: [
              { letter: 'A', min: 90, max: 100 },
              { letter: 'B', min: 80, max: 89 },
              { letter: 'C', min: 70, max: 79 },
              { letter: 'D', min: 60, max: 69 },
              { letter: 'F', min: 0, max: 59 },
            ],
            finalGradeMode: 'manual',
          },
        }),
      }), { merge: true });
    } finally {
      collectionSpy.mockRestore();
    }
  });

  it('copies grade-level grading profiles into a new school-year document', async () => {
    const sourceRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          gradeLevels: {
            grade3: {
              gradeLevel: 'Grade 3',
              gradingType: 'letter',
              letterScale: [{ letter: 'A+', min: 90, max: 100 }],
              finalGradeMode: 'automatic',
            },
          },
        }),
      }),
    };
    const targetRef = { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }), set: vi.fn().mockResolvedValue(undefined) };
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'settings') {
        return {
          doc: vi.fn(() => ({
            collection: vi.fn(() => ({
              doc: vi.fn((year) => year === '2026-2027' ? sourceRef : targetRef),
            })),
          })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    try {
      await expect(firestoreApi.fsCopyGradeLevelGradingConfigurations('2026-2027', '2027-2028'))
        .resolves.toBe(1);
      expect(targetRef.set).toHaveBeenCalledWith(expect.objectContaining({
        schoolYear: '2027-2028',
        gradeLevels: {
          grade3: {
            gradeLevel: 'Grade 3',
            gradingType: 'letter',
            letterScale: [{ letter: 'A+', min: 90, max: 100 }],
            finalGradeMode: 'automatic',
          },
        },
      }), { merge: true });
    } finally {
      collectionSpy.mockRestore();
    }
  });
});

describe('teacher assignment history', () => {
  it('updates only the selected year while retaining other assignment years', async () => {
    const oldAssignment = { schoolYear: '2025-2026', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Teacher One' };
    const targetAssignment = { schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'B', teacherName: 'Teacher One' };
    const historyRefs = new Map();
    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ role: 'Teacher', teacherAssignments: [oldAssignment] }),
      }),
      collection: vi.fn(() => ({
        doc: vi.fn((year) => {
          if (!historyRefs.has(year)) historyRefs.set(year, { id: `history-${year}` });
          return historyRefs.get(year);
        }),
      })),
    };
    const writes = [];
    const collectionSpy = vi.spyOn(mockDb, 'collection').mockImplementation((name) => {
      if (name === 'users') return { doc: vi.fn(() => userRef) };
      if (name === 'schoolYears') {
        const teacherRef = { set: vi.fn() };
        const sectionRef = { set: vi.fn(), collection: vi.fn(() => ({ doc: vi.fn(() => teacherRef) })) };
        const gradeCollection = {
          get: vi.fn().mockResolvedValue({ docs: [] }),
          doc: vi.fn(() => ({
            set: vi.fn(),
            collection: vi.fn(() => ({ doc: vi.fn(() => sectionRef) })),
          })),
        };
        return {
          get: vi.fn().mockResolvedValue({ docs: [] }),
          doc: vi.fn(() => ({ collection: vi.fn(() => gradeCollection) })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    const batchSpy = vi.spyOn(mockDb, 'batch').mockImplementation(() => {
      const batch = {
        set: vi.fn((ref, data, options) => { writes.push({ ref, data, options }); return batch; }),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      return batch;
    });

    try {
      await firestoreApi.fsUpdateUser('teacher-1', {
        name: 'Teacher One',
        email: 'teacher@example.edu',
        role: 'Teacher',
        status: 'Active',
        teacherAssignmentSchoolYear: '2026-2027',
        teacherAssignments: [targetAssignment],
      });

      const profileWrite = writes.find((write) => write.ref === userRef);
      expect(profileWrite?.data.teacherAssignments).toEqual([oldAssignment, targetAssignment]);
      expect(profileWrite?.data.teacherAssignment).toEqual(targetAssignment);
      expect(writes).toContainEqual(expect.objectContaining({
        ref: historyRefs.get('2025-2026'),
        data: expect.objectContaining({ schoolYear: '2025-2026', assignments: [oldAssignment] }),
      }));
      expect(writes).toContainEqual(expect.objectContaining({
        ref: historyRefs.get('2026-2027'),
        data: expect.objectContaining({ schoolYear: '2026-2027', assignments: [targetAssignment] }),
      }));
    } finally {
      collectionSpy.mockRestore();
      batchSpy.mockRestore();
    }
  });
});

describe('visitor session handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the login page accessible when a stale guest session is left behind', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() - 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: '', uid: 'guest', role: 'Visitor' }));

    expect(isVisitorSession()).toBe(false);
  });

  it('prefers a real signed-in user over a stale visitor marker', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123' }));

    expect(isVisitorSession()).toBe(false);
    expect(localStorage.getItem('lps_guest_session')).toBeNull();
    expect(sessionStorage.getItem('lps_guest_session')).toBeNull();
  });

  it('treats a real user profile as authenticated even when the visitor marker is still present', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test' }));

    expect(isVisitorSession()).toBe(false);
    expect(localStorage.getItem('lps_guest_session')).toBeNull();
    expect(sessionStorage.getItem('lps_guest_session')).toBeNull();
  });

  it('creates a visitor session immediately when the visitor flow is started', () => {
    window.history.pushState({}, '', '/');

    expect(ensureVisitorSession(true)).toBe(true);
    expect(isVisitorSession()).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('lps_user_profile') || '{}')).toMatchObject({ uid: 'guest', role: 'Visitor' });
  });

  it('hides the dashboard welcome copy for visitor sessions', async () => {
    document.body.innerHTML = `
      <section class="dashboard-context">
        <div>
          <p class="dashboard-welcome" id="dashboardWelcome">Welcome</p>
          <p class="dashboard-context-title">Your operational overview</p>
        </div>
        <div class="dashboard-scope" id="dashboardScope">School-wide registrar view</div>
      </section>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: '', uid: 'guest', role: 'Visitor' }));
    sessionStorage.setItem('lps_guest_session', '1');
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));

    const { renderDashboardContext } = await import('./dashboard');
    renderDashboardContext();

    expect(document.querySelector('.dashboard-context')).toBeNull();
  });

  it('uses the live staff learner snapshot without waiting for public stats', async () => {
    document.body.innerHTML = `
      <div id="demoBanner"></div>
      <div id="statGrid"></div>
      <div id="donutSvg"></div>
      <div id="donutLegend"></div>
      <div id="gradeBarChart"></div>
      <div id="recentTableBody"></div>
      <div id="programSummary"></div>
      <div id="lastSynced"></div>
    `;

    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      uid: 'admin-123',
      email: 'admin@school.test',
      role: 'School Admin',
    }));
    vi.spyOn(firestoreApi, 'fsGetPublicStats').mockResolvedValue({
      totalLearners: 1,
      maleCount: 1,
      femaleCount: 0,
      fourPsCount: 0,
      ipCount: 0,
      snedCount: 0,
      aralCount: 0,
      muslimCount: 0,
      notTaggedCount: 1,
      gradeLevels: [{ label: 'Grade 1', value: 1 }],
      recentLearners: [],
      schoolYear: '2026-2027',
    });
    vi.spyOn(firestoreApi, 'fsSubscribeLearners').mockImplementation((_year, onChange) => {
      onChange([{
        firstName: 'Chloe',
        lastName: 'Reyes',
        gradeLevel: 'Grade 3',
        section: 'Onyx',
        dateAdded: new Date('2026-10-13T00:00:00Z'),
      }]);
      return () => { };
    });
    LPSApi.getDashboardSummary = vi.fn().mockRejectedValue(new Error('stalled'));

    await loadDashboardData('2026-2027');

    expect(document.getElementById('lastSynced')?.textContent).toContain('Live from Firestore');
    expect(document.getElementById('statGrid')?.innerHTML).toContain('1');
    expect(document.getElementById('recentTableBody')?.textContent).toContain('Reyes');
  });

  it('updates the staff dashboard from live learner snapshots', async () => {
    document.body.innerHTML = `
      <div id="demoBanner"></div>
      <div id="statGrid"></div>
      <div id="donutSvg"></div>
      <div id="donutLegend"></div>
      <div id="gradeBarChart"></div>
      <div id="recentTableBody"></div>
      <div id="programSummary"></div>
      <div id="lastSynced"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      uid: 'admin-123',
      email: 'admin@school.test',
      role: 'School Admin',
    }));
    vi.spyOn(firestoreApi, 'fsGetPublicStats').mockResolvedValue({
      totalLearners: 1,
      maleCount: 1,
      femaleCount: 0,
      fourPsCount: 0,
      ipCount: 0,
      snedCount: 0,
      aralCount: 0,
      muslimCount: 0,
      notTaggedCount: 1,
      gradeLevels: [{ label: 'Grade 1', value: 1 }],
      recentLearners: [],
      schoolYear: '2026-2027',
    });
    let updateLearners;
    vi.spyOn(firestoreApi, 'fsSubscribeLearners').mockImplementation((_year, onChange) => {
      updateLearners = onChange;
      onChange([{
        firstName: 'Ana',
        lastName: 'Dela Cruz',
        gradeLevel: 'Grade 1',
        section: 'A',
        dateAdded: new Date('2026-09-14T00:00:00Z'),
      }]);
      return () => { };
    });

    await loadDashboardData('2026-2027');

    expect(document.getElementById('recentTableBody')?.textContent).toContain('Dela Cruz');
    updateLearners([{
      firstName: 'Chloe',
      lastName: 'Reyes',
      gradeLevel: 'Grade 3',
      section: 'Onyx',
      dateAdded: new Date('2026-10-13T00:00:00Z'),
    }]);
    expect(document.getElementById('recentTableBody')?.textContent).toContain('Reyes');
    expect(document.getElementById('recentTableBody')?.textContent).not.toContain('Dela Cruz');
  });

  it('shows only current-year teacher advisory assignments in the dashboard context', async () => {
    document.body.innerHTML = `
      <section class="dashboard-context">
        <div>
          <p class="dashboard-welcome" id="dashboardWelcome">Welcome</p>
        </div>
        <div class="dashboard-scope" id="dashboardScope"></div>
      </section>
    `;

    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'C' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
        { schoolYear: '2025-2026', gradeLevel: 'Grade 3', section: 'Gold' },
      ],
    }));

    const { renderDashboardContext } = await import('./dashboard');
    renderDashboardContext('2026-2027');

    const scope = document.getElementById('dashboardScope');
    expect(scope?.textContent).toContain('2026-2027');
    expect(scope?.textContent).toContain('Grade 1');
    expect(scope?.textContent).toContain('Section A');
    expect(scope?.textContent).toContain('Section C');
    expect(scope?.textContent).toContain('Grade 5');
    expect(scope?.textContent).toContain('Section B');
    expect(scope?.textContent).not.toContain('2025-2026');
    expect(scope?.textContent).not.toContain('Section Gold');
    expect(scope?.querySelectorAll('.dashboard-coverage-year')).toHaveLength(1);
    expect(scope?.querySelectorAll('.dashboard-coverage-assignment')).toHaveLength(3);
    expect(scope?.querySelector('.dashboard-coverage-count')?.textContent).toBe('3 assigned sections');
  });

  it('does not show historical assignment rows before current school year loads', async () => {
    const appConfigModule = await import('./app-config');
    const previousProfile = appConfigModule.APP_USER_PROFILE;
    document.body.innerHTML = `
      <section class="dashboard-context">
        <p class="dashboard-welcome" id="dashboardWelcome">Welcome</p>
        <div class="dashboard-scope" id="dashboardScope"></div>
      </section>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      role: 'Teacher',
      teacherAssignments: [{ schoolYear: '2025-2026', gradeLevel: 'Grade 3', section: 'Gold' }],
    }));
    setAppUserProfile({
      role: 'Teacher',
      teacherAssignments: [{ schoolYear: '2025-2026', gradeLevel: 'Grade 3', section: 'Gold' }],
    });

    try {
      const { renderDashboardContext } = await import('./dashboard');
      renderDashboardContext();

      expect(document.getElementById('dashboardScope')?.textContent).toContain('Loading current school-year assignments');
      expect(document.getElementById('dashboardScope')?.textContent).not.toContain('Section Gold');
    } finally {
      setAppUserProfile(previousProfile);
    }
  });

  it('limits teacher learner grade and section choices to their assigned coverage', async () => {
    document.body.innerHTML = `
      <form id="learnerForm">
        <div class="field-grid">
          <div class="field"><select id="f_gradeLevel"><option value="">Select…</option></select></div>
          <div class="field"><input id="f_section" /></div>
        </div>
      </form>
    `;

    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'B' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'C' },
      ],
    }));

    const { applyTeacherLearnerScope, teacherAssignedGradeOptions, teacherAssignedSectionsForGrade } = await import('./learner-list');
    const scope = applyTeacherLearnerScope();

    expect(scope).toHaveLength(3);
    expect(teacherAssignedGradeOptions()).toEqual(['Grade 1', 'Grade 5']);
    expect(teacherAssignedSectionsForGrade('Grade 1')).toEqual(['A', 'B']);
    expect(teacherAssignedSectionsForGrade('Grade 5')).toEqual(['C']);
    expect(document.getElementById('f_teacherAssignment')).not.toBeNull();
    expect(document.getElementById('f_teacherAssignment')?.options.length).toBe(3);
  });

  it('does not duplicate the first advisory assignment when both field layouts exist', async () => {
    const { teacherAssignmentsForProfile } = await import('./app-config');
    // The admin console mirrors the first list item into `teacherAssignment`,
    // so legacy + current fields both being present must NOT double the list.
    const assignments = teacherAssignmentsForProfile({
      role: 'Teacher',
      teacherAssignment: { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
      ],
    });

    expect(assignments.map((a) => `${a.gradeLevel} ${a.section}`)).toEqual(['Grade 1 A', 'Grade 5 B']);
  });

  it('falls back to the legacy single assignment field when the list is absent', async () => {
    const { teacherAssignmentsForProfile } = await import('./app-config');
    const assignments = teacherAssignmentsForProfile({
      role: 'Teacher',
      teacherAssignment: { schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'C' },
    });

    expect(assignments.map((a) => `${a.gradeLevel} ${a.section}`)).toEqual(['Grade 2 C']);
  });

  it('builds a rules-matching security key regardless of extra fields on the assignment (regression: teacherName previously broke map-equality checks in firestore.rules)', async () => {
    const { teacherAssignmentSecurityKey, teacherAssignmentSecurityKeys } = await import('./app-config');

    // The stored assignment always carries teacherName once saved through the
    // admin console — the key must ignore it and depend only on
    // schoolYear/gradeLevel/section, matching learnerAssignmentKey() in
    // firestore.rules.
    expect(teacherAssignmentSecurityKey({ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Ms. Cruz' }))
      .toBe('2026-2027::Grade 1::A');

    // Missing any required part yields no key (never a partial/garbage key).
    expect(teacherAssignmentSecurityKey({ schoolYear: '2026-2027', gradeLevel: 'Grade 1' })).toBeNull();

    // A multi-section teacher gets one de-duplicated key per assignment.
    const keys = teacherAssignmentSecurityKeys([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Ms. Cruz' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Ms. Cruz' },
      { schoolYear: '2026-2027', gradeLevel: ' Grade 1 ', section: ' A ', teacherName: 'Ms. Cruz' },
    ]);
    expect(keys).toEqual(['2026-2027::Grade 1::A', '2026-2027::Grade 5::B']);
  });

  it('stores teacher coverage in a normalized multi-section shape that avoids legacy duplicate keys', async () => {
    const { normalizeTeacherAssignmentsForStorage } = await import('./app-config');
    const assignments = normalizeTeacherAssignmentsForStorage([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-1', sectionKey: 'a' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-5', sectionKey: 'b' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-1', sectionKey: 'a' },
    ]);

    expect(assignments).toEqual([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Jane Teacher' },
    ]);
  });

  it('keeps a teacher scoped to their assignments even when the profile has no teacherName stored', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      uid: 'teacher-uid-123',
      userId: 'teacher-uid-123',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
      ],
    }));

    const { fsTeacherAssignments_ } = await import('./firestore-api');
    const assignments = fsTeacherAssignments_();

    expect(assignments).toHaveLength(2);
    expect(assignments.map((assignment) => `${assignment.gradeLevel}-${assignment.section}`)).toEqual(['Grade 1-A', 'Grade 5-B']);
    expect(assignments.every((assignment) => assignment.teacherName === 'Jane Teacher')).toBe(true);
  });

  describe('teacher archive reads use canonical Firestore collections', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      sessionStorage.clear();
      localStorage.clear();
    });

    it('reads a teacher transfer list from canonical learner/archive stores', async () => {
      sessionStorage.setItem('lps_user_profile', JSON.stringify({
        email: 'teacher@test.edu',
        uid: 'teacher-1',
        name: 'Jane Teacher',
        role: 'Teacher',
        teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
      }));

      const firestoreApi = await import('./firestore-api');
      const { db } = await import('./firebase');
      const collectionNames = [];
      const learnersQuery = {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: [{ id: 'lrn-0001', data: () => ({ learnerId: 'lrn-0001', gradeLevel: 'Grade 1', section: 'A', transferType: 'Transfer In', transferIn: true }) }],
            }),
          })),
        })),
      };
      vi.spyOn(db, 'collection').mockImplementation((name) => {
        collectionNames.push(name);
        if (name === 'schoolYears') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn((collectionName) => collectionName === 'learners'
                ? learnersQuery
                : { get: vi.fn().mockResolvedValue({ docs: [] }) }),
            })),
          };
        }
        return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
      });

      const records = await firestoreApi.fsGetTransferRecords('2026-2027');
      expect(collectionNames).not.toContain('advisory');
      expect(collectionNames).toContain('schoolYears');
      expect(records.some((record) => record.learnerId === 'lrn-0001')).toBe(true);
    });

    it('reads a teacher dropout list from canonical learner/archive stores', async () => {
      sessionStorage.setItem('lps_user_profile', JSON.stringify({
        email: 'teacher@test.edu',
        uid: 'teacher-1',
        name: 'Jane Teacher',
        role: 'Teacher',
        teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
      }));

      const firestoreApi = await import('./firestore-api');
      const { db } = await import('./firebase');
      const collectionNames = [];
      const learnersQuery = {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: [{ id: 'lrn-0002', data: () => ({ learnerId: 'lrn-0002', gradeLevel: 'Grade 1', section: 'A', enrollmentStatus: 'DROPPED_OUT', eosyStatus: 'Dropped Out' }) }],
            }),
          })),
        })),
      };
      vi.spyOn(db, 'collection').mockImplementation((name) => {
        collectionNames.push(name);
        if (name === 'schoolYears') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn((collectionName) => collectionName === 'learners'
                ? learnersQuery
                : { get: vi.fn().mockResolvedValue({ docs: [] }) }),
            })),
          };
        }
        return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
      });

      const records = await firestoreApi.fsGetArchiveRecords('dropout', '2026-2027');
      expect(collectionNames).not.toContain('advisory');
      expect(collectionNames).toContain('schoolYears');
      expect(records.some((record) => record.learnerId === 'lrn-0002')).toBe(true);
    });

    it('atomically restores an archived learner and clears movement fields', async () => {
      const archivedData = {
        learnerId: 'lrn-0003',
        firstName: 'Alex',
        gradeLevel: 'Grade 2',
        transferType: 'Transfer Out',
        transferOut: true,
        transferSchool: 'Other School',
        enrollmentStatus: 'TRANSFERRED_OUT',
        unrelatedField: 'preserved',
      };
      const archivedRef = {
        get: vi.fn().mockResolvedValue({ exists: true, data: () => archivedData }),
      };
      const learnerRef = {
        get: vi.fn().mockResolvedValue({ exists: false }),
      };
      const writes = [];
      const batch = {
        set: vi.fn((ref, data) => { writes.push({ type: 'set', ref, data }); return batch; }),
        delete: vi.fn((ref) => { writes.push({ type: 'delete', ref }); return batch; }),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(mockDb, 'collection').mockReturnValue({
        doc: vi.fn(() => ({
          collection: vi.fn((name) => ({
            doc: vi.fn(() => name === 'learners' ? learnerRef : archivedRef),
          })),
        })),
      });
      vi.spyOn(mockDb, 'batch').mockReturnValue(batch);
      vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({});
      vi.useFakeTimers();

      try {
        const result = await firestoreApi.fsCancelLearnerMovement('transferredOut', '2026-2027', 'lrn-0003');

        expect(result).toEqual({ restored: true, learnerId: 'lrn-0003' });
        expect(writes).toEqual([
          {
            type: 'set',
            ref: learnerRef,
            data: expect.objectContaining({
              learnerId: 'lrn-0003',
              schoolYear: '2026-2027',
              gradeLevel: 'Grade 2',
              unrelatedField: 'preserved',
              enrollmentStatus: 'ACTIVE',
              eosyStatus: '',
              transferType: '',
              transferIn: false,
              transferOut: false,
              transferSchool: '',
              transferDate: '',
              transferReason: '',
              transferNotes: '',
            }),
          },
          { type: 'delete', ref: archivedRef },
        ]);
        expect(batch.commit).toHaveBeenCalledOnce();
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('clears a legacy dropout in place without removing the learner document', async () => {
      const learnerData = {
        learnerId: 'lrn-0004',
        firstName: 'Sam',
        enrollmentStatus: 'DROPPED_OUT',
        eosyStatus: 'Dropped Out',
        transferOut: true,
        transferNotes: 'old note',
        unrelatedField: 'preserved',
      };
      const learnerRef = {
        get: vi.fn().mockResolvedValue({ exists: true, data: () => learnerData }),
        set: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(mockDb, 'collection').mockReturnValue({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({ doc: vi.fn(() => learnerRef) })),
        })),
      });
      vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({});
      mockDb.batch.mockClear();
      vi.useFakeTimers();

      try {
        await firestoreApi.fsCancelLearnerMovement('learners', '2026-2027', 'lrn-0004');

        expect(learnerRef.set).toHaveBeenCalledWith(expect.objectContaining({
          learnerId: 'lrn-0004',
          schoolYear: '2026-2027',
          enrollmentStatus: 'ACTIVE',
          eosyStatus: '',
          transferOut: false,
          transferNotes: '',
          unrelatedField: 'preserved',
        }));
        expect(mockDb.batch).not.toHaveBeenCalled();
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('renders cancellation actions for transfer and dropout records', async () => {
      const { renderTransferTable } = await import('./transfer-info');
      const { dropoutRecords, renderDropout } = await import('./dropout');
      document.body.innerHTML = '<table><tbody id="transferTableBody"></tbody></table><span id="transferPageInfo"></span><div id="transferPagerBtns"></div>';

      renderTransferTable([{
        learnerId: 'lrn-0005',
        firstName: 'Taylor',
        lastName: 'Learner',
        transferType: 'Transfer Out',
      }]);
      expect(document.querySelector('[data-transfer-cancel="lrn-0005"]')).not.toBeNull();

      document.body.innerHTML = '<div id="dropoutSearch"></div><div id="dropoutGradeFilter"></div><div id="dropoutGenderFilter"></div><div id="dropoutSummary"></div><table><tbody id="dropoutTableBody"></tbody></table><span id="dropoutPageInfo"></span><div id="dropoutPagerBtns"></div>';
      dropoutRecords.splice(0, dropoutRecords.length, {
        learnerId: 'lrn-0006',
        firstName: 'Morgan',
        lastName: 'Learner',
        eosyStatus: 'Dropped Out',
      });
      window.dropoutSearch = '';
      renderDropout();
      expect(document.querySelector('[data-dropout-cancel="lrn-0006"]')).not.toBeNull();
      dropoutRecords.length = 0;
    });

    it('paginates transfer and promotion lists with the shared page-number controls', async () => {
      const transfer = await import('./transfer-info');
      const promotion = await import('./promotion');
      document.body.innerHTML = '<table><tbody id="transferTableBody"></tbody></table><span id="transferPageInfo"></span><div id="transferPagerBtns"></div>';
      transfer.transferRecords.splice(0, transfer.transferRecords.length, ...Array.from({ length: 20 }, (_, index) => ({
        learnerId: `transfer-${index}`,
        firstName: `Learner${index}`,
        transferType: 'Transfer In',
      })));
      transfer.renderTransferTable(transfer.filterTransferRecords(transfer.transferRecords));
      expect(document.querySelectorAll('#transferTableBody tr')).toHaveLength(15);
      expect(document.getElementById('transferPageInfo')?.textContent).toBe('1-15 of 20');
      document.querySelector<HTMLButtonElement>('#transferPagerBtns button[aria-label="Next page"]')?.click();
      expect(document.querySelectorAll('#transferTableBody tr')).toHaveLength(5);
      expect(document.getElementById('transferPageInfo')?.textContent).toBe('16-20 of 20');

      document.body.innerHTML = '<div id="promotionSummary"></div><span id="promotionResultCount"></span><table><tbody id="promotionTableBody"></tbody></table><span id="promotionPageInfo"></span><div id="promotionPagerBtns"></div>';
      promotion.promotionRecords.splice(0, promotion.promotionRecords.length, ...Array.from({ length: 20 }, (_, index) => ({
        learnerId: `promoted-${index}`,
        firstName: `Learner${index}`,
        eosyStatus: 'Promoted',
      })));
      promotion.renderPromotion();
      expect(document.querySelectorAll('#promotionTableBody tr')).toHaveLength(15);
      expect(document.querySelector('[data-promotion-select="promoted-0"]')).not.toBeNull();
      document.querySelector<HTMLButtonElement>('#promotionPagerBtns button[aria-label="Next page"]')?.click();
      expect(document.querySelectorAll('#promotionTableBody tr')).toHaveLength(5);
      expect(document.getElementById('promotionPageInfo')?.textContent).toBe('16-20 of 20');
      transfer.transferRecords.length = 0;
      promotion.promotionRecords.length = 0;
    });
  });

  it('rejects duplicate user records before creating a second Firebase auth account', async () => {
    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      if (name === 'users') {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ empty: false, docs: [{ id: 'existing-user' }] })),
            })),
          })),
          doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn() })),
        };
      }
      return {
        doc: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })),
      };
    });

    await expect(firestoreApi.fsAddUser({
      name: 'Existing User',
      email: 'existing@example.com',
      password: '123456',
      role: 'Teacher',
      status: 'Active',
    })).rejects.toThrow('already exists');
  });

  it('keeps the Firestore profile when Firebase Authentication deletion fails', async () => {
    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    const deleteDoc = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(db, 'collection').mockImplementation((name) => {
      if (name === 'users') {
        return {
          doc: vi.fn((userId) => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'School Admin', status: 'Active' }) }),
            delete: deleteDoc,
          })),
        };
      }
      return {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn(), delete: vi.fn() })),
      };
    });

    const { LPSApi } = await import('./sheets-api');
    vi.spyOn(LPSApi, 'deleteAuthUsers').mockRejectedValue(new Error('Firebase Authentication unavailable'));

    await expect(firestoreApi.fsDeleteUser('u-123')).rejects.toThrow('Firebase Authentication unavailable');
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('explains when the tenant AuditLog Apps Script is not configured for account removal', async () => {
    await expect(LPSApi.deleteAuthUsers(['u-123']))
      .rejects.toThrow('The AuditLog Apps Script service is not configured for this school. The Firestore profile was not removed.');
  });

  it('allows an admin to remove another School Admin account', async () => {
    const { db, auth } = await import('./firebase');
    const deleteDoc = vi.fn().mockResolvedValue(undefined);
    const getProfile = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ role: 'School Admin', status: 'Active' }),
    });
    vi.spyOn(db, 'collection').mockImplementation((name) => name === 'users'
      ? { doc: vi.fn(() => ({ get: getProfile, delete: deleteDoc })) }
      : { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn(), delete: vi.fn() })) });
    const deleteAuthSpy = vi.spyOn(LPSApi, 'deleteAuthUsers').mockResolvedValue({ deletedUserIds: ['other-admin'] });
    auth.currentUser = { uid: 'current-admin' };

    try {
      await expect(firestoreApi.fsDeleteUser('other-admin')).resolves.toEqual({ deleted: true });
      expect(deleteAuthSpy).toHaveBeenCalledWith(['other-admin']);
      expect(deleteDoc).toHaveBeenCalledOnce();
    } finally {
      auth.currentUser = null;
      deleteAuthSpy.mockRestore();
    }
  });

  it('prevents an admin from deleting their own account directly or in bulk', async () => {
    const firestoreApi = await import('./firestore-api');
    const { auth } = await import('./firebase');
    auth.currentUser = { uid: 'admin-123' };

    await expect(firestoreApi.fsDeleteUser('admin-123')).rejects.toThrow(
      'You cannot delete your own account. Ask another School Admin to remove it.',
    );
    await expect(firestoreApi.fsDeleteUsers(['teacher-1', 'admin-123'])).rejects.toThrow(
      'You cannot delete your own account. Ask another School Admin to remove it.',
    );

    auth.currentUser = null;
  });

  it('shows a learner even when the recent list has no valid dateAdded value', () => {
    document.body.innerHTML = '<div id="recentTableBody"></div>';

    renderRecentTable([{ firstName: 'Ana', lastName: 'Dela Cruz', gradeLevel: 'Grade 1', section: 'A', dateAdded: '' }]);

    expect(document.getElementById('recentTableBody')?.textContent).toContain('Dela Cruz');
    expect(document.getElementById('recentTableBody')?.textContent).not.toContain('No learners added yet.');
  });

  it('renders the newest public stats snapshot alongside fresh recent learners', async () => {
    const { renderDashboardSummary } = await import('./dashboard');

    document.body.innerHTML = `
      <div id="demoBanner"></div>
      <div id="statGrid"></div>
      <div id="donutSvg"></div>
      <div id="donutLegend"></div>
      <div id="gradeBarChart"></div>
      <div id="recentTableBody"></div>
      <div id="programSummary"></div>
      <div id="lastSynced"></div>
    `;

    renderDashboardSummary({
      totalLearners: 20,
      maleCount: 11,
      femaleCount: 9,
      fourPsCount: 4,
      ipCount: 0,
      snedCount: 0,
      aralCount: 0,
      muslimCount: 0,
      notTaggedCount: 16,
      gradeLevels: [{ label: 'Grade 1', value: 20 }],
      recentLearners: [],
      updatedAt: { toDate: () => new Date('2026-09-14T00:00:00Z') },
    }, [{ firstName: 'Ana', lastName: 'Dela Cruz', gradeLevel: 'Grade 1', section: 'A', dateAdded: new Date('2026-09-14T00:00:00Z') }]);

    expect(document.getElementById('statGrid')?.textContent).toContain('20');
    expect(document.getElementById('recentTableBody')?.textContent).toContain('Dela Cruz');
    expect(document.getElementById('lastSynced')?.textContent).toContain('2026');
  });

  it('deletes a learner through the Firestore delete path when the masterlist confirms removal', async () => {
    document.body.innerHTML = `
      <div id="deleteModalBackdrop" class="is-open"></div>
      <button id="deleteModalConfirm"></button>
    `;
    vi.spyOn(demoData, 'isSheetsApiConfigured').mockReturnValue(false);
    const deleteLearnerSpy = vi.spyOn(firestoreApi, 'fsDeleteLearner').mockResolvedValue({ deleted: true });
    const deleteLearnersSpy = vi.spyOn(firestoreApi, 'fsDeleteLearners').mockResolvedValue({ deleted: 2 });
    vi.spyOn(LPSApi, 'deleteLearner').mockResolvedValue({ deleted: true });
    vi.spyOn(LPSApi, 'deleteLearners').mockResolvedValue({ deleted: 2 });

    const { LL, confirmDelete } = await import('./learner-list');
    LL.loadedSchoolYear = '2026-2027';
    LL.deletingId = 'LRN-001';
    LL.deletingName = 'Ana Dela Cruz';
    LL.selectedIds.clear();

    await confirmDelete();

    expect(deleteLearnerSpy).toHaveBeenCalledWith('2026-2027', 'LRN-001');
    expect(deleteLearnersSpy).not.toHaveBeenCalled();
  });

  it('deletes the correct learner document for a real "YYYY-YYYY" school year (regression: a school-year-shaped ID must never be mistaken for the learner ID)', async () => {
    const ref = { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ learnerId: 'LRN-001' }) }), delete: vi.fn().mockResolvedValue(undefined) };
    const recordsCollection = { doc: vi.fn(() => ref) };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ collection: vi.fn(() => recordsCollection) })),
    }));
    vi.spyOn(firestoreApi, 'fsRefreshPublicStats').mockResolvedValue({ updatedAt: new Date() });

    await firestoreApi.fsDeleteLearner('2026-2027', 'LRN-001');

    expect(ref.delete).toHaveBeenCalled();
    expect(recordsCollection.doc).toHaveBeenCalledWith('LRN-001');
  });

  it('throws instead of silently no-oping when the learner document no longer exists', async () => {
    const ref = { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }), delete: vi.fn().mockResolvedValue(undefined) };
    const recordsCollection = { doc: vi.fn(() => ref) };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ collection: vi.fn(() => recordsCollection) })),
    }));

    await expect(firestoreApi.fsDeleteLearner('2026-2027', 'LRN-404')).rejects.toThrow();
    expect(ref.delete).not.toHaveBeenCalled();
  });

  it('uses the stored profile role instead of leaving the role as "Loading role…"', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123', role: 'School Admin' }));

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
  });

  it('prefers the real Firestore profile name and admin role over the email-based fallback', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'admin@school.test',
      uid: 'user-123',
      name: 'Example Admin',
      role: 'School Admin',
    }));

    const { renderShell } = await import('./shell');
    renderShell('settings', 'Settings');

    expect(document.querySelector('.topbar-user-text .name')?.textContent).toBe('Example Admin');
    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    expect(document.querySelector('.account-menu')).toBeNull();
    const settingsLink = document.querySelector<HTMLAnchorElement>('.sidebar-nav .nav-item[href="pages/settings.html"]');
    expect(settingsLink?.textContent).toContain('Settings');
    expect(settingsLink?.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('.sidebar-nav a[href="pages/manage-users.html"]')).toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-category-trigger'), (button) => button.textContent?.trim())).toEqual([
      expect.stringContaining('Programs'),
      expect.stringContaining('Nutrition'),
      expect.stringContaining('Statistics'),
      expect.stringContaining('Profiles'),
      expect.stringContaining('Movement'),
      expect.stringContaining('Utilities'),
    ]);
    expect(document.querySelector('.nav-category[data-nav-category] a[href="pages/data.html"]')?.textContent).toContain('Data');
    const movementLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav-category[data-nav-category] a[href="pages/promotion.html"], .nav-category[data-nav-category] a[href="pages/retention.html"], .nav-category[data-nav-category] a[href="pages/transfer-info.html"], .nav-category[data-nav-category] a[href="pages/dropout.html"]'));
    expect(movementLinks.map((link) => link.textContent?.trim())).toEqual(["Promotion", "Retention", "Transfer Info", "Dropout Info"]);
    expect(movementLinks.map((link) => link.getAttribute("href"))).toEqual(["pages/promotion.html", "pages/retention.html", "pages/transfer-info.html", "pages/dropout.html"]);
    expect(movementLinks[0]?.closest('.nav-category')?.querySelector('.nav-category-trigger')?.textContent).toContain('Movement');
    expect(document.querySelector('.nav-feedback a[href="pages/feedback.html"]')?.textContent).toContain('Feedback');

    document.getElementById('menuToggle')?.click();
    expect(document.getElementById('sidebar')?.classList.contains('is-open')).toBe(true);
    expect(document.getElementById('sidebarBackdrop')?.classList.contains('is-visible')).toBe(true);
    const programsCategory = document.querySelector<HTMLElement>('.nav-category[data-nav-category]');
    const programsTrigger = programsCategory?.querySelector<HTMLButtonElement>('.nav-category-trigger');
    programsTrigger?.click();
    expect(programsCategory?.classList.contains('is-open')).toBe(true);
    const programLink = programsCategory?.querySelector<HTMLAnchorElement>('a[href="pages/program-4ps.html"]');
    programLink?.addEventListener('click', (event) => event.preventDefault(), { once: true });
    programLink?.click();
    expect(programsCategory?.classList.contains('is-open')).toBe(false);
    expect(document.getElementById('sidebar')?.classList.contains('is-open')).toBe(false);
    expect(document.getElementById('sidebarBackdrop')?.classList.contains('is-visible')).toBe(false);
  });

  it('opens a full profile photo preview when its avatar is clicked', async () => {
    document.body.innerHTML = '<div id="profileAvatar"></div>';
    const avatar = document.getElementById('profileAvatar') as HTMLElement;
    const { renderProfileAvatar } = await import('./shell');

    const fetchPhoto = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, blob: async () => new Blob(['photo'], { type: 'image/png' }),
    } as Response);
    try {
      renderProfileAvatar(avatar, 'https://res.cloudinary.com/demo/image/upload/photo.jpg', 'admin@school.test');
      avatar.click();

      const viewer = document.querySelector('.profile-photo-viewer');
      expect(viewer).not.toBeNull();
      expect(viewer?.querySelector('[role="dialog"]')).not.toBeNull();
      await vi.waitFor(() => expect(viewer?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/));
      expect(fetchPhoto).toHaveBeenCalledWith(
        'https://res.cloudinary.com/demo/image/upload/c_limit,w_1200,h_1200,q_auto,f_auto/photo.jpg',
        expect.anything(),
      );
      expect(document.activeElement).toBe(viewer?.querySelector('button'));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.querySelector('.profile-photo-viewer')).toBeNull();
      expect(document.activeElement).toBe(avatar);
      avatar.click();
      expect(document.querySelector('.profile-photo-viewer img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      expect(fetchPhoto).toHaveBeenCalledTimes(2); // One thumbnail and one full-size photo.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } finally {
      fetchPhoto.mockRestore();
    }
  });

  it('opens account settings with password and username actions', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'admin@school.test',
      uid: 'user-123',
      name: 'Example Admin',
      role: 'School Admin',
    }));

    const { openAccountSettingsModal } = await import('./shell');
    openAccountSettingsModal();

    expect(document.getElementById('accountModalTitle')?.textContent).toBe('Account settings');
    expect(document.querySelectorAll('.account-settings-option')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('[data-account-action="password"]')?.click();
    expect(document.getElementById('accountModalTitle')?.textContent).toBe('Change password');
    expect(document.getElementById('accountCurrentPassword')).not.toBeNull();
  });

  it('renders the currently selected school logo in the shared dashboard sidebar', async () => {
    const previousSchool = localStorage.getItem('edash.activeSchool');
    localStorage.setItem('edash.activeSchool', JSON.stringify({
      id: 'sample-school',
      enabled: true,
      name: 'Sample School',
      nickname: 'Sample',
      logoUrl: '/assets/sample-school/logo.png',
      videoUrl: '',
      firebaseConfig: {
        apiKey: 'test-api-key',
        authDomain: 'sample-school.firebaseapp.com',
        projectId: 'sample-school',
        storageBucket: 'sample-school.appspot.com',
        messagingSenderId: '123456789',
        appId: 'test-app-id',
      },
      auditLogApiUrl: '',
      feedbackApiUrl: '',
    }));
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;

    try {
      const { renderShell } = await import('./shell');
      renderShell('dashboard', 'Dashboard');

      expect(document.querySelector<HTMLImageElement>('.sidebar-brand-mark img')?.getAttribute('src'))
        .toBe('/assets/sample-school/logo.png');
      expect(document.querySelector('.sidebar-brand-text .name')?.textContent).toBe('Sample');
    } finally {
      if (previousSchool === null) localStorage.removeItem('edash.activeSchool');
      else localStorage.setItem('edash.activeSchool', previousSchool);
    }
  });

  it('prefers the real Firestore role over a stale cached School Staff role when updating the username', async () => {
    const { buildUpdatedProfile } = await import('./shell');

    const profile = buildUpdatedProfile(
      { email: 'admin@school.test', uid: 'user-123', role: 'School Staff', name: 'Old Name' },
      { email: 'admin@school.test', uid: 'user-123', role: 'School Admin', name: 'Example Admin' },
      { name: 'Example Admin' }
    );

    expect(profile.role).toBe('School Admin');
    expect(profile.name).toBe('Example Admin');
  });
});

describe('learner name formatting', () => {
  it('capitalizes each word in parent or guardian names', () => {
    expect(sentenceCaseName('DELA CRUZ, JUAN')).toBe('Dela Cruz, Juan');
  });
});

describe('credential / role resolution', () => {
  const defaultCollection = () => ({ doc: vi.fn(() => ({ get: vi.fn() })) });

  beforeEach(() => {
    mockAuth.currentUser = null;
    mockAuth.onAuthStateChanged.mockImplementation(() => undefined);
    mockDb.collection.mockImplementation(defaultCollection);
  });

  it('keeps the Firestore override wired onto the shared LPSApi credentials path', async () => {
    const { LPSApi } = await import('./sheets-api');
    // auth.ts now loads firestore-api everywhere (even the login page), so the
    // credential lookup used by requireAuth/renderShell must be the Firestore
    // implementation — never the Sheets one that fails with an empty URL.
    expect(LPSApi.getMyProfile).toBe(firestoreApi.fsGetMyProfile);
  });

  it('resolves the profile from the passed Firebase user before auth restore', async () => {
    const docMock = {
      exists: true,
      id: 'user-123',
      data: () => ({ name: 'Example Admin', email: 'admin@school.test', role: 'School Admin', status: 'Active' }),
    };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(docMock) })),
    }));

    const profile = await firestoreApi.fsGetMyProfile({ uid: 'user-123', email: 'admin@school.test' });

    expect(profile.role).toBe('School Admin');
    expect(profile.uid).toBe('user-123');
    expect(profile.name).toBe('Example Admin');
    // No "Not signed in." even though firebase.auth().currentUser is null.
    expect(mockAuth.currentUser).toBeNull();
  });

  it('shows "Visitor" for a signed-in user with no Firestore profile document yet', async () => {
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false, id: 'brand-new-1', data: () => undefined }) })),
    }));

    const profile = await firestoreApi.fsGetMyProfile({ uid: 'brand-new-1', email: 'new.teacher@school.test' });

    expect(profile.role).toBe('Visitor');
  });

  it('preserves each supported visual theme when normalizing a user profile', async () => {
    for (const theme of ['Light', 'Dark', 'Dracula', 'Monokai', 'Beach', 'Nord', 'Forest', 'ClentIndustries Theme']) {
      mockDb.collection.mockImplementation(() => ({
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'user-theme',
            data: () => ({ role: 'School Admin', status: 'Active', teacherPrefs: { theme, inspectLearner: true } }),
          }),
        })),
      }));

      const profile = await firestoreApi.fsGetMyProfile({ uid: 'user-theme', email: 'admin@school.test' });
      expect(profile.teacherPrefs.theme).toBe(theme);
    }
  });

  it('keeps the stored role instead of flipping to "Role unavailable" when the fetch fails', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123', role: 'School Admin' }));
    // No currentUser and no passed user -> fsGetMyProfile throws -> the shell
    // must keep showing the role we already resolved, never the dead-end label.
    mockAuth.currentUser = null;

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    expect(document.getElementById('topbarRole')?.textContent).not.toBe('Role unavailable');
  });

  it('recovers the role once the Firebase session finishes restoring', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    // Fresh login: the session has no role yet and the auth session has not
    // been restored, so the first fetch fails. The shell must subscribe to the
    // auth state and retry instead of leaving "Role unavailable" forever.
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'retry-user-9' }));
    mockAuth.currentUser = null;
    mockAuth.onAuthStateChanged.mockImplementation((callback) => {
      Promise.resolve().then(() => callback({ uid: 'retry-user-9', email: 'admin@school.test' }));
      return () => { };
    });
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'retry-user-9',
          data: () => ({ name: 'Retry Admin', email: 'admin@school.test', role: 'School Admin', status: 'Active' }),
        }),
      })),
    }));

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    // The resolved role must be persisted so later page loads show it instantly.
    expect(JSON.parse(sessionStorage.getItem('lps_user_profile') || '{}').role).toBe('School Admin');
  });
});

describe('login page theme independence', () => {
  it('keeps the login page light even when a dark theme is applied to the document', async () => {
    // Simulate the state a dark-mode user would have: the inline index.html
    // scripts (or a previous authenticated page) added these classes.
    document.body.classList.add('dark-mode');
    document.documentElement.classList.add('dark-mode-preload');
    document.body.dataset.theme = 'clentindustries-theme';
    document.documentElement.dataset.theme = 'clentindustries-theme';

    const { forceLoginPageLightTheme } = await import('./auth');
    forceLoginPageLightTheme();

    expect(document.body.classList.contains('dark-mode')).toBe(false);
    expect(document.documentElement.classList.contains('dark-mode-preload')).toBe(false);
    expect(document.body.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('leaves the saved dark preference untouched so dashboards still use it', async () => {
    localStorage.setItem('lps_theme', 'dark');

    const { forceLoginPageLightTheme } = await import('./auth');
    forceLoginPageLightTheme();

    expect(localStorage.getItem('lps_theme')).toBe('dark');
  });

  it('uses the signed-in profile theme instead of a shared legacy browser theme', async () => {
    localStorage.setItem('lps_theme', 'clentindustries-theme');
    const { setAppUserProfile } = await import('./app-config');
    const { applySavedTheme } = await import('./shell');
    setAppUserProfile({ uid: 'account-light', teacherPrefs: { theme: 'Light' } });

    applySavedTheme();

    expect(document.body.dataset.theme).toBe('light');
    expect(document.body.classList.contains('dark-mode')).toBe(false);
    setAppUserProfile(null);
  });
});
