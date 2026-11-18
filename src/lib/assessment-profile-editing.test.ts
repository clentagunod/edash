import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reading: { initialize: vi.fn(), reset: vi.fn(), dispose: vi.fn(), cell: vi.fn() },
  math: { initialize: vi.fn(), reset: vi.fn(), dispose: vi.fn(), cell: vi.fn() },
  getReadingProfiles: vi.fn(), getMathProfiles: vi.fn(),
  tablePageSize: 10,
  exportIndicator: { update: vi.fn(), finish: vi.fn(), close: vi.fn(), cancelled: false },
}));

vi.mock('./profile-editor', () => ({ createProfileEditor: ({ kind }: { kind: 'reading' | 'math' }) => mocks[kind] }));
vi.mock('./sheets-api', () => ({ LPSApi: { getReadingProfiles: mocks.getReadingProfiles, getMathProfiles: mocks.getMathProfiles } }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./shell', () => ({ escapeHtml: (value: unknown) => String(value ?? ''), renderShell: vi.fn(), showToast: vi.fn(), startExportIndicator: vi.fn(() => mocks.exportIndicator) }));
vi.mock('./app-config', () => ({ APP_CONFIG: { branding: { schoolName: 'Test school' } }, appSchoolFilePrefix: () => 'test-school', paginationPageNumbers: () => [], isTeacher: () => false }));
vi.mock('./preference-runtime', () => ({ currentUserPreferences: () => ({ tablePageSize: mocks.tablePageSize }), restoreFilterControls: vi.fn(), rememberFilterControls: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: () => '2026-2027', initYearSwitcher: vi.fn() }));
vi.mock('./learner-list', () => ({ debounce: (callback: unknown) => callback }));
vi.mock('./graph-enhancements', () => ({ initGraphEnhancements: vi.fn() }));

import { exportReadingExcel, initReadingProfiles, loadReadingProfiles, readingMeasure, readingProfiles } from './reading-profile';
import { exportMathExcel, initMathProfiles, loadMathProfiles, mathMeasure } from './math-profile';
import { initYearSwitcher } from './school-year';
import { rememberFilterControls, restoreFilterControls } from './preference-runtime';
import readingMarkup from '../pages/markup/reading-profile.html?raw';
import mathMarkup from '../pages/markup/math-profile.html?raw';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tablePageSize = 10;
  mocks.reading.cell.mockReturnValue('');
  mocks.math.cell.mockReturnValue('');
  mocks.reading.initialize.mockResolvedValue(undefined);
  mocks.math.initialize.mockResolvedValue(undefined);
  mocks.getReadingProfiles.mockResolvedValue([]);
  mocks.getMathProfiles.mockResolvedValue([]);
  document.body.innerHTML = '<button id="exportReadingBtn"></button><button id="exportMathBtn"></button><tbody id="readingTableBody"></tbody><tbody id="mathTableBody"></tbody>';
});

describe.each([
  ['reading', readingMarkup, initReadingProfiles, loadReadingProfiles, mocks.getReadingProfiles, exportReadingExcel],
  ['math', mathMarkup, initMathProfiles, loadMathProfiles, mocks.getMathProfiles, exportMathExcel],
] as const)('%s profile names and sorting', (prefix, markup, initialize, load, getRecords, exportExcel) => {
  const records = [
    { learnerId: '3', name: 'Ana Maria Zulu', firstName: 'Ana', middleName: 'Maria', lastName: 'Zulu', gradeLevel: 'Grade 1', gender: 'Female' },
    { learnerId: '1', name: 'Ben Santos Alpha', firstName: 'Ben', middleName: 'Santos', lastName: 'Alpha', gradeLevel: 'Grade 6', gender: 'Male' },
    { learnerId: '2', name: 'Carla Rosa Middle', firstName: 'Carla', middleName: 'Rosa', lastName: 'Middle', gradeLevel: 'Grade 3', gender: 'Female' },
  ];
  function mountControls() {
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    const sortControls = parsed.querySelector('.profile-sort-controls')!;
    expect(sortControls).toBe(parsed.querySelector('.profile-filters')!.lastElementChild);
    document.body.innerHTML = `<button id="export${prefix === 'reading' ? 'Reading' : 'Math'}Btn"></button><input id="${prefix}Search" />${sortControls.outerHTML}<table><tbody id="${prefix}TableBody"></tbody></table><span id="${prefix}PageInfo"></span><div id="${prefix}PagerBtns"></div>`;
    getRecords.mockResolvedValue(records.slice());
  }

  it('formats surname and middle initials, sorts before pagination, and preserves sort preferences', async () => {
    mocks.tablePageSize = 2;
    mountControls();
    const dispose = await initialize();
    await load('2026-2027');
    const names = () => [...document.querySelectorAll('.cell-name')].map(cell => cell.textContent);
    expect(names()).toEqual(['Alpha, Ben S.', 'Middle, Carla R.']);
    const sort = document.getElementById(`${prefix}Sort`) as HTMLSelectElement;
    const direction = document.getElementById(`${prefix}SortDirection`) as HTMLSelectElement;
    direction.value = 'desc';
    direction.dispatchEvent(new Event('change'));
    expect(names()).toEqual(['Zulu, Ana M.', 'Middle, Carla R.']);
    sort.value = 'gradeLevel';
    direction.value = 'asc';
    sort.dispatchEvent(new Event('change'));
    expect(names()).toEqual(['Zulu, Ana M.', 'Middle, Carla R.']);
    expect(mocks[prefix].reset).toHaveBeenCalledOnce();
    expect(rememberFilterControls).toHaveBeenLastCalledWith(`${prefix}:2026-2027`, expect.arrayContaining([`${prefix}Sort`, `${prefix}SortDirection`]));
    expect(restoreFilterControls).toHaveBeenCalledWith(`${prefix}:2026-2027`, expect.arrayContaining([`${prefix}Sort`, `${prefix}SortDirection`]));
    dispose();
  });

  it('finds learners by either their original full name or the displayed surname-first name', async () => {
    mountControls();
    const dispose = await initialize();
    await load('2026-2027');
    const search = document.getElementById(`${prefix}Search`) as HTMLInputElement;
    search.value = 'Ana Maria Zulu';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.cell-name')).toHaveLength(1);
    expect(document.querySelector('.cell-name')!.textContent).toBe('Zulu, Ana M.');
    search.value = 'Zulu, Ana M.';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.cell-name')).toHaveLength(1);
    dispose();
  });

  it('exports all records in the selected order with the displayed name convention', async () => {
    mocks.tablePageSize = 2;
    mountControls();
    const dispose = await initialize();
    await load('2026-2027');
    const sort = document.getElementById(`${prefix}Sort`) as HTMLSelectElement;
    sort.value = 'gradeLevel';
    sort.dispatchEvent(new Event('change'));
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let download!: Blob;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => { download = blob as Blob; return 'blob:profile-export'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await exportExcel();
      const workbook = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(download);
      });
      expect(workbook).toContain('Zulu, Ana M.');
      expect(workbook).toContain('Middle, Carla R.');
      expect(workbook).toContain('Alpha, Ben S.');
      expect(workbook.indexOf('Zulu, Ana M.')).toBeLessThan(workbook.indexOf('Middle, Carla R.'));
      expect(workbook.indexOf('Middle, Carla R.')).toBeLessThan(workbook.indexOf('Alpha, Ben S.'));
      expect(workbook).not.toContain('Ana Maria Zulu');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
      dispose();
    }
  });
});

describe('assessment profile editing integration', () => {
  it('edits the original CRLA field with CRLA classification choices', () => {
    mocks.reading.cell.mockReturnValue('<select></select>');
    const record = { learnerId: 'learner-1', name: 'Learner One', gradeLevel: 'Grade 2', reference: 'CRLA', mosy: 'Developing' };
    expect(readingMeasure(record, 'mosy')).toContain('<select></select>');
    expect(mocks.reading.cell).toHaveBeenCalledWith(record, 'mosyCRLA', 'Developing', expect.objectContaining({ choices: expect.arrayContaining(['Developing', 'Grade Ready']) }));
  });

  it('preserves a stored Phil-IRI reference and infers CRLA for a blank lower-grade profile', () => {
    readingMeasure({ gradeLevel: 'Grade 2', reference: 'Phil-IRI', eosy: 'Instructional' }, 'eosy');
    expect(mocks.reading.cell).toHaveBeenLastCalledWith(expect.anything(), 'eosyPhilIRI', 'Instructional', expect.objectContaining({ choices: expect.arrayContaining(['Independent', 'Instructional']) }));
    readingMeasure({ gradeLevel: 'Grade 3' }, 'bosy');
    expect(mocks.reading.cell).toHaveBeenLastCalledWith(expect.anything(), 'bosyCRLA', '', expect.anything());
    readingMeasure({ gradeLevel: 'Grade 5' }, 'bosy');
    expect(mocks.reading.cell).toHaveBeenLastCalledWith(expect.anything(), 'bosyPhilIRI', '', expect.anything());
  });

  it('edits the original RMA field without changing read-only display', () => {
    const record = { gradeLevel: 'Grade 6', bosy: 'Proficient' };
    expect(mathMeasure(record, 'bosy')).toContain('<strong>Proficient</strong>');
    expect(mocks.math.cell).toHaveBeenLastCalledWith(record, 'bosyRMA', 'Proficient', expect.objectContaining({ choices: expect.arrayContaining(['Proficient', 'Not Proficient']) }));
  });

  it('initializes and disposes both editing controllers with their pages', async () => {
    const disposeReading = await initReadingProfiles();
    const disposeMath = await initMathProfiles();
    expect(mocks.reading.initialize).toHaveBeenCalledOnce();
    expect(mocks.math.initialize).toHaveBeenCalledOnce();
    disposeReading();
    disposeMath();
    expect(mocks.reading.dispose).toHaveBeenCalledOnce();
    expect(mocks.math.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['reading', initReadingProfiles],
    ['math', initMathProfiles],
  ] as const)('keeps the active %s editor alive when an older async mount finishes and cleans up', async (kind, initialize) => {
    let finishFirst!: () => void;
    mocks[kind].initialize.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }));
    const firstMount = initialize();
    const disposeActiveMount = await initialize();
    finishFirst();
    const disposeStaleMount = await firstMount;
    disposeStaleMount();
    expect(initYearSwitcher).toHaveBeenCalledOnce();
    expect(mocks[kind].dispose).not.toHaveBeenCalled();
    disposeActiveMount();
    expect(mocks[kind].dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['reading', initReadingProfiles],
    ['math', initMathProfiles],
  ] as const)('ignores an old %s cleanup after a newer mount has initialized', async (kind, initialize) => {
    const disposeFirst = await initialize();
    const disposeSecond = await initialize();
    disposeFirst();
    expect(mocks[kind].dispose).not.toHaveBeenCalled();
    disposeSecond();
    disposeSecond();
    expect(mocks[kind].dispose).toHaveBeenCalledOnce();
  });

  it('preserves editing after save refresh and resets editing on school-year loads', async () => {
    await loadReadingProfiles('2026-2027', true);
    await loadMathProfiles('2026-2027', true);
    expect(mocks.reading.reset).not.toHaveBeenCalled();
    expect(mocks.math.reset).not.toHaveBeenCalled();
    await loadReadingProfiles('2025-2026');
    await loadMathProfiles('2025-2026');
    expect(mocks.reading.reset).toHaveBeenCalledOnce();
    expect(mocks.math.reset).toHaveBeenCalledOnce();
  });

  it('ignores an old school-year response after the selected year changes', async () => {
    let resolveOld!: (records: unknown[]) => void;
    mocks.getReadingProfiles.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const oldLoad = loadReadingProfiles('2025-2026');
    await loadReadingProfiles('2026-2027');
    resolveOld([{ learnerId: 'old-year', name: 'Old Learner' }]);
    await oldLoad;
    expect(readingProfiles).toEqual([]);
  });

  it('reports refresh failures to the save controller instead of reporting stale data as refreshed', async () => {
    mocks.getReadingProfiles.mockRejectedValue(new Error('Reading refresh failed'));
    mocks.getMathProfiles.mockRejectedValue(new Error('Math refresh failed'));
    await expect(loadReadingProfiles('2026-2027', true)).rejects.toThrow('Reading refresh failed');
    await expect(loadMathProfiles('2026-2027', true)).rejects.toThrow('Math refresh failed');
    await expect(loadReadingProfiles('2026-2027')).resolves.toBeUndefined();
    await expect(loadMathProfiles('2026-2027')).resolves.toBeUndefined();
  });
});
