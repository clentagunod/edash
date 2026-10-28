import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, loginSchool, navigate } = vi.hoisted(() => ({
  auth: {
    signOut: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
  },
  loginSchool: {
    name: 'Sample Elementary School',
    nickname: 'Sample ES',
    projectName: undefined as string | undefined,
    logoUrl: '',
    videoUrl: '',
    colorGradientTag: '#50A61E' as string | undefined,
  },
  navigate: vi.fn(),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../lib/auth', () => ({
  forceLoginPageLightTheme: vi.fn(),
  initLoginPage: () => () => {},
}));
vi.mock('../lib/lazy-video', () => ({ loadVideoWhenVisible: () => () => {} }));
vi.mock('../lib/firebase', () => ({ auth }));
vi.mock('../lib/app-config', () => ({
  appDocumentTitle: (name: string) => name,
  clearVisitorSession: vi.fn(),
  ensureVisitorSession: vi.fn(),
  updateSchoolFavicon: vi.fn(),
}));
vi.mock('../lib/tenant-session', () => ({ clearTenantSession: vi.fn() }));
vi.mock('../lib/school-registry', () => ({
  clearStoredSchool: vi.fn(),
  getStoredSchool: () => loginSchool,
}));
vi.mock('../components/TestModeStamp', () => ({ default: () => null }));

import LoginPage from './LoginPage';

describe('LoginPage school accent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    loginSchool.projectName = undefined;
    loginSchool.colorGradientTag = '#50A61E';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('applies the selected school color as a scoped login accent without a transition', async () => {
    await act(async () => root.render(createElement(LoginPage)));

    const loginShell = container.querySelector<HTMLElement>('.login-shell');
    expect(loginShell?.style.getPropertyValue('--school-accent')).toBe('#50A61E');
    expect(loginShell?.dataset.schoolAccent).toBe('true');
    expect(loginShell?.classList.contains('school-accent-transition')).toBe(false);
  });

  it('uses a neutral accent when a school color is not set', async () => {
    loginSchool.colorGradientTag = undefined;
    await act(async () => root.render(createElement(LoginPage)));

    const loginShell = container.querySelector<HTMLElement>('.login-shell');
    expect(loginShell?.style.getPropertyValue('--school-accent')).toBe('#667064');
    expect(loginShell?.dataset.schoolAccent).toBe('true');
  });

  it('displays the registry project name as text beside the school logo', async () => {
    loginSchool.projectName = '  Project <Achieve>  ';
    await act(async () => root.render(createElement(LoginPage)));

    expect(container.querySelector('#loginProjectName')?.textContent).toBe('Project <Achieve>');
    expect(container.querySelector('#loginProjectName')?.children).toHaveLength(0);
    expect(container.querySelector('#loginSchoolName')?.textContent).toBe(loginSchool.name);
  });

  it.each([undefined, '', '   '])('uses the school nickname when projectName is %s', async (projectName) => {
    loginSchool.projectName = projectName;
    await act(async () => root.render(createElement(LoginPage)));

    expect(container.querySelector('#loginProjectName')?.textContent).toBe('Sample ES');
  });
});
