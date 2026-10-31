import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredSchool,
  getActiveSchool,
  getStoredSchool,
  getRegisteredSchool,
  isRegisteredSchool,
  sameSchoolRegistration,
  storeActiveSchool,
  storeParentPortalSchool,
} from './school-registry';

describe('school directory tenant selection', () => {
  const validSchool = {
    id: 'sample-school',
    enabled: true as const,
    name: 'Sample Elementary School',
    nickname: 'Sample ES',
    logoUrl: '/assets/sample-logo.png',
    videoUrl: '',
    firebaseConfig: {
      apiKey: 'test-api-key',
      authDomain: 'school.test',
      projectId: 'school-test',
      storageBucket: 'school-test.test',
      messagingSenderId: '123456',
      appId: 'test-app-id',
    },
    auditLogApiUrl: '',
    feedbackApiUrl: '',
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => { window.history.replaceState(null, '', '/'); sessionStorage.clear(); });

  it('pins a QR-link school only to its matching parent portal tab', () => {
    const parentSchool = { ...validSchool, id: 'parent-school' };
    storeActiveSchool(validSchool);
    storeParentPortalSchool(parentSchool);
    window.history.replaceState(null, '', '/parent/parent-school');
    expect(getStoredSchool()).toEqual(parentSchool);
    expect(getActiveSchool()).toEqual(parentSchool);
    expect(JSON.parse(localStorage.getItem('edash.activeSchool')!).id).toBe('sample-school');
    window.history.replaceState(null, '', '/parent/different-school');
    expect(getStoredSchool()).toEqual(validSchool);
    window.history.replaceState(null, '', '/login');
    expect(getStoredSchool()).toEqual(validSchool);
  });

  it('accepts official school IDs as strings or numbers and rejects structured values', () => {
    for (const id of ['128528', '001234', 128528]) {
      expect(isRegisteredSchool({ ...validSchool, schoolInfo: { id } })).toBe(true);
    }
    for (const id of [{ value: '128528' }, [], true, NaN, -1]) {
      expect(isRegisteredSchool({ ...validSchool, schoolInfo: { id } })).toBe(false);
    }
  });

  it('uses the central registry config before a tenant is explicitly selected', () => {
    expect(getStoredSchool()).toBeNull();
    expect(getActiveSchool()).toMatchObject({
      id: 'edash-registry',
      name: 'E-Dash',
      logoUrl: '/assets/edash/edash.png',
    });
  });

  it('persists the selected school configuration for Firebase initialization on reload', () => {
    const school = validSchool;
    storeActiveSchool(school);

    expect(getStoredSchool()).toEqual(school);
    expect(getActiveSchool()).toEqual(school);
    clearStoredSchool();
    expect(getStoredSchool()).toBeNull();
  });

  it('accepts and persists an optional school tagline', () => {
    const school = { ...validSchool, tagline: 'Everyone is an Achiever' };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.tagline).toBe('Everyone is an Achiever');
    expect(isRegisteredSchool({ ...school, tagline: 7 })).toBe(false);
  });

  it('persists project names and allows branding updates without changing the tenant configuration', () => {
    const school = { ...validSchool, projectName: 'Project Achieve' };
    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.projectName).toBe('Project Achieve');
    expect(sameSchoolRegistration(validSchool, school)).toBe(true);
    expect(isRegisteredSchool({ ...school, projectName: 7 })).toBe(false);
    expect(isRegisteredSchool({ ...school, projectName: 'a'.repeat(121) })).toBe(false);
  });

  it('accepts an optional EduAI feature flag and rejects a non-boolean value', () => {
    const school = { ...validSchool, canUseEduAI: true };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.canUseEduAI).toBe(true);
    expect(isRegisteredSchool({ ...school, canUseEduAI: 'true' })).toBe(false);
  });

  it('accepts and validates the optional color gradient tag from school registration', () => {
    const school = { ...validSchool, colorGradientTag: '#50A61E' };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.colorGradientTag).toBe('#50A61E');
    expect(isRegisteredSchool({ ...school, colorGradientTag: 'green' })).toBe(false);
  });

  it('accepts additional schema-defined registration fields', () => {
    const school = {
      ...validSchool,
      branding: { accentColor: '#50A61E' },
      schoolInfo: {
        region: 'IX',
        divisionOffice: 'Schools Division Office of Davao de Oro',
        district: 'New Bataan',
        contactNumber: '09170000000',
        email: 'school@example.edu',
        fbPage: 'Example School',
        municipality: 'New Bataan',
      },
      firebaseConfig: { ...validSchool.firebaseConfig, measurementId: 'G-EXAMPLE' },
    };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()).toMatchObject({
      branding: school.branding,
      schoolInfo: school.schoolInfo,
      firebaseConfig: school.firebaseConfig,
    });
  });

  it('accepts an optional school-head map and rejects invalid contact fields', () => {
    const school = {
      ...validSchool,
      schoolHead: {
        name: 'A. Principal',
        position: 'School Head',
        email: 'principal@example.edu',
        phoneNumber: '09170000000',
      },
    };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.schoolHead).toEqual(school.schoolHead);
    expect(isRegisteredSchool({ ...school, schoolHead: { name: 12 } })).toBe(false);
  });

  it('accepts and persists centralized school printing information', () => {
    const school = {
      ...validSchool,
      schoolInfo: {
        region: 'IX',
        divisionOffice: 'Schools Division Office of Davao de Oro',
        district: 'New Bataan',
      },
    };

    expect(isRegisteredSchool(school)).toBe(true);
    storeActiveSchool(school);
    expect(getStoredSchool()?.schoolInfo).toEqual(school.schoolInfo);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, region: 9 } })).toBe(false);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, schoolAddr: 'Example Town' } })).toBe(true);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, schoolAddr: 9 } })).toBe(false);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, zipCode: '0123' } })).toBe(true);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, zipCode: 8804 } })).toBe(true);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, zipCode: [] } })).toBe(false);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, contactNumber: 917 } })).toBe(false);
    expect(isRegisteredSchool({ ...school, schoolInfo: { ...school.schoolInfo, email: [] } })).toBe(false);
    expect(isRegisteredSchool({ ...school, schoolInfo: [] })).toBe(false);
  });

  it('does not treat school display metadata changes as tenant configuration changes', () => {
    expect(sameSchoolRegistration(
      {
        ...validSchool,
        colorGradientTag: '#50A61E',
        schoolHead: { name: 'Previous head' },
        schoolInfo: { region: 'XI', divisionOffice: 'Previous division', district: 'Previous district' },
      },
      {
        ...validSchool,
        colorGradientTag: '#2468D3',
        schoolHead: { name: 'Current head' },
        schoolInfo: { region: 'IX', divisionOffice: 'Current division', district: 'Current district' },
      },
    )).toBe(true);
  });

  it('treats changes to additional Firebase config fields as tenant config changes', () => {
    expect(sameSchoolRegistration(
      { ...validSchool, firebaseConfig: { ...validSchool.firebaseConfig, measurementId: 'G-OLD' } },
      { ...validSchool, firebaseConfig: { ...validSchool.firebaseConfig, measurementId: 'G-NEW' } },
    )).toBe(false);
  });

  it('rejects malformed tenant configurations before they can initialize Firebase', () => {
    expect(isRegisteredSchool({
      ...validSchool,
      id: 'not a valid tenant id',
    })).toBe(false);
    expect(isRegisteredSchool({
      ...validSchool,
      firebaseConfig: { ...validSchool.firebaseConfig, projectId: '' },
    })).toBe(false);
  });
});

describe('single-school registry lookup', () => {
  const school = { id: 'direct-school', enabled: true, name: 'Direct School', nickname: 'Direct', logoUrl: '/assets/logo.png', videoUrl: '', firebaseConfig: { apiKey: 'key', authDomain: 'school.test', projectId: 'project', appId: 'app' } };
  let get: ReturnType<typeof vi.fn>;
  let doc: ReturnType<typeof vi.fn>;
  let collection: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    get = vi.fn().mockResolvedValue({ exists: true, id: school.id, data: () => school });
    doc = vi.fn(() => ({ get }));
    collection = vi.fn(() => ({ doc }));
    vi.stubGlobal('firebase', { apps: [{ name: 'edash-school-registry', firestore: () => ({ collection }) }] });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('reads one document, deduplicates requests, and refreshes after the cache expires', async () => {
    vi.useFakeTimers();
    const [first, second] = await Promise.all([getRegisteredSchool('direct-school'), getRegisteredSchool('direct-school')]);
    expect(first).toEqual(school);
    expect(second).toEqual(school);
    expect(collection).toHaveBeenCalledWith('schools');
    expect(doc).toHaveBeenCalledWith('direct-school');
    expect(get).toHaveBeenCalledTimes(1);
    await getRegisteredSchool('direct-school');
    expect(get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await getRegisteredSchool('direct-school');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid IDs without querying and allows retry after a failed lookup', async () => {
    await expect(getRegisteredSchool('../schools')).rejects.toThrow('Invalid school link');
    expect(collection).not.toHaveBeenCalled();
    get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ exists: true, id: 'retry-school', data: () => ({ ...school, id: 'retry-school' }) });
    await expect(getRegisteredSchool('retry-school')).rejects.toThrow('Offline');
    expect((await getRegisteredSchool('retry-school'))?.id).toBe('retry-school');
  });

  it('does not accept disabled, missing, or invalid school registrations', async () => {
    get.mockResolvedValueOnce({ exists: false });
    expect(await getRegisteredSchool('missing-school')).toBeNull();
    get.mockResolvedValueOnce({ exists: true, id: 'disabled-school', data: () => ({ ...school, enabled: false }) });
    await expect(getRegisteredSchool('disabled-school')).rejects.toThrow('unavailable or incomplete');
    get.mockResolvedValueOnce({ exists: true, id: 'invalid-school', data: () => ({ ...school, firebaseConfig: {} }) });
    await expect(getRegisteredSchool('invalid-school')).rejects.toThrow('unavailable or incomplete');
  });
});
