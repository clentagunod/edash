import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), scan: vi.fn(), dispose: vi.fn(), match: vi.fn(), load: vi.fn(), save: vi.fn(), years: vi.fn(), sections: vi.fn(), preferences: vi.fn() }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../lib/app-config', () => ({ APP_CONFIG: { schoolId: 'school-a' } }));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => ({ schoolInfo: { id: '123456' } }) }));
vi.mock('../lib/firestore-api', () => ({ fsGetSchoolYears: mocks.years, fsGetSections: mocks.sections, fsGetCardPrintingPreferences: mocks.preferences }));
vi.mock('../lib/attendance-import/worker-client', () => ({ Sf2Reader: class { parse = mocks.parse; scan = mocks.scan; dispose = mocks.dispose; } }));
vi.mock('../lib/attendance-import/sf2', () => ({ SF2_MONTHS: [{ value: 'Jul', label: 'July' }, { value: 'Aug', label: 'August' }], matchSf2Rows: mocks.match }));
vi.mock('../lib/attendance-import/store', () => ({ attendanceImportSections: (_year: string, values: unknown[]) => values, loadAttendanceImportTargets: mocks.load, importSf2Attendance: mocks.save }));

import AttendanceImportPanel from './AttendanceImportPanel';

const entry = { learnerId: '123456789012', name: 'Cruz, Ana M.', sourceName: 'CRUZ, ANA M.', rowNumber: 13, daysPresent: '21.5', daysAbsent: '0.5', classDays: '22', expectedAttendance: {}, expectedIdentity: { firstName: 'Ana', lastName: 'Cruz', gradeLevel: 'Grade 2', section: 'MELON' } };
const targetValue = JSON.stringify(['Grade 2', 'MELON']);
describe('SF2 attendance review workflow', () => {
  let root: Root;
  let host: HTMLDivElement;
  const complete = vi.fn(), busy = vi.fn();
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.parse.mockResolvedValue({ sheets: ['JULY', 'AUGUST'] });
    mocks.scan.mockResolvedValue({ month: 'Jul', rows: [], errors: [], warnings: [] });
    mocks.match.mockReturnValue({ entries: [{ ...entry }], errors: [], warnings: [], unmatchedMasterlist: [] });
    mocks.load.mockResolvedValue([{ ...entry, gradeLevel: 'Grade 2', section: 'MELON' }]);
    mocks.save.mockResolvedValue({ updated: 1, unchanged: 0 });
    mocks.years.mockResolvedValue([{ schoolYear: '2026-2027', isCurrent: true }]);
    mocks.sections.mockResolvedValue([{ gradeLevel: 'Grade 2', section: 'MELON' }, { gradeLevel: 'Grade 3', section: 'MELON' }]);
    mocks.preferences.mockResolvedValue({ attendanceMonths: ['July', 'Aug'] });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<AttendanceImportPanel authorized initialYear="2026-2027" onBusyChange={busy} onComplete={complete} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.includes(label))!;
  const control = (label: string) => [...host.querySelectorAll<HTMLSelectElement>('select')].find(value => value.parentElement?.textContent?.startsWith(label))!;
  async function select(label: string, value: string) {
    await act(async () => { const input = control(label); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  async function file(name = 'SF2.xlsx') {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size: 100, arrayBuffer: async () => new ArrayBuffer(10) }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
  async function review() {
    await select('Grade and section', targetValue); await file();
    await act(async () => button('Validate attendance').click());
  }
  async function confirm() {
    const checkbox = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes('I reviewed'))!;
    await act(async () => checkbox.click());
  }

  it('requires a section and explicit review confirmation before saving the detected month', async () => {
    await file();
    expect(button('Validate attendance').disabled).toBe(true);
    expect([...control('Grade and section').options].map(value => value.textContent)).toContain('Grade 3 · MELON');
    await select('Grade and section', targetValue);
    await act(async () => button('Validate attendance').click());
    expect(mocks.scan).toHaveBeenCalledWith(0, expect.objectContaining({ month: 'auto', schoolYear: '2026-2027', section: 'MELON', schoolId: '123456' }));
    expect(host.querySelector('tbody')?.textContent).toContain('21.5');
    expect(button('Import attendance').disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    await confirm();
    await act(async () => button('Import attendance').click());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ month: 'Jul', schoolYear: '2026-2027', overwriteExisting: false, entries: [entry], placement: { gradeLevel: 'Grade 2', section: 'MELON' } }));
    expect(complete).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('1 updated');
  });

  it('requires separate consent before overwriting an existing monthly record', async () => {
    mocks.match.mockReturnValue({ entries: [{ ...entry, expectedAttendance: { daysPresent: { July: '20' }, daysAbsent: { July: '2' }, classDays: { July: '22' } } }], errors: [], warnings: [], unmatchedMasterlist: [] });
    await review(); await confirm();
    expect(host.querySelector('tbody')?.textContent).toContain('20 / 2 / 22');
    expect(button('Import attendance').disabled).toBe(true);
    const replace = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes('Replace'))!;
    await act(async () => replace.click());
    await act(async () => button('Import attendance').click());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ overwriteExisting: true }));
  });

  it('blocks invalid learner matches and clears reviewed data after a month change', async () => {
    mocks.match.mockReturnValue({ entries: [{ ...entry }], errors: ['Row 14: no learner matches this name.'], warnings: [], unmatchedMasterlist: [] });
    await review();
    expect(host.textContent).toContain('Row 14: no learner matches this name.');
    expect(button('Import attendance').disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.matches(':disabled')).toBe(true);
    await select('Attendance month', 'Aug');
    expect(host.querySelector('tbody')).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => button('Validate attendance').click());
    expect(mocks.scan).toHaveBeenLastCalledWith(0, expect.objectContaining({ month: 'Aug' }));
  });

  it('shows manual-month and missing-masterlist warnings for explicit review', async () => {
    mocks.scan.mockResolvedValue({ month: 'Aug', rows: [], errors: [], warnings: ['Selected August overrides July in the worksheet.'] });
    mocks.match.mockReturnValue({ entries: [{ ...entry }], errors: [], warnings: ['One section learner is missing and will be left unchanged.'], unmatchedMasterlist: ['Other learner'] });
    await review();
    expect(host.textContent).toContain('Selected August overrides July');
    expect(host.textContent).toContain('One section learner is missing');
    expect(button('Import attendance').disabled).toBe(true);
  });

  it('rejects non-Excel files without starting the workbook reader', async () => {
    await file('names.csv');
    expect(host.textContent).toContain('Choose an Excel SF2 workbook');
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(host.querySelector('tbody')).toBeNull();
  });

  it('fails closed when access is revoked while validation is pending', async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.load.mockReturnValue(new Promise(value => { resolve = value; }));
    await select('Grade and section', targetValue); await file();
    await act(async () => button('Validate attendance').click());
    await act(async () => root.render(<AttendanceImportPanel authorized={false} initialYear="2026-2027" onBusyChange={busy} onComplete={complete} />));
    await act(async () => resolve([]));
    expect(host.textContent).toContain('Attendance imports are not enabled');
    expect(host.querySelector('tbody')).toBeNull();
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('requires a fresh review after a stale-data or permission error while saving', async () => {
    mocks.save.mockRejectedValue(new Error('Attendance changed after review.'));
    await review(); await confirm();
    await act(async () => button('Import attendance').click());
    expect(host.textContent).toContain('Validate again before retrying.');
    expect(host.querySelector('tbody')).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('unlocks the dialog if access is revoked and restored while a save is settling', async () => {
    let resolve!: (value: { updated: number; unchanged: number }) => void;
    mocks.save.mockReturnValue(new Promise(value => { resolve = value; }));
    await review(); await confirm();
    await act(async () => button('Import attendance').click());
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(<AttendanceImportPanel authorized={false} initialYear="2026-2027" onBusyChange={busy} onComplete={complete} />));
    await act(async () => root.render(<AttendanceImportPanel authorized initialYear="2026-2027" onBusyChange={busy} onComplete={complete} />));
    await act(async () => resolve({ updated: 1, unchanged: 0 }));
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(host.querySelector('tbody')).toBeNull();
    expect(host.querySelector('.attendance-import-panel')?.getAttribute('aria-busy')).toBe('false');
  });
});
