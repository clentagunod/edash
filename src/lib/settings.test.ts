import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpenAccountSettingsModal, mockRenderProfileAvatar, mockRenderShell, mockStoredAppProfile, mockUpdateMyTeacherPrefs, mockShowToast, mockIsSchoolAdmin, mockAppPageHref } = vi.hoisted(() => ({
  mockOpenAccountSettingsModal: vi.fn(),
  mockRenderProfileAvatar: vi.fn((element: HTMLElement | null, photoURL: string, email: string) => {
    if (element) element.textContent = photoURL ? 'photo' : (email ? email.slice(0, 1).toUpperCase() : '?');
  }),
  mockRenderShell: vi.fn(),
  mockStoredAppProfile: vi.fn(),
  mockUpdateMyTeacherPrefs: vi.fn(),
  mockShowToast: vi.fn(),
  mockIsSchoolAdmin: vi.fn(),
  mockAppPageHref: vi.fn((path: string) => `pages/${path}`),
}));

vi.mock('./app-config', () => ({
  APP_USER_PROFILE: null,
  APP_CONFIG: { schoolId: "test-school" },
  isSchoolAdmin: mockIsSchoolAdmin,
  storedAppProfile: mockStoredAppProfile,
}));
vi.mock('./auth', () => ({
  displayNameFromEmail: (email: string) => email ? email.split('@')[0] : 'User',
  initials: (email: string) => email ? email.slice(0, 1).toUpperCase() : '?',
}));
vi.mock('./firebase', () => ({
  auth: { currentUser: { email: 'fallback@school.test' } },
}));
vi.mock('./shell', () => ({
  openAccountSettingsModal: mockOpenAccountSettingsModal,
  renderProfileAvatar: mockRenderProfileAvatar,
  renderShell: mockRenderShell,
  showToast: mockShowToast,
  appPageHref: mockAppPageHref,
}));
vi.mock('./firestore-api', () => ({
  fsUpdateMyTeacherPrefs: mockUpdateMyTeacherPrefs,
}));

import { normalizeUserPreferences } from './user-preferences';
import preferencesMarkup from '../pages/markup/preferences.html?raw';
import { clearProfilePhotoCache, cachedProfilePhotoSource, profilePhotoCacheStats } from './profile-photo-cache';
import { initPreferencesPage, initSettingsPage } from './settings';

describe('settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
    document.body.innerHTML = `
      <div class="settings-profile-avatar"></div>
      <h2 class="settings-profile-name"></h2>
      <p class="settings-profile-email"></p>
      <button id="openAccountSettings" type="button"></button>
      <button id="uploadProfilePhoto" type="button"></button>
      <button id="removeProfilePhoto" type="button" hidden></button>
      <input id="profilePhotoFile" type="file" />
      <div id="profilePhotoBackdrop"></div>
      <div id="profilePhotoCrop"></div>
      <img id="profilePhotoPreview" />
      <input id="profilePhotoZoom" type="range" />
      <p id="profilePhotoStatus"></p>
      <button id="saveProfilePhoto" type="button"></button>
      <button id="closeProfilePhoto" type="button"></button>
      <button id="cancelProfilePhoto" type="button"></button>
      <div class="settings-options">
        <button type="button">Account Settings</button>
        <a href="preferences.html">Preferences</a>
        <a id="adminConsoleOption" href="manage-users.html" hidden>Admin Console</a>
      </div>
    `;
    mockStoredAppProfile.mockReturnValue({
      name: 'Example Admin',
      email: 'admin@school.test',
    });
    mockIsSchoolAdmin.mockReturnValue(false);
  });

  it('renders the account identity and opens account settings', () => {
    const cleanup = initSettingsPage();

    expect(mockRenderShell).toHaveBeenCalledWith('settings', 'Settings');
    expect(document.querySelector('.settings-profile-avatar')?.textContent).toBe('A');
    expect(document.querySelector('.settings-profile-name')?.textContent).toBe('Example Admin');
    expect(document.querySelector('.settings-profile-email')?.textContent).toBe('admin@school.test');
    expect(mockRenderProfileAvatar).toHaveBeenCalledWith(
      document.querySelector('.settings-profile-avatar'),
      '',
      'admin@school.test',
    );
    expect(document.querySelector('.settings-option--grade')).toBeNull();
    expect(document.querySelector('.settings-option--card-printing')).toBeNull();

    document.getElementById('openAccountSettings')?.click();
    expect(mockOpenAccountSettingsModal).toHaveBeenCalledOnce();

    cleanup();
    document.getElementById('openAccountSettings')?.click();
    expect(mockOpenAccountSettingsModal).toHaveBeenCalledOnce();
  });

  it('uses the signed-in email when profile data is not cached', () => {
    mockStoredAppProfile.mockReturnValue(null);

    initSettingsPage();

    expect(document.querySelector('.settings-profile-name')?.textContent).toBe('fallback');
    expect(document.querySelector('.settings-profile-email')?.textContent).toBe('fallback@school.test');
  });

  it('shows Admin Console as the third settings option for School Admins only', () => {
    mockIsSchoolAdmin.mockReturnValue(true);

    initSettingsPage();

    const adminOption = document.getElementById('adminConsoleOption') as HTMLAnchorElement;
    expect(adminOption.hidden).toBe(false);
    expect(adminOption.href).toContain('/pages/manage-users.html');
    expect(mockAppPageHref).toHaveBeenCalledWith('manage-users.html');
    expect(adminOption.parentElement?.children[2]).toBe(adminOption);

    document.body.innerHTML = `
      <div class="settings-profile-avatar"></div>
      <h2 class="settings-profile-name"></h2>
      <p class="settings-profile-email"></p>
      <button id="openAccountSettings" type="button"></button>
      <button id="uploadProfilePhoto" type="button"></button>
      <button id="removeProfilePhoto" type="button" hidden></button>
      <input id="profilePhotoFile" type="file" />
      <div id="profilePhotoBackdrop"></div>
      <div id="profilePhotoCrop"></div>
      <img id="profilePhotoPreview" />
      <input id="profilePhotoZoom" type="range" />
      <p id="profilePhotoStatus"></p>
      <button id="saveProfilePhoto" type="button"></button>
      <button id="closeProfilePhoto" type="button"></button>
      <button id="cancelProfilePhoto" type="button"></button>
      <div class="settings-options">
        <button type="button">Account Settings</button>
        <a href="preferences.html">Preferences</a>
        <a id="adminConsoleOption" href="manage-users.html" hidden>Admin Console</a>
      </div>
    `;
    mockIsSchoolAdmin.mockReturnValue(false);

    initSettingsPage();
    expect((document.getElementById('adminConsoleOption') as HTMLAnchorElement).hidden).toBe(true);
  });

  it('renders an account photo when the profile already has a Cloudinary URL', () => {
    mockStoredAppProfile.mockReturnValue({
      email: 'admin@school.test',
      photoURL: 'https://res.cloudinary.com/demo/image/upload/profile.jpg',
    });

    initSettingsPage();

    expect(mockRenderProfileAvatar).toHaveBeenCalledWith(
      document.querySelector('.settings-profile-avatar'),
      'https://res.cloudinary.com/demo/image/upload/profile.jpg',
      'admin@school.test',
    );
    expect((document.getElementById('removeProfilePhoto') as HTMLButtonElement).hidden).toBe(false);
  });

  it('explains that uploads need Cloudinary configuration before opening the file picker', () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', '');
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', '');
    initSettingsPage();
    document.getElementById('uploadProfilePhoto')?.click();

    expect(mockShowToast).toHaveBeenCalledWith(
      'Profile photo uploads are not configured. Ask your administrator to complete the Cloudinary setup.',
      'error',
    );
  });

  it('repositions the photo by dragging with the mouse', () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'test-cloud');
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'profile-photos');
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:profile-photo'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('Image', class {
      naturalWidth = 800;
      naturalHeight = 800;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    });
    const fileInput = document.getElementById('profilePhotoFile') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['image'], 'profile.png', { type: 'image/png' })],
    });
    initSettingsPage();
    fileInput.dispatchEvent(new Event('change'));

    const preview = document.getElementById('profilePhotoPreview') as HTMLImageElement;
    const crop = document.getElementById('profilePhotoCrop') as HTMLElement;
    expect((document.getElementById('profilePhotoZoom') as HTMLInputElement).value).toBe('1.25');

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
    crop.dispatchEvent(mouseDown);
    const mouseMove = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 20, clientY: 18 });
    document.dispatchEvent(mouseMove);
    expect(preview.style.transform).toContain('10px');
    expect(preview.style.transform).toContain('8px');
    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('defaults learner inspection on and saves the selected dropdown theme to user preferences', async () => {
    document.body.innerHTML = `
      <select id="themePreferenceSelect">
        <option value="Light">Light Theme</option>
        <option value="Dark">Dark Theme</option>
        <option value="Dracula">Dracula</option>
        <option value="ClentIndustries Theme">ClentIndustries Theme</option>
      </select>
      <input id="learnerInspectionToggle" type="checkbox" />
      <span id="learnerInspectionState"></span>
    `;
    mockStoredAppProfile.mockReturnValue({ email: 'admin@school.test' });
    mockUpdateMyTeacherPrefs.mockImplementation(async (prefs) => prefs);
    localStorage.setItem('lps_theme', 'monokai');

    const cleanup = initPreferencesPage();
    const themeSelect = document.getElementById('themePreferenceSelect') as HTMLSelectElement;
    const inspectionToggle = document.getElementById('learnerInspectionToggle') as HTMLInputElement;

    expect(mockRenderShell).toHaveBeenCalledWith('settings', 'Preferences');
    expect(themeSelect.value).toBe('Light');
    expect(inspectionToggle.checked).toBe(true);
    expect(document.getElementById('learnerInspectionState')?.textContent).toBe('On');

    themeSelect.value = 'Dark';
    themeSelect.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockUpdateMyTeacherPrefs).toHaveBeenCalledWith(normalizeUserPreferences({
      theme: 'Dark',
      inspectLearner: true,
    })));
    await vi.waitFor(() => expect(document.body.classList.contains('dark-mode')).toBe(true));
    expect(localStorage.getItem('lps_theme')).toBe('monokai');
    expect(themeSelect.value).toBe('Dark');
    expect(mockShowToast).not.toHaveBeenCalled();

    cleanup();
  });

  it.each(['School Admin', 'Registrar', 'Teacher', 'School Staff'])(
    'allows %s accounts to save their own preferences',
    async (role) => {
      document.body.innerHTML = `
        <select id="themePreferenceSelect">
          <option value="Light">Light Theme</option>
          <option value="Dracula">Dracula</option>
        </select>
        <input id="learnerInspectionToggle" type="checkbox" checked />
      `;
      mockStoredAppProfile.mockReturnValue({
        role,
        teacherPrefs: { theme: 'Light', inspectLearner: true },
      });
      mockUpdateMyTeacherPrefs.mockImplementation(async (prefs) => prefs);
      initPreferencesPage();

      const themeSelect = document.getElementById('themePreferenceSelect') as HTMLSelectElement;
      themeSelect.value = 'Dracula';
      themeSelect.dispatchEvent(new Event('change'));

      await vi.waitFor(() => expect(mockUpdateMyTeacherPrefs).toHaveBeenCalledWith(normalizeUserPreferences({
        theme: 'Dracula',
        inspectLearner: true,
      })));
    },
  );

  it('restores learner inspection state when saving fails', async () => {
    document.body.innerHTML = `
      <select id="themePreferenceSelect">
        <option value="Light">Light Theme</option>
        <option value="Dark">Dark Theme</option>
      </select>
      <input id="learnerInspectionToggle" type="checkbox" checked />
      <span id="learnerInspectionState"></span>
    `;
    mockStoredAppProfile.mockReturnValue({ teacherPrefs: { theme: 'Light', inspectLearner: true } });
    mockUpdateMyTeacherPrefs.mockRejectedValue(new Error('Firestore unavailable'));

    initPreferencesPage();
    const inspectionToggle = document.getElementById('learnerInspectionToggle') as HTMLInputElement;
    inspectionToggle.checked = false;
    inspectionToggle.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Firestore unavailable', 'error'));
    expect(inspectionToggle.checked).toBe(true);
    expect(document.getElementById('learnerInspectionState')?.textContent).toBe('On');
  });

  it('applies and caches a selected custom theme', async () => {
    document.body.innerHTML = `
      <select id="themePreferenceSelect">
        <option value="Light">Light Theme</option>
        <option value="Dracula">Dracula</option>
      </select>
      <input id="learnerInspectionToggle" type="checkbox" checked />
    `;
    mockStoredAppProfile.mockReturnValue({ teacherPrefs: { theme: 'Light', inspectLearner: true } });
    mockUpdateMyTeacherPrefs.mockImplementation(async (prefs) => prefs);
    initPreferencesPage();

    const themeSelect = document.getElementById('themePreferenceSelect') as HTMLSelectElement;
    themeSelect.value = 'Dracula';
    themeSelect.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(mockUpdateMyTeacherPrefs).toHaveBeenCalledWith(normalizeUserPreferences({
      theme: 'Dracula',
      inspectLearner: true,
    })));
    await vi.waitFor(() => expect(document.body.dataset.theme).toBe('dracula'));
    expect(document.body.classList.contains('dark-mode')).toBe(true);
    expect(localStorage.getItem('lps_theme')).toBeNull();
  });

  it('applies the ClentIndustries terminal theme', async () => {
    document.body.innerHTML = `
      <select id="themePreferenceSelect">
        <option value="Light">Light Theme</option>
        <option value="ClentIndustries Theme">ClentIndustries Theme</option>
      </select>
      <input id="learnerInspectionToggle" type="checkbox" checked />
    `;
    mockStoredAppProfile.mockReturnValue({ teacherPrefs: { theme: 'Light', inspectLearner: true } });
    mockUpdateMyTeacherPrefs.mockImplementation(async (prefs) => prefs);
    initPreferencesPage();

    const themeSelect = document.getElementById('themePreferenceSelect') as HTMLSelectElement;
    themeSelect.value = 'ClentIndustries Theme';
    themeSelect.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(mockUpdateMyTeacherPrefs).toHaveBeenCalledWith(normalizeUserPreferences({
      theme: 'ClentIndustries Theme',
      inspectLearner: true,
    })));
    await vi.waitFor(() => expect(document.body.dataset.theme).toBe('clentindustries-theme'));
    expect(document.body.classList.contains('dark-mode')).toBe(true);
    expect(localStorage.getItem('lps_theme')).toBeNull();
  });
});

describe('expanded workspace preferences', () => {
  let cleanup: (() => void) | undefined;
  let profile: any;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    clearProfilePhotoCache();
    document.body.innerHTML = preferencesMarkup;
    profile = { uid: 'account-1', role: 'Teacher', teacherPrefs: normalizeUserPreferences() };
    mockStoredAppProfile.mockImplementation(() => profile);
    mockUpdateMyTeacherPrefs.mockImplementation(async prefs => { profile.teacherPrefs = prefs; return prefs; });
    const dialog = document.getElementById('resetPreferencesDialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
    dialog.close = vi.fn(() => dialog.removeAttribute('open'));
    cleanup = initPreferencesPage();
  });
  afterEach(() => { cleanup?.(); vi.restoreAllMocks(); });

  it('saves each new preference and applies its runtime behavior', async () => {
    for (const [id, key, value] of [
      ['rememberFiltersPreference', 'rememberFilters', false],
      ['landingPagePreference', 'landingPage', 'masterlist.html'],
      ['tableDensityPreference', 'tableDensity', 'compact'],
      ['tablePageSizePreference', 'tablePageSize', 25],
      ['textSizePreference', 'textSize', 'large'],
      ['privacyModePreference', 'privacyMode', true],
      ['reduceMotionPreference', 'reduceMotion', true],
      ['photoCachePreference', 'photoCacheEnabled', false],
    ] as const) {
      const input = document.getElementById(id) as HTMLInputElement;
      if (typeof value === 'boolean') input.checked = value;
      else input.value = String(value);
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(input.disabled).toBe(false));
      expect(mockUpdateMyTeacherPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: value }));
    }
    expect(document.body.dataset.tableDensity).toBe('compact');
    expect(document.body.dataset.textSize).toBe('large');
    expect(document.body.dataset.privacyMode).toBe('true');
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(profilePhotoCacheStats().enabled).toBe(false);
    expect(document.getElementById('preferencesSaveStatus')?.textContent).toBe('All changes saved');
  });

  it('persists optional columns while keeping identity columns mandatory', async () => {
    const guardian = document.querySelector<HTMLInputElement>('[data-learner-column="guardian"]')!;
    guardian.checked = false;
    guardian.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(guardian.disabled).toBe(false));
    expect(profile.teacherPrefs.hiddenLearnerColumns).toEqual(['guardian']);
    expect(document.body.classList.contains('hide-learner-guardian')).toBe(true);
    expect(document.querySelector('input[data-learner-column="name"]')).toBeNull();
  });

  it('clears cached photos without changing uploaded profile photos', async () => {
    profile.photoURL = 'https://images.test/upload.jpg';
    const fetchPhoto = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/png' }) } as Response);
    await cachedProfilePhotoSource('https://images.test/clear-control.jpg');
    expect(document.getElementById('photoCacheUsage')?.textContent).toContain('1 cached photo');
    document.getElementById('clearPhotoCacheBtn')?.click();
    expect(profilePhotoCacheStats().count).toBe(0);
    expect(profile.photoURL).toBe('https://images.test/upload.jpg');
    expect(mockUpdateMyTeacherPrefs).not.toHaveBeenCalled();
    fetchPhoto.mockRestore();
  });

  it('requires confirmation to reset and clears only the current account views', async () => {
    profile.teacherPrefs = normalizeUserPreferences({ theme: 'Dark', privacyMode: true, tablePageSize: 50 });
    sessionStorage.setItem('lps_view:test-school:account-1:reading:2026-2027', '{"grade":"Grade 1"}');
    sessionStorage.setItem('lps_view:test-school:other-account:reading:2026-2027', '{}');
    document.getElementById('resetPreferencesBtn')?.click();
    expect(document.getElementById('resetPreferencesDialog')?.hasAttribute('open')).toBe(true);
    expect(mockUpdateMyTeacherPrefs).not.toHaveBeenCalled();
    document.getElementById('cancelResetPreferencesBtn')?.click();
    expect(mockUpdateMyTeacherPrefs).not.toHaveBeenCalled();
    document.getElementById('resetPreferencesBtn')?.click();
    document.getElementById('confirmResetPreferencesBtn')?.click();
    await vi.waitFor(() => expect(document.getElementById('resetPreferencesDialog')?.hasAttribute('open')).toBe(false));
    expect(mockUpdateMyTeacherPrefs).toHaveBeenCalledWith(normalizeUserPreferences());
    expect(sessionStorage.getItem('lps_view:test-school:account-1:reading:2026-2027')).toBeNull();
    expect(sessionStorage.getItem('lps_view:test-school:other-account:reading:2026-2027')).toBe('{}');
  });

  it('restores the control and reports a failed save', async () => {
    mockUpdateMyTeacherPrefs.mockRejectedValueOnce(new Error('Permission denied'));
    const size = document.getElementById('textSizePreference') as HTMLSelectElement;
    size.value = 'extra-large';
    size.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(size.disabled).toBe(false));
    expect(size.value).toBe('standard');
    expect(document.getElementById('preferencesSaveStatus')?.dataset.state).toBe('error');
  });
});
