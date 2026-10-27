import { beforeEach, describe, expect, it, vi } from 'vitest';
import defaults from '../../shared/user-preferences.json';
import provisionDefaults from '../edash_provision/assets/user-preferences.json';
import { landingPageForProfile, normalizeUserPreferences, validUserPreferences } from './user-preferences';

const { account } = vi.hoisted(() => ({ account: { current: { uid: 'first', teacherPrefs: {} } as any } }));
vi.mock('./app-config', () => ({ APP_CONFIG: { schoolId: 'school-a' }, APP_USER_PROFILE: null, storedAppProfile: () => account.current }));
import { applyUserPreferences, clearRememberedViews, readRememberedView, rememberView, restoreFilterControls } from './preference-runtime';

describe('personal preference schema', () => {
  it('keeps standalone provisioning defaults aligned with the website schema', () => {
    expect(provisionDefaults).toEqual(defaults);
    expect(validUserPreferences(provisionDefaults)).toBe(true);
  });
  it('fills missing fields for existing accounts without losing their choices', () => {
    expect(normalizeUserPreferences({ theme: 'Nord', inspectLearner: false })).toEqual({ ...defaults, theme: 'Nord', inspectLearner: false });
    expect(normalizeUserPreferences(null)).toEqual(defaults);
    const copy = normalizeUserPreferences();
    copy.hiddenLearnerColumns.push('guardian');
    expect(normalizeUserPreferences().hiddenLearnerColumns).toEqual([]);
  });

  it('validates old and expanded preferences and rejects unexpected values', () => {
    expect(validUserPreferences({ theme: 'Dark', inspectLearner: true })).toBe(true);
    expect(validUserPreferences({ ...defaults, tablePageSize: 50, privacyMode: true, hiddenLearnerColumns: ['guardian'] })).toBe(true);
    for (const patch of [{ tablePageSize: 5000 }, { privacyMode: 'true' }, { hiddenLearnerColumns: ['learnerId'] }, { landingPage: 'https://other.test' }, { role: 'School Admin' }, { textSize: 'huge' }]) {
      expect(validUserPreferences({ ...defaults, ...patch })).toBe(false);
    }
  });

  it('limits landing pages to internal, role-compatible destinations', () => {
    expect(landingPageForProfile({ role: 'Teacher', teacherPrefs: { landingPage: 'grades-profile.html' } })).toBe('grades-profile.html');
    expect(landingPageForProfile({ role: 'Visitor', teacherPrefs: { landingPage: 'masterlist.html' } })).toBe('dashboard.html');
    expect(landingPageForProfile({ role: 'Teacher', teacherPrefs: { landingPage: '//other.test' } })).toBe('dashboard.html');
  });
});

describe('preference runtime', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
    account.current = { uid: 'first', teacherPrefs: defaults };
  });

  it('applies spacing, type size, privacy, motion and optional-column choices', () => {
    applyUserPreferences(normalizeUserPreferences({ tableDensity: 'compact', textSize: 'extra-large', privacyMode: true, reduceMotion: true, hiddenLearnerColumns: ['guardian'] }));
    expect(document.body.dataset.tableDensity).toBe('compact');
    expect(document.body.dataset.textSize).toBe('extra-large');
    expect(document.body.dataset.privacyMode).toBe('true');
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(document.body.classList.contains('hide-learner-guardian')).toBe(true);
    applyUserPreferences(normalizeUserPreferences());
    expect(document.body.classList.contains('hide-learner-guardian')).toBe(false);
    expect(document.body.dataset.privacyMode).toBe('false');
  });

  it('keeps remembered views separate by account, page and school year', () => {
    rememberView('masterlist:2026-2027', { grade: 'Grade 1', sort: 'name-desc' });
    expect(readRememberedView('masterlist:2026-2027').sort).toBe('name-desc');
    expect(readRememberedView('masterlist:2027-2028')).toEqual({});
    expect(readRememberedView('reading:2026-2027')).toEqual({});
    account.current.uid = 'second';
    expect(readRememberedView('masterlist:2026-2027')).toEqual({});
    rememberView('masterlist:2026-2027', { sort: 'date-newest' });
    clearRememberedViews();
    expect(readRememberedView('masterlist:2026-2027')).toEqual({});
    account.current.uid = 'first';
    expect(readRememberedView('masterlist:2026-2027').sort).toBe('name-desc');
  });

  it('resets unavailable filters and obeys the remember toggle', () => {
    document.body.innerHTML = '<select id="grade"><option value="">All</option><option>Grade 1</option></select><input id="search" />';
    rememberView('reading', { grade: 'retired-grade', search: 'saved search' });
    restoreFilterControls('reading', ['grade', 'search']);
    expect((document.getElementById('grade') as HTMLSelectElement).value).toBe('');
    expect((document.getElementById('search') as HTMLInputElement).value).toBe('saved search');
    account.current.teacherPrefs = { ...defaults, rememberFilters: false };
    rememberView('new', { grade: 'Grade 1' });
    expect(readRememberedView('reading')).toEqual({});
    restoreFilterControls('reading', ['search']);
    expect((document.getElementById('search') as HTMLInputElement).value).toBe('');
  });
});
