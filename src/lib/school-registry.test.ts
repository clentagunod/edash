import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredSchool,
  getActiveSchool,
  getStoredSchool,
  isRegisteredSchool,
  sameSchoolRegistration,
  storeActiveSchool,
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
