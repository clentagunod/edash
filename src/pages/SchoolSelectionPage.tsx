import { useEffect, useRef } from 'react';
import '../styles/pages/login.css';
import html from './markup/school-selection.html?raw';
import { auth } from '../lib/firebase';
import { forceLoginPageLightTheme } from '../lib/auth';
import { loadVideoWhenVisible } from '../lib/lazy-video';
import { clearTenantSession } from '../lib/tenant-session';
import {
  getRegisteredSchools,
  getStoredSchool,
  sameSchoolRegistration,
  storeActiveSchool,
  type RegisteredSchool,
} from '../lib/school-registry';
import TestModeStamp from '../components/TestModeStamp';

const SCHOOL_REGISTRATION_API_URL = import.meta.env.VITE_SCHOOL_REGISTRATION_API_URL?.trim() || '';

function safeMediaUrl(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin)) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

export default function SchoolSelectionPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    forceLoginPageLightTheme();
    document.documentElement.classList.add('school-selection-document');
    const container = containerRef.current;
    const pickerSelect = container?.querySelector<HTMLSelectElement>('#schoolSelect');
    const directoryLoading = container?.querySelector<HTMLElement>('#schoolDirectoryLoading');
    const alert = container?.querySelector<HTMLElement>('#schoolPickerAlert');
    const continueButton = container?.querySelector<HTMLButtonElement>('#schoolContinueBtn');
    const retryButton = container?.querySelector<HTMLButtonElement>('#schoolRetryBtn');
    const registrationDialog = container?.querySelector<HTMLDialogElement>('#schoolRegistrationDialog');
    const registrationForm = container?.querySelector<HTMLFormElement>('#schoolRegistrationForm');
    const registrationStatus = container?.querySelector<HTMLElement>('#schoolRegistrationStatus');
    const registrationSubmit = container?.querySelector<HTMLButtonElement>('#schoolRegistrationSubmit');
    const registrationOpen = container?.querySelector<HTMLButtonElement>('#schoolRegistrationOpen');
    const registrationClose = container?.querySelector<HTMLButtonElement>('#schoolRegistrationClose');
    const registrationCancel = container?.querySelector<HTMLButtonElement>('#schoolRegistrationCancel');
    const media = container?.querySelector<HTMLElement>('#loginSchoolMedia');
    const schools: RegisteredSchool[] = [];
    let disposed = false;
    let cleanupVideo = () => {};
    const mobileViewport = window.matchMedia('(max-width: 860px)');

    const showError = (message: string) => {
      if (!alert) return;
      alert.textContent = message;
      alert.classList.add('is-visible');
    };
    const renderMedia = () => {
      if (!media) return;
      cleanupVideo();
      cleanupVideo = () => {};
      if (mobileViewport.matches) {
        media.replaceChildren();
        return;
      }
      const showMissingVideo = () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'school-video-placeholder school-video-placeholder--missing';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', 'Missing video please provide');
        placeholder.textContent = 'Missing video please provide';
        media.replaceChildren(placeholder);
      };
      const videoUrl = safeMediaUrl('/assets/edash/edash-video.mp4');
      if (!videoUrl) {
        showMissingVideo();
        return;
      }
      const video = document.createElement('video');
      video.className = 'school-preview-video';
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-label', 'E-Dash introduction video');
      video.addEventListener('error', showMissingVideo, { once: true });
      media.replaceChildren(video);
      cleanupVideo = loadVideoWhenVisible(video, media, videoUrl);
    };
    const loadSchools = async () => {
      if (directoryLoading) {
        directoryLoading.hidden = false;
        directoryLoading.setAttribute('aria-busy', 'true');
      }
      if (pickerSelect) pickerSelect.disabled = true;
      if (continueButton) continueButton.disabled = true;
      if (retryButton) retryButton.hidden = true;
      try {
        const registeredSchools = await getRegisteredSchools();
        if (disposed) return;
        schools.splice(0, schools.length, ...registeredSchools);
        if (pickerSelect) {
          pickerSelect.replaceChildren();
          const prompt = document.createElement('option');
          prompt.value = '';
          prompt.textContent = 'Select a registered school';
          pickerSelect.append(prompt);
          for (const school of schools) {
            const option = document.createElement('option');
            option.value = school.id;
            option.textContent = school.name;
            pickerSelect.append(option);
          }
          const currentSchool = getStoredSchool();
          const registeredCurrentSchool = currentSchool
            ? schools.find((school) => school.id === currentSchool.id)
            : undefined;
          if (registeredCurrentSchool) {
            pickerSelect.value = registeredCurrentSchool.id;
          }
          pickerSelect.disabled = schools.length === 0;
        }
        if (continueButton) continueButton.disabled = !pickerSelect?.value;
        if (schools.length === 0) showError('No active schools are available. Please contact the E-Dash administrator.');
        else alert?.classList.remove('is-visible');
        if (directoryLoading) {
          directoryLoading.hidden = true;
          directoryLoading.setAttribute('aria-busy', 'false');
        }
      } catch (error) {
        if (disposed) return;
        if (directoryLoading) {
          directoryLoading.hidden = true;
          directoryLoading.setAttribute('aria-busy', 'false');
        }
        showError('The school directory is unavailable. Check your connection and try again.');
        if (retryButton) retryButton.hidden = false;
        console.error('Could not load registered schools:', error);
      }
    };
    const onContinue = async () => {
      const selectedSchool = schools.find((school) => school.id === pickerSelect?.value);
      if (!selectedSchool) {
        showError('Choose one of the registered schools to continue.');
        return;
      }
      const storedSchool = getStoredSchool();
      alert?.classList.remove('is-visible');
      if (continueButton) {
        continueButton.disabled = true;
        continueButton.textContent = 'Opening secure workspace…';
      }
      try {
        if (storedSchool && sameSchoolRegistration(storedSchool, selectedSchool)) {
          storeActiveSchool(selectedSchool);
          window.location.assign('/login');
          return;
        }
        await auth.signOut();
        clearTenantSession();
        storeActiveSchool(selectedSchool);
        window.location.assign('/login');
      } catch (error) {
        showError('We could not safely switch school workspaces. Please try again or contact the E-Dash administrator.');
        console.error('School workspace selection failed:', error);
        if (continueButton) {
          continueButton.disabled = !pickerSelect?.value;
          continueButton.textContent = 'Continue to sign in';
        }
      }
    };
    const onRetry = () => {
      alert?.classList.remove('is-visible');
      void loadSchools();
    };
    const onSchoolChange = () => {
      const selectedSchool = schools.find((school) => school.id === pickerSelect?.value);
      if (continueButton) continueButton.disabled = !selectedSchool;
    };
    const closeRegistrationDialog = () => {
      registrationDialog?.close();
    };
    const onRegistrationDialogClick = (event: MouseEvent) => {
      if (event.target === registrationDialog) closeRegistrationDialog();
    };
    const onRegistrationOpen = () => {
      if (registrationStatus) {
        registrationStatus.hidden = true;
        registrationStatus.textContent = '';
        registrationStatus.className = 'school-registration-status';
      }
      if (registrationSubmit) {
        registrationSubmit.disabled = false;
        registrationSubmit.textContent = 'Send registration request';
      }
      registrationDialog?.showModal();
      registrationForm?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
    };
    const onRegistrationSubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      if (!registrationForm?.reportValidity()) return;
      if (!SCHOOL_REGISTRATION_API_URL) {
        if (registrationStatus) {
          registrationStatus.textContent = 'School registration is not available yet. Please contact the E-Dash administrator.';
          registrationStatus.className = 'school-registration-status is-error';
          registrationStatus.hidden = false;
        }
        return;
      }
      if (registrationSubmit) {
        registrationSubmit.disabled = true;
        registrationSubmit.textContent = 'Sending request…';
      }
      if (registrationStatus) {
        registrationStatus.hidden = true;
        registrationStatus.textContent = '';
      }
      const payload = Object.fromEntries(new FormData(registrationForm).entries());
      let submitted = false;
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        let response: Response;
        try {
          response = await fetch(SCHOOL_REGISTRATION_API_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'submitSchoolRegistration', ...payload }),
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`Registration service returned HTTP ${response.status}.`);
        const result: {
          ok: boolean;
          error?: string;
          data?: { duplicate?: boolean; status?: string; schoolName?: string };
        } = await response.json();
        if (!result.ok) throw new Error(result.error || 'The registration request could not be sent.');
        submitted = true;
        registrationForm.reset();
        if (registrationStatus) {
          if (result.data?.duplicate && result.data.status === 'Pending') {
            const schoolName = result.data.schoolName ? ` (${result.data.schoolName})` : '';
            registrationStatus.textContent = `A similar registration request${schoolName} is already pending. Please wait for the E-Dash team to review it.`;
            registrationStatus.className = 'school-registration-status is-pending';
          } else {
            registrationStatus.textContent = 'Your request has been sent. The E-Dash team will review it and contact you.';
            registrationStatus.className = 'school-registration-status is-success';
          }
          registrationStatus.hidden = false;
        }
      } catch (error) {
        console.error('School registration request failed:', error);
        if (registrationStatus) {
          registrationStatus.textContent = error instanceof Error && error.name === 'AbortError'
            ? 'The request timed out. Please check your connection and try again.'
            : 'We could not send your request. Please try again later.';
          registrationStatus.className = 'school-registration-status is-error';
          registrationStatus.hidden = false;
        }
      } finally {
        if (registrationSubmit) {
          registrationSubmit.disabled = submitted;
          registrationSubmit.textContent = submitted ? 'Request received' : 'Send registration request';
        }
      }
    };

    document.title = 'E-Dash — Choose a school';
    renderMedia();
    mobileViewport.addEventListener('change', renderMedia);
    continueButton?.addEventListener('click', onContinue);
    retryButton?.addEventListener('click', onRetry);
    pickerSelect?.addEventListener('change', onSchoolChange);
    registrationOpen?.addEventListener('click', onRegistrationOpen);
    registrationClose?.addEventListener('click', closeRegistrationDialog);
    registrationCancel?.addEventListener('click', closeRegistrationDialog);
    registrationForm?.addEventListener('submit', onRegistrationSubmit);
    registrationDialog?.addEventListener('click', onRegistrationDialogClick);
    void loadSchools();

    return () => {
      disposed = true;
      cleanupVideo();
      document.documentElement.classList.remove('school-selection-document');
      mobileViewport.removeEventListener('change', renderMedia);
      continueButton?.removeEventListener('click', onContinue);
      retryButton?.removeEventListener('click', onRetry);
      pickerSelect?.removeEventListener('change', onSchoolChange);
      registrationOpen?.removeEventListener('click', onRegistrationOpen);
      registrationClose?.removeEventListener('click', closeRegistrationDialog);
      registrationCancel?.removeEventListener('click', closeRegistrationDialog);
      registrationForm?.removeEventListener('submit', onRegistrationSubmit);
      registrationDialog?.removeEventListener('click', onRegistrationDialogClick);
    };
  }, []);

  return (
    <>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
      <TestModeStamp />
    </>
  );
}
