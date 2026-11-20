import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ role: 'School Admin' }));

vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? ''),
  formatAppDate: (value: unknown, fallback = '') => String(value || fallback),
  renderShell: vi.fn(), todayFormatted: () => 'Today',
}));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./demo-data', () => ({ DEMO_SUMMARY: {}, isSheetsApiConfigured: () => true }));
vi.mock('./app-config', () => ({
  isTeacher: () => session.role === 'Teacher',
  isVisitorSession: () => session.role === 'Visitor',
  storedAppProfile: () => ({ role: session.role }),
  teacherAssignmentsForSchoolYear: () => [],
}));
vi.mock('./firestore-api', () => ({
  fsGetLearners: vi.fn(), fsGetPublicStats: vi.fn(),
  fsNormalizeSchoolYear_: (year: string) => year,
  fsRefreshPublicStats: vi.fn(), fsSubscribeLearners: vi.fn(),
}));
vi.mock('./school-year', () => ({ initYearSwitcher: vi.fn() }));
vi.mock('./graph-enhancements', () => ({ initGraphEnhancements: vi.fn() }));

import { renderDashboardSummary, renderStatCards, renderVisitorDashboardSummary, visitorFallbackSummary } from './dashboard';
import dashboardMarkup from '../pages/markup/dashboard.html?raw';

const labels = (id: string) => [...document.querySelectorAll(`#${id} .stat-card .label`)].map(label => label.textContent);
const card = (label: string) => [...document.querySelectorAll('.stat-card')]
  .find(element => element.querySelector('.label')?.textContent === label);
const footer = (label: string) => card(label)?.querySelector('.stat-foot')?.textContent;
const summary = () => ({
  ...visitorFallbackSummary(), totalLearners: 200, maleCount: 90, femaleCount: 100,
  fourPsCount: 30, ipCount: 12, snedCount: 6, aralCount: 25, muslimCount: 10, notTaggedCount: 140,
});

beforeEach(() => {
  session.role = 'School Admin';
  document.body.innerHTML = dashboardMarkup;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dashboard learner and program summaries', () => {
  it.each(['School Admin', 'Teacher', 'Visitor'])('separates learner totals and program counts for %s', role => {
    session.role = role;
    if (role === 'Visitor') renderVisitorDashboardSummary(summary());
    else renderDashboardSummary(summary());

    expect(labels('statGrid')).toEqual(['Total Learners', 'Male Learners', 'Female Learners']);
    expect(labels('programStatGrid')).toEqual(['4Ps Beneficiaries', 'IP Learners', 'SNED Learners', 'ARAL Tagged', 'Muslim Learners']);
    expect(footer('Male Learners')).toBe('45.00% of total learners');
    expect(footer('Female Learners')).toBe('50.00% of total learners');
    expect(footer('Muslim Learners')).toBe('5.00% of total learners');
    const muslimLegend = [...document.querySelectorAll('#donutLegend .legend-row')]
      .find(row => row.querySelector('.legend-key')?.textContent?.trim() === 'Muslim Learners');
    expect(muslimLegend?.querySelector('.legend-val')?.textContent).toBe('10 (5.00%)');
    expect(document.querySelector('#donutSvg [data-program="muslimCount"]')?.getAttribute('aria-label'))
      .toContain('5.00% of total learners');
    expect(card('Total Learners')?.querySelector('.stat-value')?.textContent).toBe('200');
    expect(document.querySelectorAll('#programSummary .summary-row')).toHaveLength(5);
    expect(document.querySelectorAll('#programSummary a')).toHaveLength(role === 'Visitor' ? 0 : 5);
    expect(document.querySelector('#programSummary .summary-desc')?.textContent).toBeTruthy();
    const aral = [...document.querySelectorAll('#programSummary .summary-row')]
      .find(row => row.querySelector('.summary-title')?.textContent === 'ARAL Tagged Learners');
    expect(aral?.querySelector('.summary-desc')?.textContent)
      .toBe('Learners enrolled in the Academic Recovery and Accessible Learning (ARAL) program');
    expect(aral?.textContent).not.toMatch(/risk|dropping out/i);
  });

  it('labels the learner and program sections independently', () => {
    const learnerSection = document.getElementById('statGrid')?.closest('section');
    const programSection = document.getElementById('programStatGrid')?.closest('section');
    expect(learnerSection).not.toBeNull();
    expect(programSection).not.toBeNull();
    expect(learnerSection).not.toBe(programSection);
    for (const section of [learnerSection, programSection]) {
      const heading = document.getElementById(section!.getAttribute('aria-labelledby') || '');
      expect(heading?.textContent?.trim()).toBeTruthy();
      expect(section!.contains(heading)).toBe(true);
    }
  });

  it('shows zero percentages without invalid values when enrollment is empty', () => {
    renderStatCards(visitorFallbackSummary());
    expect(footer('Male Learners')).toBe('0.00% of total learners');
    expect(footer('Female Learners')).toBe('0.00% of total learners');
    expect(footer('Muslim Learners')).toBe('0.00% of total learners');
    expect(document.getElementById('statGrid')?.textContent).not.toMatch(/NaN|Infinity/);
  });
});
