import { act, createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, getCurrentSchoolYear, getGradeTermCount, getCardPreferences, getParentAccessEnabled, getParentLearner } = vi.hoisted(() => ({
  auth: {
    currentUser: null as { uid: string; isAnonymous: boolean } | null,
    onAuthStateChanged: vi.fn(),
    signInAnonymously: vi.fn(),
  },
  getCurrentSchoolYear: vi.fn(),
  getGradeTermCount: vi.fn(),
  getCardPreferences: vi.fn(),
  getParentAccessEnabled: vi.fn(),
  getParentLearner: vi.fn(),
}));

const schoolSelection = vi.hoisted(() => ({ active: null as null | { name: string; nickname: string; logoUrl: string } }));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

vi.mock('../lib/firebase', () => ({ parentAuth: auth }));
vi.mock('../lib/firestore-api', () => ({
  fsGetParentAccessEnabled: getParentAccessEnabled,
  fsGetParentCurrentSchoolYear: getCurrentSchoolYear,
  fsGetParentGradeTermCount: getGradeTermCount,
  fsGetParentCardPrintingPreferences: getCardPreferences,
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
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => schoolSelection.active }));
vi.mock('../lib/learner-sorting', () => ({ formatLearnerName: () => 'Sample Learner' }));

import ParentPortalPage from './ParentPortalPage';

describe('ParentPortalPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    schoolSelection.active = null;
    window.localStorage.removeItem('parent-portal-theme');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getCurrentSchoolYear.mockReset().mockResolvedValue('2026-2027');
    getGradeTermCount.mockReset().mockResolvedValue(3);
    getCardPreferences.mockReset().mockResolvedValue({ attendanceMonths: ['Sep', 'Oct'], attendanceRows: [
      { id: 'daysAbsent', label: 'Missed days' }, { id: 'daysPresent', label: 'Present' }, { id: 'classDays', label: 'Class days' },
    ] });
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
    window.history.replaceState(null, '', '/');
    window.localStorage.removeItem('parent-portal-theme');
  });

  beforeEach(() => {
    auth.onAuthStateChanged.mockReset();
    auth.signInAnonymously.mockReset();
  });

  async function lookup(lrn = '128528250041') {
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, lrn);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  it.each([
    { name: 'Riverside Elementary School', nickname: 'Riverside ES', logoUrl: '/riverside.png' },
    { name: 'Mountain View Integrated School', nickname: 'Mountain View IS', logoUrl: '/mountain-view.png' },
  ])('uses the selected school branding throughout the shared portal ($nickname)', async school => {
    schoolSelection.active = school;
    window.history.replaceState(null, '', '/parent/selected-school');
    await act(async () => root.render(createElement(ParentPortalPage)));

    expect(container.querySelector('.parent-portal-brand')?.textContent).toContain(school.name);
    expect(container.querySelector('.parent-portal-brand img')?.getAttribute('src')).toBe(school.logoUrl);
    expect(container.querySelector('.parent-portal-intro')?.textContent).toContain(school.name);
    expect(container.querySelector('.parent-portal-footer')?.textContent).toContain(school.name);
    expect(document.title).toContain(school.name);
    expect(container.querySelector('.parent-portal-back')?.getAttribute('href')).toBe('/select-school');
  });

  it('keeps search progress and a missing-record response accessible without retaining stale learner details', async () => {
    await act(async () => root.render(createElement(ParentPortalPage)));
    expect(container.querySelector('.parent-empty-state')).not.toBeNull();
    await lookup();
    expect(container.querySelector('.parent-result')).not.toBeNull();

    let finishLookup!: (record: null) => void;
    getParentLearner.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }));
    await lookup('128528250042');
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector<HTMLInputElement>('#parentLearnerId')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.parent-search-row button')?.disabled).toBe(true);
    expect(container.querySelector('.parent-result')).toBeNull();
    expect(container.querySelector('.parent-empty-state [role="status"]')?.textContent).toContain('retrieve the school record');

    await act(async () => finishLookup(null));
    expect(form.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector<HTMLInputElement>('#parentLearnerId')?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No active learner record');
    expect(container.querySelector('.parent-result')).toBeNull();
  });

  it('links each record navigation item to an existing section without hiding academic details', async () => {
    await act(async () => root.render(createElement(ParentPortalPage)));
    await lookup();
    expect(document.activeElement).toBe(container.querySelector('#parent-learner-name'));
    const navigation = container.querySelector('nav[aria-label="Learner record sections"]');
    expect(navigation).not.toBeNull();
    expect([...navigation!.querySelectorAll('a')].map(link => link.getAttribute('href')))
      .toEqual(['#parent-profile', '#parent-learner-card', '#parent-other-records']);
    for (const link of navigation!.querySelectorAll('a')) {
      expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull();
    }
    expect(container.querySelector('#parent-learner-card #parentCardTerm')).not.toBeNull();
    expect(container.querySelector('#parent-other-records')?.lastElementChild?.classList.contains('parent-anecdotal-records')).toBe(true);
  });

  it('persists the portal theme independently and restores the staff theme when leaving', async () => {
    const originalStaffDarkMode = document.body.classList.contains('dark-mode');
    document.body.classList.add('dark-mode');
    window.localStorage.setItem('parent-portal-theme', 'dark');
    try {
      await act(async () => root.render(createElement(ParentPortalPage)));
      expect(document.body.classList.contains('dark-mode')).toBe(false);
      expect(container.querySelector('.parent-portal-shell')?.classList.contains('parent-portal-dark')).toBe(true);
      const toggle = container.querySelector<HTMLButtonElement>('.parent-portal-theme-toggle')!;
      expect(toggle.getAttribute('aria-label')).toBe('Switch to light mode');
      await act(async () => toggle.click());
      expect(window.localStorage.getItem('parent-portal-theme')).toBe('light');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(container.querySelector('.parent-portal-shell')?.classList.contains('parent-portal-dark')).toBe(false);
      expect(document.body.classList.contains('dark-mode')).toBe(false);

      await act(async () => root.render(null));
      expect(document.body.classList.contains('dark-mode')).toBe(true);
      await act(async () => root.render(createElement(ParentPortalPage)));
      expect(container.querySelector('.parent-portal-shell')?.classList.contains('parent-portal-dark')).toBe(false);
      expect(window.localStorage.getItem('parent-portal-theme')).toBe('light');
      await act(async () => root.render(null));
      expect(document.body.classList.contains('dark-mode')).toBe(true);
    } finally {
      document.body.classList.toggle('dark-mode', originalStaffDarkMode);
    }
  });

  it('shows only selected-term grades and comments and hides all card values, including attendance totals', async () => {
    const comments = ['First comment <b>with markup</b>\nand a new line', 'Second comment', 'Third comment'];
    getParentLearner.mockResolvedValueOnce({ learnerId: '128528250041', teacherComments: comments,
      gradesByTerm: { quarter1: { math: '81' }, quarter2: { math: '92' }, quarter3: { math: '97' } }, math: '90',
      attendance: { daysAbsent: { Sep: '0', Oct: '2' }, daysPresent: { Sep: '20', Oct: '18' }, classDays: { Sep: '20', Oct: '20' } },
    });
    await act(async () => root.render(createElement(ParentPortalPage)));
    await lookup();
    const toggle = () => act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    const select = container.querySelector<HTMLSelectElement>('#parentCardTerm')!;
    const changeTerm = (term: string) => act(() => { select.value = term; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const cells = () => [...container.querySelectorAll('.parent-attendance-table td')].map((cell) => cell.textContent);
    expect(select.value).toBe('quarter1');
    expect(container.querySelector('.parent-teacher-comment')!.textContent?.trim()).toBe('Hidden');
    expect(container.querySelector('.parent-grade-profile dd')!.textContent).toBe('Hidden');
    expect(cells().every((value) => value === 'Hidden')).toBe(true);
    expect(container.innerHTML).not.toContain(comments[1]);
    toggle();
    expect(container.querySelector('.parent-teacher-comment')!.textContent?.trim()).toBe(comments[0]);
    expect(container.querySelector('.parent-teacher-comment b')).toBeNull();
    expect(container.querySelector('.parent-grade-profile dd')!.textContent).toBe('81');
    expect(container.querySelectorAll('.parent-grade-profile')).toHaveLength(1);
    expect([...container.querySelectorAll('.parent-attendance-table thead th')].map((cell) => cell.textContent)).toEqual(['Attendance', 'Sep', 'Oct', 'Total']);
    expect([...container.querySelectorAll('.parent-attendance-table tbody th')].map((cell) => cell.textContent)).toEqual(['Missed days', 'Present', 'Class days']);
    expect(cells()).toEqual(['0', '2', '2', '20', '18', '38', '20', '20', '40']);
    for (const [term, grade, comment] of [['quarter2', '92', comments[1]], ['quarter3', '97', comments[2]]]) {
      changeTerm(term);
      expect(container.querySelector('.parent-teacher-comment')!.textContent?.trim()).toBe(comment);
      expect(container.querySelector('.parent-grade-profile dd')!.textContent).toBe(grade);
      expect(container.textContent).not.toContain(comments[0]);
    }
    changeTerm('final');
    expect(container.querySelector('.parent-teacher-comments')).toBeNull();
    expect(container.querySelector('.parent-grade-profile dd')!.textContent).toBe('90');
    changeTerm('quarter2');
    toggle();
    expect(cells().every((value) => value === 'Hidden')).toBe(true);
    expect(container.textContent).not.toContain(comments[1]);
    await lookup('128528250042');
    expect(container.querySelector<HTMLSelectElement>('#parentCardTerm')!.value).toBe('quarter1');
    expect(container.querySelector('.parent-visibility-toggle')!.getAttribute('aria-pressed')).toBe('false');
    toggle();
    expect(container.querySelector('.parent-teacher-comment')!.textContent).toBe('No teacher comment recorded for this term.');
    expect(cells().every((value) => value === '—')).toBe(true);
  });

  it('handles four-term comments and a settings read failure without hiding the learner record', async () => {
    getGradeTermCount.mockResolvedValue(4);
    getCardPreferences.mockRejectedValueOnce(new Error('Offline'));
    getParentLearner.mockResolvedValueOnce({ learnerId: '128528250041', teacherComments: ['', '', '', 'Fourth comment'], gradesByTerm: { quarter4: { math: '94' } } });
    await act(async () => root.render(createElement(ParentPortalPage)));
    await lookup();
    const select = container.querySelector<HTMLSelectElement>('#parentCardTerm')!;
    act(() => { select.value = 'quarter4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).not.toContain('Fourth comment');
    act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    expect(container.querySelector('.parent-teacher-comment')!.textContent).toBe('Fourth comment');
    expect(container.querySelector('.parent-grade-profile dd')!.textContent).toBe('94');
    expect(container.querySelector('.parent-attendance-record')!.textContent).toContain('Search again to retry');
    expect(container.textContent).toContain('Sample Learner');
  });

  it('keeps the direct school-entry navigation focused on parents', async () => {
    window.history.replaceState(null, '', '/parent/san-roque-es');
    await act(async () => root.render(createElement(ParentPortalPage)));
    expect(container.querySelector('.parent-portal-back')?.getAttribute('href')).toBe('/select-school');
    expect(container.querySelector('.parent-portal-back')?.textContent).toContain('Choose another school');
    expect(container.querySelector('.parent-portal-intro')?.textContent).toContain('San Roque Elementary School');
  });

  it('shows anecdotal records last and shares the visibility toggle, resetting for each lookup', async () => {
    const records = 'Participates actively in class.\nNeeds support with group activities.';
    getParentLearner.mockResolvedValueOnce({ learnerId: '128528250041', anecdotalRecords: records, extra: { note: 'Additional information' } });
    await act(async () => root.render(createElement(ParentPortalPage)));
    async function lookup(lrn: string) {
      const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, lrn);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    }
    await lookup('128528250041');
    expect(container.querySelector('#parent-other-records')?.lastElementChild?.classList.contains('parent-anecdotal-records')).toBe(true);
    expect(container.querySelector('.parent-anecdotal-text')?.textContent).toBe('Hidden');
    expect(container.textContent).not.toContain(records);
    act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    expect(container.querySelector('.parent-anecdotal-text')?.textContent).toBe(records);
    expect(container.querySelector('.parent-visibility-toggle')?.getAttribute('aria-pressed')).toBe('true');
    act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    expect(container.textContent).not.toContain(records);
    act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    await lookup('128528250042');
    expect(container.querySelector('.parent-anecdotal-text')?.textContent).toBe('Hidden');
    expect(container.textContent).not.toContain(records);
    act(() => container.querySelector<HTMLButtonElement>('.parent-visibility-toggle')!.click());
    expect(container.querySelector('.parent-anecdotal-text')?.textContent).toBe('No anecdotal records recorded.');
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

  it('provides a parent-facing recovery message when sign-in is unavailable', async () => {
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
      expect(container.textContent).toContain('Parent Portal is temporarily unavailable. Please contact the school office.');
    });
    const input = container.querySelector<HTMLInputElement>('#parentLearnerId')!;
    const form = container.querySelector<HTMLFormElement>('.parent-search-card')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '128528250041');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(getParentLearner).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Parent Portal is temporarily unavailable. Please contact the school office.');
    expect(container.textContent).not.toMatch(/Firebase|Anonymous sign-in|Firestore/);
    consoleError.mockRestore();
  });

  it('offers a useful recovery action without exposing backend details when a lookup is denied', async () => {
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

    expect(container.textContent).toContain('This record is unavailable right now. Check the LRN or contact the school office for assistance.');
    expect(container.textContent).not.toMatch(/schoolYears\/|Firestore|anonymous read|selected school project/);
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
    expect(container.textContent).toContain('grade details are temporarily unavailable');
    expect(container.textContent).not.toMatch(/settings\/gradeTerms|Firestore|selected school project/);
    expect(container.textContent).toContain('Sample Learner');
    consoleError.mockRestore();
  });
});
