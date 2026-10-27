import defaults from '../../shared/user-preferences.json';
import { isAppTheme, type AppTheme } from './themes';

export const OPTIONAL_LEARNER_COLUMNS = {
  birthDate: 'Birthdate', age: 'Age', gender: 'Gender', guardian: 'Guardian',
  programs: 'Programs', dateAdded: 'Date added',
};
export const LANDING_PAGES = {
  'dashboard.html': 'Dashboard', 'masterlist.html': 'Masterlist',
  'enrollment-data.html': 'Enrollment data', 'reading-profile.html': 'Reading profile',
  'math-profile.html': 'Math profile', 'grades-profile.html': 'Grades profile',
  'nutritional-status.html': 'Nutrition', 'settings.html': 'Settings',
};
export interface UserPreferences {
  theme: AppTheme;
  inspectLearner: boolean;
  rememberFilters: boolean;
  landingPage: keyof typeof LANDING_PAGES;
  tableDensity: 'comfortable' | 'compact';
  tablePageSize: 8 | 10 | 25 | 50;
  hiddenLearnerColumns: string[];
  textSize: 'standard' | 'large' | 'extra-large';
  privacyMode: boolean;
  reduceMotion: boolean;
  photoCacheEnabled: boolean;
}
export function normalizeUserPreferences(value: unknown = {}): UserPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const prefs = { ...defaults, hiddenLearnerColumns: [] } as UserPreferences;
  if (isAppTheme(input.theme)) prefs.theme = input.theme;
  for (const key of ['inspectLearner', 'rememberFilters', 'privacyMode', 'reduceMotion', 'photoCacheEnabled'] as const) {
    if (typeof input[key] === 'boolean') prefs[key] = input[key] as boolean;
  }
  if (Object.prototype.hasOwnProperty.call(LANDING_PAGES, String(input.landingPage))) prefs.landingPage = input.landingPage as UserPreferences['landingPage'];
  if (input.tableDensity === 'comfortable' || input.tableDensity === 'compact') prefs.tableDensity = input.tableDensity;
  if ([8, 10, 25, 50].includes(input.tablePageSize as number)) prefs.tablePageSize = input.tablePageSize as UserPreferences['tablePageSize'];
  if (['standard', 'large', 'extra-large'].includes(String(input.textSize))) prefs.textSize = input.textSize as UserPreferences['textSize'];
  if (Array.isArray(input.hiddenLearnerColumns)) prefs.hiddenLearnerColumns = [...new Set(input.hiddenLearnerColumns.filter((key): key is string => typeof key === 'string' && Object.prototype.hasOwnProperty.call(OPTIONAL_LEARNER_COLUMNS, key)))];
  return prefs;
}

export function validUserPreferences(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const normalized = normalizeUserPreferences(input);
  return isAppTheme(input.theme) && typeof input.inspectLearner === 'boolean'
    && Object.keys(input).every(key => Object.prototype.hasOwnProperty.call(defaults, key)
      && JSON.stringify(input[key]) === JSON.stringify(normalized[key as keyof UserPreferences]));
}

export function landingPageForProfile(profile: { role?: string; teacherPrefs?: unknown } | null) {
  const requested = normalizeUserPreferences(profile?.teacherPrefs).landingPage;
  // Unknown/visitor accounts can only use the public dashboard views.
  const staff = ['School Admin', 'Registrar', 'Teacher'].includes(profile?.role || '');
  return staff || ['dashboard.html', 'enrollment-data.html'].includes(requested) ? requested : 'dashboard.html';
}
