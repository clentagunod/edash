import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPerformanceConfig } from '../lib/performance-indicators';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), currentYear: vi.fn(), readFile: vi.fn() }));
vi.mock('../lib/performance-indicators-api', () => ({ getPerformanceConfig: mocks.get, savePerformanceConfig: mocks.save }));
vi.mock('../lib/firestore-api', () => ({ fsGetCurrentSchoolYear: mocks.currentYear }));
vi.mock('../lib/performance-indicators-import', async original => ({ ...await original<object>(), readPerformanceFile: mocks.readFile }));
vi.mock('./PerformanceIndicatorOverview', () => ({ default: () => <div>Dashboard preview</div> }));
import PerformanceIndicatorsPanel from './PerformanceIndicatorsPanel';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('Performance Indicators administration', () => {
  let host: HTMLDivElement, root: Root;
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
  function changeInput(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  beforeEach(() => {
    vi.clearAllMocks(); mocks.get.mockResolvedValue(emptyPerformanceConfig()); mocks.currentYear.mockResolvedValue('2025-2026');
    mocks.save.mockImplementation(async config => ({ ...config, revision: config.revision + 1 }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  it('adds independent historical years and computes manual inputs before saving', async () => {
    await act(async () => root.render(<PerformanceIndicatorsPanel />));
    expect(button('Save changes').disabled).toBe(true);
    await act(async () => button('Add 2024-2025').click());
    await act(async () => button('Add indicator').click());
    const numerator = host.querySelector<HTMLInputElement>('[aria-label="Graduation Rate numerator count"]')!;
    const denominator = host.querySelector<HTMLInputElement>('[aria-label="Graduation Rate denominator count"]')!;
    await act(async () => { changeInput(numerator, '45'); changeInput(denominator, '50'); });
    expect(host.querySelector('.pi-formula strong')?.textContent).toBe('90.00%');
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ configurations: {
      '2024-2025': { indicators: { graduation: { numerator: 45, denominator: 50 } } },
    } }));
    expect(button('Save changes').disabled).toBe(true);
    expect(host.textContent).toContain('available to everyone');
  });
  it('rejects future years while allowing years that do not exist in school structure', async () => {
    await act(async () => root.render(<PerformanceIndicatorsPanel />));
    const year = host.querySelector<HTMLInputElement>('#pi-new-year')!;
    await act(async () => changeInput(year, '2026'));
    await act(async () => button('Add 2026-2027').click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('or an earlier year');
    await act(async () => changeInput(year, '1998'));
    await act(async () => button('Add 1998-1999').click());
    expect(host.textContent).toContain('1998-1999'); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('preserves an unsaved draft and allows retry after a failed save', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => root.render(<PerformanceIndicatorsPanel />));
    await act(async () => button('Add 2024-2025').click());
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Connection lost');
    expect(button('Save changes').disabled).toBe(false);
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.save).toHaveBeenCalledTimes(2); expect(button('Save changes').disabled).toBe(true);
  });
  it('cannot save an empty replacement when initial loading fails', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Settings unavailable'));
    await act(async () => root.render(<PerformanceIndicatorsPanel />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Settings unavailable');
    expect(button('Save changes')).toBeUndefined(); expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => button('Try again').click());
    expect(button('Save changes').disabled).toBe(true);
  });
  it('previews imports and applies them to the draft without silently publishing', async () => {
    mocks.readFile.mockResolvedValue({ rows: [{ year: '2025-2026', id: 'graduation', entry: { numerator: 45, denominator: 45 }, source: 'Workbook' }], warnings: [], ignoredSheets: 2 });
    await act(async () => root.render(<PerformanceIndicatorsPanel />));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['example'], 'example.xlsx')], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(host.textContent).toContain('Review import'); expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => button('Apply to draft').click());
    expect(host.querySelector('.pi-formula strong')?.textContent).toBe('100.00%');
    expect(mocks.save).not.toHaveBeenCalled(); expect(button('Save changes').disabled).toBe(false);
  });
});
