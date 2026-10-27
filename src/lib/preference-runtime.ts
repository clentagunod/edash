import { APP_CONFIG, APP_USER_PROFILE, storedAppProfile } from './app-config';
import { normalizeUserPreferences, type UserPreferences } from './user-preferences';
import { configureProfilePhotoCache } from './profile-photo-cache';

export function currentUserPreferences(): UserPreferences {
  return normalizeUserPreferences((storedAppProfile() || APP_USER_PROFILE)?.teacherPrefs);
}

export function applyUserPreferences(prefs = currentUserPreferences()) {
  document.body.dataset.tableDensity = prefs.tableDensity;
  document.body.dataset.textSize = prefs.textSize;
  document.body.dataset.privacyMode = String(prefs.privacyMode);
  document.documentElement.dataset.reduceMotion = String(prefs.reduceMotion);
  for (const key of ['birthDate', 'age', 'gender', 'guardian', 'programs', 'dateAdded']) {
    document.body.classList.toggle(`hide-learner-${key}`, prefs.hiddenLearnerColumns.includes(key));
  }
  configureProfilePhotoCache(prefs.photoCacheEnabled);
}

function viewPrefix() {
  const profile = storedAppProfile() || APP_USER_PROFILE;
  return `lps_view:${APP_CONFIG.schoolId}:${profile?.uid || profile?.userId || 'guest'}:`;
}
export function readRememberedView(key: string): Record<string, string> {
  if (!currentUserPreferences().rememberFilters) return {};
  try {
    const value = JSON.parse(sessionStorage.getItem(viewPrefix() + key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => entry[0].length <= 100 && typeof entry[1] === 'string' && entry[1].length <= 200));
  } catch { return {}; }
}
export function rememberView(key: string, value: Record<string, string>) {
  if (!currentUserPreferences().rememberFilters) return;
  try { sessionStorage.setItem(viewPrefix() + key, JSON.stringify(value)); } catch { /* Optional tab storage. */ }
}
export function clearRememberedViews() {
  const prefix = viewPrefix();
  try { Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key)); } catch { /* Optional tab storage. */ }
}

/** Restore explicit filter controls, excluding forms, school-year selection and credentials. */
export function restoreFilterControls(key: string, ids: string[]) {
  const values = readRememberedView(key);
  for (const id of ids) {
    const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!input) continue;
    const fallback = input instanceof HTMLSelectElement
      ? ([...input.options].find(option => option.defaultSelected) || input.options[0])?.value || ''
      : input.defaultValue;
    const value = values[id] ?? fallback;
    input.value = input instanceof HTMLSelectElement && ![...input.options].some(option => option.value === value) ? fallback : value;
  }
}
export function rememberFilterControls(key: string, ids: string[], extra: Record<string, string> = {}) {
  const values: Record<string, string> = { ...extra };
  for (const id of ids) {
    const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (input) values[id] = input.value;
  }
  rememberView(key, values);
}
