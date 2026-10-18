import { APP_USER_PROFILE, isSchoolAdmin, storedAppProfile } from './app-config';
import { displayNameFromEmail, initials } from './auth';
import { auth } from './firebase';
import { fsUpdateMyPhotoURL, fsUpdateMyTeacherPrefs } from './firestore-api';
import { appPageHref, openAccountSettingsModal, renderProfileAvatar, renderShell, showToast } from './shell';
import { type AppTheme, appThemeId, isAppTheme, isDarkAppTheme } from './themes';

const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_SIZE = 512;

export function initSettingsPage() {
  renderShell('settings', 'Settings');

  const profile = storedAppProfile() || APP_USER_PROFILE || {};
  const email = profile.email || auth.currentUser?.email || '';
  const name = profile.name || displayNameFromEmail(email);
  const nameElement = document.querySelector('.settings-profile-name');
  const emailElement = document.querySelector('.settings-profile-email');
  const avatarElement = document.querySelector('.settings-profile-avatar');
  const fileInput = document.querySelector<HTMLInputElement>('#profilePhotoFile');
  const uploadButton = document.querySelector<HTMLButtonElement>('#uploadProfilePhoto');
  const removeButton = document.querySelector<HTMLButtonElement>('#removeProfilePhoto');
  const backdrop = document.querySelector<HTMLElement>('#profilePhotoBackdrop');
  const cropViewport = document.querySelector<HTMLElement>('#profilePhotoCrop');
  const preview = document.querySelector<HTMLImageElement>('#profilePhotoPreview');
  const zoomInput = document.querySelector<HTMLInputElement>('#profilePhotoZoom');
  const status = document.querySelector<HTMLElement>('#profilePhotoStatus');
  const saveButton = document.querySelector<HTMLButtonElement>('#saveProfilePhoto');
  const adminConsoleOption = document.querySelector<HTMLAnchorElement>('#adminConsoleOption');
  if (adminConsoleOption) {
    adminConsoleOption.hidden = !isSchoolAdmin();
    adminConsoleOption.href = appPageHref('manage-users.html');
  }
  let photoURL = String(profile.photoURL || '');
  let sourceImage: HTMLImageElement | null = null;
  let imageObjectUrl = '';
  let offsetX = 0;
  let offsetY = 0;
  let zoom = 1.25;
  let dragStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
  let savingPhoto = false;

  if (nameElement) nameElement.textContent = name;
  if (emailElement) emailElement.textContent = email || 'Email unavailable';
  renderProfileAvatar(avatarElement, photoURL, email);
  if (removeButton) removeButton.hidden = !photoURL;

  document.getElementById('openAccountSettings')?.addEventListener('click', openAccountSettingsModal);

  const revokeImageUrl = () => {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = '';
  };
  const closeEditor = () => {
    backdrop?.classList.remove('is-open');
    backdrop?.setAttribute('aria-hidden', 'true');
    sourceImage = null;
    revokeImageUrl();
    if (fileInput) fileInput.value = '';
  };
  const renderCrop = () => {
    if (!sourceImage || !preview || !cropViewport) return;
    const viewportSize = cropViewport.clientWidth || 240;
    const baseScale = viewportSize / Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight);
    const width = sourceImage.naturalWidth * baseScale * zoom;
    const height = sourceImage.naturalHeight * baseScale * zoom;
    const maxX = Math.max(0, (width - viewportSize) / 2);
    const maxY = Math.max(0, (height - viewportSize) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    preview.style.left = '50%';
    preview.style.top = '50%';
    preview.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
  };
  const openEditor = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Choose a JPG, PNG, or WebP image.', 'error');
      return;
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      showToast('Choose an image smaller than 10 MB.', 'error');
      return;
    }
    revokeImageUrl();
    imageObjectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      sourceImage = image;
      offsetX = 0;
      offsetY = 0;
      zoom = 1.25;
      if (preview) preview.src = imageObjectUrl;
      if (zoomInput) zoomInput.value = String(zoom);
      if (status) status.textContent = '';
      backdrop?.classList.add('is-open');
      backdrop?.setAttribute('aria-hidden', 'false');
      renderCrop();
      document.getElementById('closeProfilePhoto')?.focus();
    };
    image.onerror = () => {
      revokeImageUrl();
      showToast('This image could not be opened. Choose a different image.', 'error');
    };
    image.src = imageObjectUrl;
  };
  const handleFileChange = () => {
    const file = fileInput?.files?.[0];
    if (file) openEditor(file);
  };
  const handleUploadClick = () => {
    const { VITE_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_UPLOAD_PRESET } = import.meta.env;
    if (!VITE_CLOUDINARY_CLOUD_NAME || !VITE_CLOUDINARY_UPLOAD_PRESET) {
      showToast('Profile photo uploads are not configured. Ask your administrator to complete the Cloudinary setup.', 'error');
      return;
    }
    fileInput?.click();
  };
  const handleZoom = () => {
    zoom = Number(zoomInput?.value || 1);
    renderCrop();
  };
  const handleMouseDown = (event: MouseEvent) => {
    if (!sourceImage || !cropViewport || event.button !== 0) return;
    event.preventDefault();
    dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY };
  };
  const handleMouseMove = (event: MouseEvent) => {
    if (!dragStart) return;
    offsetX = dragStart.offsetX + event.clientX - dragStart.x;
    offsetY = dragStart.offsetY + event.clientY - dragStart.y;
    renderCrop();
  };
  const handleMouseUp = () => { dragStart = null; };
  const handleCloseClick = () => closeEditor();
  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === backdrop) closeEditor();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && backdrop?.classList.contains('is-open')) closeEditor();
  };
  const handleSave = async () => {
    if (savingPhoto || !sourceImage) return;
    savingPhoto = true;
    if (saveButton) saveButton.disabled = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = PROFILE_PHOTO_SIZE;
      canvas.height = PROFILE_PHOTO_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser cannot edit this image. Try another browser.');
      const viewportSize = cropViewport?.clientWidth || 240;
      const baseScale = viewportSize / Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight);
      const outputScale = PROFILE_PHOTO_SIZE / viewportSize;
      const width = sourceImage.naturalWidth * baseScale * zoom;
      const height = sourceImage.naturalHeight * baseScale * zoom;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE);
      context.drawImage(
        sourceImage,
        PROFILE_PHOTO_SIZE / 2 + offsetX * outputScale - width * outputScale / 2,
        PROFILE_PHOTO_SIZE / 2 + offsetY * outputScale - height * outputScale / 2,
        width * outputScale,
        height * outputScale,
      );
      const croppedPhoto = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!croppedPhoto) throw new Error('The edited photo could not be prepared. Please try again.');
      if (status) status.textContent = 'Uploading photo… 0%';
      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const preset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
      const uploadedURL = await uploadProfileImage(croppedPhoto, cloudName, preset, (percent) => {
        if (status) status.textContent = `Uploading photo… ${percent}%`;
      });
      const updatedProfile = await fsUpdateMyPhotoURL(uploadedURL);
      photoURL = updatedProfile.photoURL;
      renderProfileAvatar(avatarElement, photoURL, email);
      renderProfileAvatar(document.querySelector('.topbar-avatar'), photoURL, email);
      if (removeButton) removeButton.hidden = !photoURL;
      closeEditor();
      showToast('Profile photo updated.', 'success');
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not upload photo.';
      showToast(error instanceof Error ? error.message : 'Could not upload photo.', 'error');
    } finally {
      savingPhoto = false;
      if (saveButton) saveButton.disabled = false;
    }
  };
  const handleRemovePhoto = async () => {
    if (savingPhoto || !photoURL) return;
    if (removeButton) removeButton.disabled = true;
    try {
      await fsUpdateMyPhotoURL('');
      photoURL = '';
      renderProfileAvatar(avatarElement, '', email);
      renderProfileAvatar(document.querySelector('.topbar-avatar'), '', email);
      if (removeButton) removeButton.hidden = true;
      showToast('Profile photo removed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove profile photo.', 'error');
    } finally {
      if (removeButton) removeButton.disabled = false;
    }
  };

  uploadButton?.addEventListener('click', handleUploadClick);
  fileInput?.addEventListener('change', handleFileChange);
  zoomInput?.addEventListener('input', handleZoom);
  cropViewport?.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  document.getElementById('closeProfilePhoto')?.addEventListener('click', handleCloseClick);
  document.getElementById('cancelProfilePhoto')?.addEventListener('click', handleCloseClick);
  backdrop?.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleKeyDown);
  saveButton?.addEventListener('click', handleSave);
  removeButton?.addEventListener('click', handleRemovePhoto);

  return () => {
    document.getElementById('openAccountSettings')?.removeEventListener('click', openAccountSettingsModal);
    uploadButton?.removeEventListener('click', handleUploadClick);
    fileInput?.removeEventListener('change', handleFileChange);
    zoomInput?.removeEventListener('input', handleZoom);
    cropViewport?.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.getElementById('closeProfilePhoto')?.removeEventListener('click', handleCloseClick);
    document.getElementById('cancelProfilePhoto')?.removeEventListener('click', handleCloseClick);
    backdrop?.removeEventListener('click', handleBackdropClick);
    document.removeEventListener('keydown', handleKeyDown);
    saveButton?.removeEventListener('click', handleSave);
    removeButton?.removeEventListener('click', handleRemovePhoto);
    revokeImageUrl();
  };
}

function uploadProfileImage(blob: Blob, cloudName: string, preset: string, onProgress: (percent: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', blob, 'profile-photo.jpg');
    formData.append('upload_preset', preset);
    request.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    request.onerror = () => reject(new Error('Network error while uploading to Cloudinary. Check your connection and try again.'));
    request.onload = () => {
      let response: { secure_url?: string; error?: { message?: string } };
      try {
        response = JSON.parse(request.responseText);
      } catch {
        reject(new Error('Cloudinary returned an unreadable response. Please try again.'));
        return;
      }
      if (request.status < 200 || request.status >= 300 || !response.secure_url) {
        reject(new Error(response.error?.message || 'Cloudinary rejected the photo. Check the upload preset and try again.'));
        return;
      }
      resolve(response.secure_url);
    };
    request.send(formData);
  });
}

function currentTeacherPrefs(profile) {
  return {
    theme: isAppTheme(profile?.teacherPrefs?.theme)
      ? profile.teacherPrefs.theme
      : 'Light' as AppTheme,
    inspectLearner: typeof profile?.teacherPrefs?.inspectLearner === 'boolean'
      ? profile.teacherPrefs.inspectLearner
      : true,
  };
}

export function initPreferencesPage() {
  renderShell('settings', 'Preferences');

  const profile = storedAppProfile() || APP_USER_PROFILE || {};
  let prefs = currentTeacherPrefs(profile);
  let saving = false;
  const themeSelect = document.querySelector<HTMLSelectElement>('#themePreferenceSelect');
  const inspectionToggle = document.querySelector<HTMLInputElement>('#learnerInspectionToggle');
  const inspectionState = document.getElementById('learnerInspectionState');

  const renderPrefs = () => {
    if (themeSelect) {
      themeSelect.value = prefs.theme;
      themeSelect.disabled = saving;
    }
    if (inspectionToggle) {
      inspectionToggle.checked = prefs.inspectLearner;
      inspectionToggle.disabled = saving;
    }
    if (inspectionState) inspectionState.textContent = prefs.inspectLearner ? 'On' : 'Off';
  };

  const savePrefs = async (nextPrefs) => {
    if (saving) return;
    const previousPrefs = prefs;
    const themeChanged = nextPrefs.theme !== previousPrefs.theme;
    saving = true;
    renderPrefs();
    try {
      prefs = await fsUpdateMyTeacherPrefs(nextPrefs);
      if (themeChanged) {
        const root = document.documentElement;
        root.classList.add('theme-transitioning');
        // Force style resolution so the class is active before theme tokens change.
        void root.offsetWidth;
        window.setTimeout(() => root.classList.remove('theme-transitioning'), 450);
      }
      document.body.dataset.theme = appThemeId(prefs.theme);
      document.documentElement.dataset.theme = appThemeId(prefs.theme);
      document.body.classList.toggle('dark-mode', isDarkAppTheme(prefs.theme));
      document.documentElement.classList.remove('dark-mode-preload');
    } catch (error) {
      prefs = previousPrefs;
      showToast(error.message || 'Could not save preferences. Please try again.', 'error');
    } finally {
      saving = false;
      renderPrefs();
    }
  };

  const onThemeChange = () => {
    const theme = themeSelect?.value;
    if (isAppTheme(theme)) void savePrefs({ ...prefs, theme });
  };
  const onInspectionChange = () => {
    if (inspectionToggle) void savePrefs({ ...prefs, inspectLearner: inspectionToggle.checked });
  };

  themeSelect?.addEventListener('change', onThemeChange);
  inspectionToggle?.addEventListener('change', onInspectionChange);
  renderPrefs();

  return () => {
    themeSelect?.removeEventListener('change', onThemeChange);
    inspectionToggle?.removeEventListener('change', onInspectionChange);
  };
}
