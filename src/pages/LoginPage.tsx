import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/pages/login.css';
import html from './markup/login.html?raw';
import { forceLoginPageLightTheme, initLoginPage } from '../lib/auth';
import { loadVideoWhenVisible } from '../lib/lazy-video';
import { auth } from '../lib/firebase';
import { appDocumentTitle, clearVisitorSession, ensureVisitorSession, updateSchoolFavicon } from '../lib/app-config';
import { clearTenantSession } from '../lib/tenant-session';
import { clearStoredSchool, getStoredSchool } from '../lib/school-registry';
import TestModeStamp from '../components/TestModeStamp';

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

export default function LoginPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    forceLoginPageLightTheme();
    const container = containerRef.current;
    const school = getStoredSchool();
    if (!school) {
      navigate('/select-school', { replace: true });
      return;
    }

    const loginShell = container?.querySelector<HTMLElement>('.login-shell');
    if (loginShell) {
      loginShell.dataset.schoolAccent = 'true';
      loginShell.style.setProperty('--school-accent', school.colorGradientTag || '#667064');
    }

    const image = container?.querySelector<HTMLImageElement>('.login-brand-mark img');
    const fallbackIcon = container?.querySelector<SVGElement>('#brandFallbackIcon');
    const schoolName = container?.querySelector<HTMLHeadingElement>('#loginSchoolName');
    const schoolTagline = container?.querySelector<HTMLParagraphElement>('#loginSchoolTagline');
    const schoolLabel = container?.querySelector<HTMLDivElement>('.login-brand-text .eyebrow');
    const projectName = container?.querySelector<HTMLDivElement>('#loginProjectName');
    const footer = container?.querySelector<HTMLParagraphElement>('.site-footer p');
    const media = container?.querySelector<HTMLElement>('#loginSchoolMedia');
    const changeSchoolButton = container?.querySelector<HTMLButtonElement>('#changeSchoolBtn');
    const visitorBtn = container?.querySelector<HTMLButtonElement>('#visitorLoginBtn');
    const parentBtn = container?.querySelector<HTMLButtonElement>('#parentLoginBtn');
    const forgotLink = container?.querySelector<HTMLAnchorElement>('#forgotPasswordLink');
    const passwordToggle = container?.querySelector<HTMLButtonElement>('#togglePasswordVisibility');
    const passwordInput = container?.querySelector<HTMLInputElement>('#password');
    const schoolLogoUrl = safeMediaUrl(school.logoUrl);

    if (schoolName) schoolName.textContent = school.name;
    if (schoolTagline) {
      const tagline = school.tagline?.trim() || '';
      schoolTagline.textContent = tagline ? `"${tagline}"` : '';
      schoolTagline.hidden = !tagline;
    }
    if (schoolLabel) schoolLabel.textContent = 'Your school workspace';
    if (projectName) projectName.textContent = school.projectName?.trim() || school.nickname?.trim() || school.name;
    if (image && fallbackIcon) {
      image.style.display = schoolLogoUrl ? '' : 'none';
      fallbackIcon.style.display = schoolLogoUrl ? 'none' : 'block';
      if (schoolLogoUrl) {
        image.src = schoolLogoUrl;
        image.alt = `${school.name} logo`;
      }
    }
    document.title = appDocumentTitle(school.name);
    updateSchoolFavicon(schoolLogoUrl || undefined);
    if (footer?.firstChild) {
      footer.firstChild.textContent = `© ${new Date().getFullYear()} ${school.name} · Courtesy of `;
    }

    let cleanupVideo = () => {};
    if (media) {
      const showVideoPlaceholder = () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'school-video-placeholder school-video-placeholder--missing';
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', 'Missing video please provide');
        placeholder.textContent = 'Missing video please provide';
        media.replaceChildren(placeholder);
      };
      const videoUrl = school.videoUrl ? safeMediaUrl(school.videoUrl) : null;
      if (videoUrl) {
        const video = document.createElement('video');
        video.className = 'school-preview-video';
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('aria-label', `${school.name} preview video`);
        video.addEventListener('error', showVideoPlaceholder, { once: true });
        media.replaceChildren(video);
        cleanupVideo = loadVideoWhenVisible(video, media, videoUrl);
      } else {
        showVideoPlaceholder();
      }
    }

    const cleanupLogin = initLoginPage();
    const onVisitorClick = () => {
      clearVisitorSession();
      ensureVisitorSession(true);
      window.location.href = 'pages/dashboard.html?visitor=1';
    };
    const onParentClick = () => {
      clearVisitorSession();
      window.location.href = 'parent.html';
    };
    const onChangeSchool = async () => {
      const alertBox = container?.querySelector<HTMLElement>('#loginAlert');
      if (changeSchoolButton) changeSchoolButton.disabled = true;
      try {
        await auth.signOut();
        clearTenantSession();
        clearStoredSchool();
        navigate('/select-school');
      } catch (error) {
        if (alertBox) {
          alertBox.textContent = 'We could not safely leave this school workspace. Please try again.';
          alertBox.classList.add('is-visible');
        }
        console.error('Could not sign out before changing schools:', error);
      } finally {
        if (changeSchoolButton) changeSchoolButton.disabled = false;
      }
    };
    const onForgotClick = async (event: Event) => {
      event.preventDefault();
      const emailInput = container?.querySelector<HTMLInputElement>('#email');
      const email = emailInput?.value.trim() ?? '';
      const alertBox = container?.querySelector<HTMLElement>('#loginAlert');
      if (!email) {
        if (alertBox) {
          alertBox.textContent = 'Enter your email above first, then click "Forgot password?" again.';
          alertBox.classList.add('is-visible');
        }
        return;
      }
      try {
        await auth.sendPasswordResetEmail(email);
        if (alertBox) {
          alertBox.style.background = 'var(--success-100)';
          alertBox.style.color = 'var(--success-600)';
          alertBox.textContent = 'Password reset link sent. Please check your email inbox.';
          alertBox.classList.add('is-visible');
        }
      } catch (error) {
        if (alertBox) {
          alertBox.style.background = 'var(--danger-100)';
          alertBox.style.color = 'var(--danger-600)';
          alertBox.textContent = "We couldn't send a reset link for that email.";
          alertBox.classList.add('is-visible');
        }
        console.error('Password reset request failed:', error);
      }
    };
    const onPasswordToggle = () => {
      if (!passwordInput || !passwordToggle) return;
      const showPassword = passwordInput.type === 'password';
      passwordInput.type = showPassword ? 'text' : 'password';
      passwordToggle.setAttribute('aria-pressed', String(showPassword));
      passwordToggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
    };

    changeSchoolButton?.addEventListener('click', onChangeSchool);
    visitorBtn?.addEventListener('click', onVisitorClick);
    parentBtn?.addEventListener('click', onParentClick);
    forgotLink?.addEventListener('click', onForgotClick);
    passwordToggle?.addEventListener('click', onPasswordToggle);

    return () => {
      cleanupLogin?.();
      cleanupVideo();
      changeSchoolButton?.removeEventListener('click', onChangeSchool);
      visitorBtn?.removeEventListener('click', onVisitorClick);
      parentBtn?.removeEventListener('click', onParentClick);
      forgotLink?.removeEventListener('click', onForgotClick);
      passwordToggle?.removeEventListener('click', onPasswordToggle);
    };
  }, [navigate]);

  return (
    <>
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
      <TestModeStamp />
    </>
  );
}
