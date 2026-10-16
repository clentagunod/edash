import { act, createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, getCurrentSchoolYear, getGradeTermCount, getParentAccessEnabled, getParentLearner } = vi.hoisted(() => ({
  auth: {
    currentUser: null as { uid: string; isAnonymous: boolean } | null,
    onAuthStateChanged: vi.fn(),
    signInAnonymously: vi.fn(),
  },
  getCurrentSchoolYear: vi.fn(),
  getGradeTermCount: vi.fn(),
  getParentAccessEnabled: vi.fn(),
  getParentLearner: vi.fn(),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

vi.mock('../lib/firebase', () => ({ parentAuth: auth }));
vi.mock('../lib/firestore-api', () => ({
  fsGetParentAccessEnabled: getParentAccessEnabled,
  fsGetParentCurrentSchoolYear: getCurrentSchoolYear,
  fsGetParentGradeTermCount: getGradeTermCount,
  fsGetParentLearner: getParentLearner,
}));
vi.mock('../lib/cache', () => ({
  LPSCache: { getOrLoadMemory: (_key: string, loader: () => Promise<unknown>) => loader() },
}));
vi.mock('../lib/icons', () => ({ Icon: { moon: '', sun: '' } }));
vi.mock('../components/TestModeStamp', () => ({ default: () => null }));
vi.mock('../lib/app-config', () => ({
  APP_CONFIG: {
    branding: {
      schoolName: 'San Roque Elementary School',
      nickname: 'San Roque ES',
      schoolLogoUrl: '/assets/school-logo.png',
    },
    testMode: false,
  },
  appBrandAssetUrl: (value: string) => value,
  updateSchoolFavicon: vi.fn(),
}));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => null }));
vi.mock('../lib/parent-grades', () => ({ parentGradeProfiles: () => [] }));
vi.mock('../lib/learner-sorting', () => ({ formatLearnerName: () => 'Sample Learner' }));

import ParentPortalPage from './ParentPortalPage';

describe('ParentPortalPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getCurrentSchoolYear.mockReset().mockResolvedValue('2026-2027');
    getGradeTermCount.mockReset().mockResolvedValue(3);
    getParentAccessEnabled.mockReset().mockResolvedValue(true);
    getParentLearner.mockReset().mockResolvedValue({
      learnerId: '128528250041',
      firstName: 'Sample',
      lastName: 'Learner',
      birthDate: '2021-10-17',
    });
    auth.currentUser = { uid: 'anonymous-parent', isAnonymous: true };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  beforeEach(() => {
    auth.onAuthStateChanged.mockReset();
    auth.signInAnonymously.mockReset();
  });

  it('looks up an exact learner document for the configured current school year', async () => {
    await act(async () => root.render(createElement(ParentPortalPage)));
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId');
    const form = container.querySelector<HTMLFormElement>('.parent-search-card');
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(getParentLearner).toHaveBeenCalledWith('128528250041', '2026-2027');
    expect(getGradeTermCount).toHaveBeenCalledWith('2026-2027');
    expect(container.textContent).toContain('Sample Learner');
    expect(container.textContent).toContain('10/17/2021');
  });

  it('lets parents search while explaining when Parent Access is disabled', async () => {
    getParentAccessEnabled.mockResolvedValue(false);
    await act(async () => root.render(createElement(ParentPortalPage)));
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(getParentAccessEnabled).toHaveBeenCalledOnce();
    expect(getParentLearner).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Your search was received, but learner information cannot be shown right now');
    expect(container.textContent).toContain('contact the school office');
  });

  it('asks for all 12 digits before attempting a lookup', async () => {
    await act(async () => root.render(createElement(ParentPortalPage)));
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12852825004');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(getParentLearner).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter the complete 12-digit learner reference number.');
  });

  it('signs into the parent Firebase app before loading school-year settings', async () => {
    auth.currentUser = null;
    auth.onAuthStateChanged.mockImplementation((next: (user: null) => void) => {
      queueMicrotask(() => next(null));
      return () => {};
    });
    auth.signInAnonymously.mockImplementation(async () => {
      auth.currentUser = { uid: 'new-parent', isAnonymous: true };
      return { user: auth.currentUser };
    });
    getCurrentSchoolYear.mockImplementation(async () => {
      expect(auth.currentUser?.isAnonymous).toBe(true);
      return '2026-2027';
    });
    await act(async () => root.render(createElement(ParentPortalPage)));
    await vi.waitFor(() => expect(getCurrentSchoolYear).toHaveBeenCalledOnce());
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('current school year could not be loaded');
  });

  it('explains when anonymous Firebase sign-in is disabled', async () => {
    auth.currentUser = null;
    auth.onAuthStateChanged.mockImplementation((next: (user: null) => void) => {
      queueMicrotask(() => next(null));
      return () => {};
    });
    auth.signInAnonymously.mockRejectedValue(Object.assign(new Error('disabled'), {
      code: 'auth/operation-not-allowed',
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.render(createElement(ParentPortalPage)));
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Enable Anonymous sign-in in Firebase Authentication');
    });
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(getParentLearner).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enable Anonymous sign-in in Firebase Authentication');
    consoleError.mockRestore();
  });

  it('explains the active-year and rules checks when Firestore denies a lookup', async () => {
    getParentLearner.mockRejectedValue(Object.assign(new Error('permission denied'), {
      code: 'permission-denied',
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.render(createElement(ParentPortalPage)));
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain('schoolYears/2026-2027/learners/128528250041');
    expect(container.textContent).toContain('selected school project');
    consoleError.mockRestore();
  });

  it('distinguishes a denied grade-settings read after the learner record loads', async () => {
    getGradeTermCount.mockRejectedValue(Object.assign(new Error('permission denied'), {
      code: 'permission-denied',
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => root.render(createElement(ParentPortalPage)));
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain('The learner record loaded');
    expect(container.textContent).toContain('settings/gradeTerms/years/2026-2027');
    expect(container.textContent).toContain('Sample Learner');
    consoleError.mockRestore();
  });
});
