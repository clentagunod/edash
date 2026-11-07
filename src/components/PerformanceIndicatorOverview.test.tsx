import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPerformanceConfig, performanceYear, type PerformanceConfig } from '../lib/performance-indicators';
const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../lib/performance-indicators-api', () => ({ subscribePerformanceConfig: mocks.subscribe }));
import PerformanceIndicatorOverview from './PerformanceIndicatorOverview';
import DashboardModes from './DashboardModes';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('Performance Indicator dashboard', () => {
  let root: Root, host: HTMLDivElement, config: PerformanceConfig;
  beforeEach(() => {
    vi.clearAllMocks(); config = emptyPerformanceConfig();
    for (let start = 2019; start <= 2025; start++) config.configurations[performanceYear(start)] = { indicators: {
      graduation: { numerator: 40 + start - 2019, denominator: 50 }, dropout: { numerator: 0, denominator: 50 },
    } };
    mocks.subscribe.mockImplementation(onValue => { onValue(config); return mocks.unsubscribe; });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
  it('renders all twelve charts, with real zero rates and missing values distinguished', async () => {
    await act(async () => root.render(<PerformanceIndicatorOverview config={config} />));
    expect(host.querySelectorAll('.pi-chart-card')).toHaveLength(12);
    expect(host.querySelector('.pi-chart-metric strong')?.textContent).toBe('92.00%');
    expect(host.querySelectorAll('.pi-chart-metric strong')[6].textContent).toBe('0.00%');
    expect(host.querySelectorAll('.pi-chart-metric strong')[1].textContent).toBe('No data');
    expect(host.querySelectorAll('.pi-chart-card')[0].querySelectorAll('.pi-chart-bar-group')).toHaveLength(5);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it('moves all charts together between earlier and later windows', async () => {
    await act(async () => root.render(<PerformanceIndicatorOverview config={config} />));
    const earlier = host.querySelector<HTMLButtonElement>('[aria-label="View earlier school years"]')!;
    await act(async () => earlier.click());
    expect(host.querySelector('.pi-timeline-heading strong')?.textContent).toContain('2020-2021');
    expect(host.querySelector('.pi-chart-metric strong')?.textContent).toBe('90.00%');
    await act(async () => earlier.click());
    expect(earlier.disabled).toBe(true);
    expect(host.querySelector('.pi-timeline-heading strong')?.textContent).toContain('2019-2020');
    expect(host.querySelectorAll('.pi-chart-card')[0].querySelectorAll('.pi-bar-year')[0].textContent).toBe('2019–20');
  });
  it('subscribes for public viewers and cleans up the listener on unmount', async () => {
    await act(async () => root.render(<PerformanceIndicatorOverview />));
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div />));
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('shows a helpful empty state without inventing values', async () => {
    await act(async () => root.render(<PerformanceIndicatorOverview config={emptyPerformanceConfig()} />));
    expect(host.textContent).toContain('Your performance history starts here');
    expect(host.querySelector('.pi-chart-card')).toBeNull();
  });
  it('clears cached charts if the server denies the visitor read, and recovers after retry', async () => {
    let rejectRead: (error: Error) => void;
    mocks.subscribe.mockImplementation((onValue, onError) => {
      onValue(config);
      rejectRead = onError;
      return mocks.unsubscribe;
    });
    await act(async () => root.render(<PerformanceIndicatorOverview />));
    expect(host.querySelectorAll('.pi-chart-card')).toHaveLength(12);
    await act(async () => rejectRead(new Error('Missing or insufficient permissions.')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Missing or insufficient permissions.');
    expect(host.querySelector('.pi-chart-card')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('.pi-chart-card')).toHaveLength(12);
  });
  it('starts in Learner Overview and supports keyboard switching for every viewer', async () => {
    document.body.insertAdjacentHTML('beforeend', '<section id="learnerOverviewPanel">Existing learners</section><section id="performanceIndicatorPanel" hidden></section>');
    await act(async () => root.render(<DashboardModes />));
    expect(document.getElementById('learnerOverviewPanel')?.hidden).toBe(false);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    const learners = host.querySelector<HTMLButtonElement>('[data-mode="learners"]')!;
    await act(async () => learners.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.getElementById('learnerOverviewPanel')?.hidden).toBe(true);
    expect(document.getElementById('performanceIndicatorPanel')?.hidden).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('[data-mode="performance"]'));
    await act(async () => (host.querySelector('[data-mode="performance"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.getElementById('learnerOverviewPanel')?.hidden).toBe(false);
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
});
