import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: () => '2026-2027', initYearSwitcher: vi.fn() }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? ''),
  formatAppDate: (value: unknown) => String(value ?? ''),
  renderShell: vi.fn(), showToast: vi.fn(), startExportIndicator: vi.fn(),
}));
vi.mock('./demo-data', () => ({ DEMO_BREAKDOWN: [], DEMO_SUMMARY: {}, isSheetsApiConfigured: () => true }));
vi.mock('./app-config', () => ({ APP_CONFIG: {}, appSchoolFilePrefix: () => 'school', paginationPageNumbers: () => [] }));
vi.mock('./firestore-api', () => ({ fsGetReportsData: vi.fn(), fsSubscribeLearners: vi.fn() }));
vi.mock('./graph-enhancements', () => ({ initGraphEnhancements: vi.fn() }));

import { renderDonut } from './reports';
import reportsMarkup from '../pages/markup/reports.html?raw';

const overlapping = {
  totalLearners: 100, notTaggedCount: 10,
  fourPsCount: 70, ipCount: 40, snedCount: 0, aralCount: 20, muslimCount: 30,
};

beforeEach(() => { document.body.innerHTML = reportsMarkup; });
afterEach(() => { document.body.innerHTML = ''; });

describe('statistics program charts', () => {
  it('uses unique learner counts for the circle and enrollment percentages for all five program bars', () => {
    renderDonut(overlapping);

    const legend = [...document.querySelectorAll('#donutLegend .legend-row')];
    expect(legend.map(row => row.querySelector('.legend-key')?.textContent?.trim()))
      .toEqual(['Tagged', 'Not Tagged']);
    expect(legend[0].textContent).toContain('90.00%');
    expect(legend[1].textContent).toContain('10.00%');
    const segments = [...document.querySelectorAll('#donutSvg .distribution-segment')];
    expect(segments).toHaveLength(2);
    const radius = Number(segments[0].getAttribute('r'));
    const lengths = segments.map(segment => Number(segment.getAttribute('stroke-dasharray')?.split(' ')[0]));
    expect(lengths[0] / (2 * Math.PI * radius)).toBeCloseTo(0.9);
    expect(lengths[1] / (2 * Math.PI * radius)).toBeCloseTo(0.1);

    const meters = [...document.querySelectorAll('#programDistributionBars [role="meter"]')];
    expect(meters).toHaveLength(5);
    expect(meters.map(meter => Number(meter.getAttribute('aria-valuenow')))).toEqual([70, 40, 0, 20, 30]);
    expect(meters.every(meter => meter.getAttribute('aria-valuemax') === '100')).toBe(true);
    expect(meters[0].getAttribute('aria-valuetext')).toContain('70.00%');
  });

  it('replaces prior values with a safe empty state when enrollment becomes empty', () => {
    renderDonut(overlapping);
    renderDonut({ totalLearners: 0, notTaggedCount: 0 });

    expect(document.querySelectorAll('#programDistributionBars .program-percentage-row')).toHaveLength(5);
    expect([...document.querySelectorAll('#programDistributionBars [role="meter"]')]
      .map(meter => meter.getAttribute('aria-valuenow'))).toEqual(Array(5).fill('0'));
    expect(document.querySelectorAll('#donutLegend .legend-row')).toHaveLength(2);
    expect(document.getElementById('donutLegend')?.textContent).not.toContain('90.00%');
    expect(document.getElementById('programDistributionBars')?.textContent).not.toMatch(/NaN|Infinity/);
  });
});
