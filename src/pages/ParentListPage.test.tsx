import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParentLearner } from '../lib/parent-list';

const state = vi.hoisted(() => ({
  role: 'School Admin',
  subscribers: [] as { year: string; change: (records: ParentLearner[]) => void; error: () => void; stop: ReturnType<typeof vi.fn> }[],
  changeYear: null as null | ((year: string) => void),
  download: vi.fn().mockResolvedValue(undefined),
  stopYears: vi.fn(),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../lib/auth', () => ({ requireAuth: vi.fn().mockResolvedValue({ uid: 'staff' }) }));
vi.mock('../lib/app-config', () => ({
  appDocumentTitle: (title: string) => title,
  canManageLearners: () => ['Developer', 'School Admin', 'Registrar', 'Teacher'].includes(state.role),
  isSchoolAdmin: () => ['School Admin', 'Developer'].includes(state.role),
  isRegistrar: () => state.role === 'Registrar',
}));
vi.mock('../lib/shell', () => ({ renderShell: vi.fn(), showToast: vi.fn() }));
vi.mock('../lib/preference-runtime', () => ({ currentUserPreferences: () => ({ tablePageSize: 8 }) }));
vi.mock('../lib/school-year', () => ({
  initYearSwitcher: async (onChange: (year: string) => void) => { state.changeYear = onChange; onChange('2026-2027'); },
  schoolYearsLiveUnsubscribe: state.stopYears,
}));
vi.mock('../lib/firestore-api', () => ({
  fsSubscribeLearners: (year: string, change: (records: ParentLearner[]) => void, error: () => void) => {
    const stop = vi.fn();
    state.subscribers.push({ year, change, error, stop });
    return stop;
  },
}));
vi.mock('../lib/parent-list-export', () => ({ downloadParentList: state.download }));

import ParentListPage from './ParentListPage';

describe('parent list page', () => {
  let container: HTMLDivElement;
  let root: Root;
  const records: ParentLearner[] = Array.from({ length: 12 }, (_, i) => ({
    learnerId: String(i).padStart(12, '0'), guardian: `Parent ${String(i).padStart(2, '0')}`,
    firstName: `Child ${i}`, lastName: 'Cruz', gradeLevel: i % 2 ? 'Grade 2' : 'Grade 1', section: i % 2 ? 'Ruby' : 'Amber',
  }));
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = 'School Admin';
    state.subscribers = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function mount(role = 'School Admin', data = records) {
    state.role = role;
    await act(async () => root.render(<ParentListPage />));
    if (state.subscribers.length) await act(async () => state.subscribers.at(-1)!.change(data));
  }
  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
  }
  async function select(label: string, value: string) {
    await act(async () => {
      const node = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      node.value = value; node.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it.each(['School Admin', 'Registrar', 'Developer'])('offers filters to %s and resets pagination when filtering', async role => {
    await mount(role);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    await select('Filter by grade level', 'Grade 2');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(container.textContent).toContain('Showing 1–6 of 6');
    const sections = container.querySelector<HTMLSelectElement>('[aria-label="Filter by section"]')!;
    expect([...sections.options].map(option => option.value)).toEqual(['', 'Ruby']);
  });

  it('shows teachers only their provided scope without search or grade/section filters', async () => {
    await mount('Teacher', [records[0], { ...records[2], guardian: records[0].guardian }]);
    expect(container.querySelector('[aria-label="Filter by grade level"]')).toBeNull();
    expect(container.querySelector('[aria-label="Filter by section"]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelectorAll('.parent-child-name')).toHaveLength(2);
    expect(container.querySelectorAll('.parent-record-name')).toHaveLength(1);
    expect(container.querySelector('.parent-record-name')?.closest('td')?.rowSpan).toBe(2);
    expect(container.querySelector<HTMLTableCellElement>('.parent-index')?.rowSpan).toBe(2);
    expect(container.querySelectorAll('thead th')).toHaveLength(8);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Delete|Add Parent|Edit/);
    expect(container.querySelector('[aria-label="Sort parents"]')).not.toBeNull();
  });

  it('exports every matching page as Excel in the selected order without format options', async () => {
    await mount();
    expect(container.querySelector('[aria-label="Export format"]')).toBeNull();
    await select('Sort parents', 'name-desc');
    await act(async () => button('Export Excel').click());
    const [parents, year] = state.download.mock.calls[0];
    expect(parents).toHaveLength(12);
    expect(parents[0].name).toBe('Parent 11');
    expect(year).toBe('2026-2027');
    expect(state.download.mock.calls[0]).toHaveLength(2);
    await select('Filter by grade level', 'Grade 1');
    await act(async () => button('Export Excel').click());
    expect(state.download.mock.calls[1][0]).toHaveLength(6);
    expect(state.download.mock.calls[1][0][0].name).toBe('Parent 10');
    expect(state.download.mock.calls[1]).toHaveLength(2);
  });

  it('keeps siblings together and continues parent indexes across pages', async () => {
    await mount('School Admin', [...records, {
      ...records[7], learnerId: '001234567890', firstName: 'Sibling', contact: '09123456789',
    }]);
    const indexes = () => [...container.querySelectorAll('.parent-index')].map(cell => cell.textContent);
    expect(indexes()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(9);
    expect(container.querySelectorAll('.parent-record-name')).toHaveLength(8);
    expect(container.querySelectorAll('.parent-group-cell[rowspan="2"]')).toHaveLength(2);
    const sibling = [...container.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('Sibling'))!;
    expect(sibling.querySelector('.parent-learner-id')?.textContent).toBe('001234567890');
    expect(sibling.querySelector('.parent-contact')?.textContent).toBe('09123456789');
    expect(sibling.querySelector('.parent-school-year')?.textContent).toBe('2026-2027');
    expect(container.querySelector('.parent-contact')?.textContent).toBe('N/A');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
    expect(indexes()).toEqual(['9', '10', '11', '12']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    await select('Filter by grade level', 'Grade 2');
    expect(indexes()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('clears results on year changes, ignores stale snapshots, and releases listeners', async () => {
    await mount();
    const old = state.subscribers[0];
    await act(async () => state.changeYear!('2025-2026'));
    expect(old.stop).toHaveBeenCalledOnce();
    expect(button('Export Excel').disabled).toBe(true);
    await act(async () => old.change(records));
    expect(container.textContent).toContain('Loading parents / guardians');
    const current = state.subscribers[1];
    await act(async () => current.change([records[1]]));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    await act(async () => root.unmount());
    expect(current.stop).toHaveBeenCalledOnce();
    expect(state.stopYears).toHaveBeenCalledOnce();
  });

  it('clears data and disables exports on a live error, then permits retry', async () => {
    await mount();
    await act(async () => state.subscribers[0].error());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load');
    expect(button('Export Excel').disabled).toBe(true);
    expect(container.querySelector('.parent-record-name')).toBeNull();
    await act(async () => button('Try again').click());
    expect(state.subscribers[0].stop).toHaveBeenCalledOnce();
    await act(async () => state.subscribers[1].change([]));
    expect(container.textContent).toContain('No named parents / guardians');
  });

  it('does not subscribe for an unauthorized role', async () => {
    await mount('Visitor');
    expect(state.subscribers).toHaveLength(0);
    expect(container.textContent).toContain('school staff only');
    expect(button('Export Excel').disabled).toBe(true);
  });
});
