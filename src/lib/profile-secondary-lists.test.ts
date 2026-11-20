import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nutrition: vi.fn(), reports: vi.fn(), charts: vi.fn(), remember: vi.fn(), restore: vi.fn(),
  teacher: false,
  indicator: { update: vi.fn(), finish: vi.fn(), close: vi.fn(), cancelled: false },
}));
vi.mock('./sheets-api', () => ({ LPSApi: { getNutritionStatus: mocks.nutrition, getReportsData: mocks.reports } }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./app-config', () => ({
  APP_CONFIG: { branding: { schoolName: 'Sample School' } }, appSchoolFilePrefix: () => 'sample-school',
  isTeacher: () => mocks.teacher, paginationPageNumbers: (count: number) => Array.from({ length: count }, (_, i) => i + 1),
}));
vi.mock('./school-year', () => ({
  getSelectedSchoolYear: () => '2026-2027',
  initYearSwitcher: (load: (year: string) => Promise<void>) => load('2026-2027'),
}));
vi.mock('./preference-runtime', () => ({
  currentUserPreferences: () => ({ tablePageSize: 2 }),
  rememberFilterControls: mocks.remember, restoreFilterControls: mocks.restore,
}));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? ''), renderShell: vi.fn(), showToast: vi.fn(),
  startExportIndicator: () => mocks.indicator,
}));
vi.mock('./learner-list', () => ({ debounce: (callback: unknown) => callback }));
vi.mock('./nutrition-charts', () => ({ renderNutritionCharts: mocks.charts }));
vi.mock('./graph-enhancements', () => ({ initGraphEnhancements: vi.fn() }));
vi.mock('./profile-charts', () => ({ initProfileSectionTabs: vi.fn() }));

import { exportNutritionExcel, initNutritionPage, loadNutritionStatus } from './nutrition';
import { initEosyReport, loadEosyReport, renderEosyReport } from './eosy-report';
import nutritionMarkup from '../pages/markup/nutritional-status.html?raw';
import eosyMarkup from '../pages/markup/eosy-report.html?raw';

const records = [
  { learnerId: '000000000003', firstName: 'Ana', middleName: 'Maria Luz', lastName: 'Zulu', name: 'Ana Maria Luz Zulu', gradeLevel: 'Grade 3', section: 'B', gender: 'Female', bosyNutritionalStatus: 'Normal', eosyStatus: 'Promoted' },
  { learnerId: '000000000001', firstName: 'Ben', middleName: 'Paul', lastName: 'Alpha', name: 'Ben Paul Alpha', gradeLevel: 'Grade 1', section: 'A', gender: 'Male', bosyNutritionalStatus: 'Wasted', eosyStatus: 'Retained' },
  { learnerId: '000000000002', firstName: 'Cara', lastName: 'Bravo', name: 'Cara Bravo', gradeLevel: 'Grade 2', section: 'A', gender: 'Female', bosyNutritionalStatus: 'Normal', eosyStatus: '' },
];

function select(id: string, value: string) {
  const control = document.getElementById(id) as HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}
function names(prefix: string) {
  return [...document.querySelectorAll(`#${prefix === 'nutrition' ? 'nutritionTableBody' : 'eosyStatusTableBody'} .cell-name`)].map(node => node.textContent);
}
function blobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teacher = false;
  mocks.nutrition.mockResolvedValue(records.map(record => ({ ...record })));
  mocks.reports.mockResolvedValue({ learners: records.map(record => ({ ...record })) });
  mocks.restore.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('nutrition learner names and sorting', () => {
  it('places sort controls last, sorts the full list before pagination, and resets the page on sorting', async () => {
    document.body.innerHTML = nutritionMarkup;
    const toolbar = document.querySelector('.profile-filters')!;
    expect(toolbar.lastElementChild?.className).toBe('profile-sort-controls');
    await initNutritionPage();
    expect(names('nutrition')).toEqual(['Alpha, Ben P.', 'Bravo, Cara']);
    document.querySelector<HTMLButtonElement>('#nutritionPagerBtns button:last-child')!.click();
    expect(names('nutrition')).toEqual(['Zulu, Ana M. L.']);
    select('nutritionSort', 'gradeLevel');
    select('nutritionSortDirection', 'desc');
    expect(names('nutrition')).toEqual(['Zulu, Ana M. L.', 'Bravo, Cara']);
    expect(document.getElementById('nutritionPageInfo')?.textContent).toContain('1-2 of 3');
    expect(mocks.remember).toHaveBeenLastCalledWith('nutrition:2026-2027', expect.arrayContaining(['nutritionSort', 'nutritionSortDirection']));
  });

  it('supports original and surname-first searches without changing assessment filters', async () => {
    document.body.innerHTML = nutritionMarkup;
    await initNutritionPage();
    const search = document.getElementById('nutritionSearch') as HTMLInputElement;
    for (const query of ['Ana Maria Luz Zulu', 'Zulu, Ana M. L.']) {
      search.value = query;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      expect(names('nutrition')).toEqual(['Zulu, Ana M. L.']);
    }
    select('nutritionStatusFilter', 'Wasted');
    expect(names('nutrition')).toEqual([]);
  });

  it('restores remembered numeric sorting and exports formatted names in the selected order', async () => {
    document.body.innerHTML = nutritionMarkup;
    mocks.restore.mockImplementation(() => {
      (document.getElementById('nutritionSort') as HTMLSelectElement).value = 'learnerId';
      (document.getElementById('nutritionSortDirection') as HTMLSelectElement).value = 'desc';
    });
    await loadNutritionStatus('2026-2027');
    expect(names('nutrition')[0]).toBe('Zulu, Ana M. L.');
    const create = vi.fn((_blob: Blob) => 'blob:test');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await exportNutritionExcel();
    const workbook = await blobText(create.mock.calls[0][0]);
    expect(workbook).toContain('Zulu, Ana M. L.');
    expect(workbook.indexOf('Zulu, Ana M. L.')).toBeLessThan(workbook.indexOf('Bravo, Cara'));
    expect(workbook.indexOf('Bravo, Cara')).toBeLessThan(workbook.indexOf('Alpha, Ben P.'));
    expect(mocks.indicator.finish).toHaveBeenCalled();
  });
});

describe('nutrition section filters', () => {
  it('filters the table, summary, and graphs by section and returns to the first page', async () => {
    document.body.innerHTML = nutritionMarkup;
    await initNutritionPage();
    const section = document.getElementById('nutritionSectionFilter') as HTMLSelectElement;
    expect([...section.options].map(option => option.value)).toEqual(['', 'A', 'B']);
    document.querySelector<HTMLButtonElement>('#nutritionPagerBtns button:last-child')!.click();
    select('nutritionSectionFilter', 'A');
    expect(names('nutrition')).toEqual(['Alpha, Ben P.', 'Bravo, Cara']);
    expect(document.getElementById('nutritionPageInfo')?.textContent).toBe('1-2 of 2');
    expect(document.querySelector('#nutritionSummary strong')?.textContent).toBe('2');
    expect(mocks.charts).toHaveBeenLastCalledWith(expect.arrayContaining([records[1], records[2]]));
    expect(mocks.charts.mock.lastCall?.[0]).toHaveLength(2);
    expect(mocks.remember).toHaveBeenLastCalledWith('nutrition:2026-2027', expect.arrayContaining(['nutritionSectionFilter']));
  });

  it('combines section, grade, and status filters and clears sections unavailable in another grade', async () => {
    document.body.innerHTML = nutritionMarkup;
    await initNutritionPage();
    select('nutritionSectionFilter', 'A');
    select('nutritionGradeFilter', 'Grade 1');
    select('nutritionStatusFilter', 'Wasted');
    expect(names('nutrition')).toEqual(['Alpha, Ben P.']);
    select('nutritionStatusFilter', 'Normal');
    expect(names('nutrition')).toEqual([]);
    select('nutritionGradeFilter', 'Grade 3');
    const section = document.getElementById('nutritionSectionFilter') as HTMLSelectElement;
    expect(section.value).toBe('');
    expect([...section.options].map(option => option.value)).toEqual(['', 'B']);
    expect(names('nutrition')).toEqual(['Zulu, Ana M. L.']);
  });

  it('restores a saved section after loading its options and clears stale sections for another year', async () => {
    document.body.innerHTML = nutritionMarkup;
    mocks.restore.mockImplementation((key: string, ids: string[]) => {
      if (key === 'nutrition:2026-2027' && ids.includes('nutritionSectionFilter')) {
        const section = document.getElementById('nutritionSectionFilter') as HTMLSelectElement;
        expect([...section.options].map(option => option.value)).toContain('B');
        section.value = 'B';
      }
    });
    await loadNutritionStatus('2026-2027');
    expect(names('nutrition')).toEqual(['Zulu, Ana M. L.']);
    mocks.nutrition.mockResolvedValue([{ ...records[1], section: 'C' }]);
    await loadNutritionStatus('2025-2026');
    const section = document.getElementById('nutritionSectionFilter') as HTMLSelectElement;
    expect(section.value).toBe('');
    expect([...section.options].map(option => option.value)).toEqual(['', 'C']);
    expect(names('nutrition')).toEqual(['Alpha, Ben P.']);
  });

  it('keeps section filtering usable for teachers when the grade filter is removed', async () => {
    mocks.teacher = true;
    document.body.innerHTML = nutritionMarkup;
    await initNutritionPage();
    expect(document.getElementById('nutritionGradeFilter')).toBeNull();
    select('nutritionSectionFilter', 'B');
    expect(names('nutrition')).toEqual(['Zulu, Ana M. L.']);
  });
});

describe('EOSY learner names and sorting', () => {
  it('replaces the old direction button with field and direction selects at the end of the toolbar', async () => {
    document.body.innerHTML = eosyMarkup;
    expect(document.querySelector('.toolbar')!.lastElementChild?.className).toBe('profile-sort-controls');
    expect(document.getElementById('eosySortDirection')?.tagName).toBe('SELECT');
    await initEosyReport();
    expect(names('eosy')).toEqual(['Alpha, Ben P.', 'Zulu, Ana M. L.']);
    select('eosySort', 'eosyStatus');
    expect(names('eosy')).toEqual(['Zulu, Ana M. L.', 'Alpha, Ben P.']);
    select('eosySortDirection', 'desc');
    expect(names('eosy')).toEqual(['Alpha, Ben P.', 'Zulu, Ana M. L.']);
  });

  it('searches the full and formatted names while retaining EOSY status and grade restrictions', async () => {
    document.body.innerHTML = eosyMarkup;
    await loadEosyReport('2026-2027');
    const search = document.getElementById('eosySearch') as HTMLInputElement;
    for (const query of ['Ana Maria Luz Zulu', 'Zulu, Ana M. L.']) {
      search.value = query;
      renderEosyReport();
      expect(names('eosy')).toEqual(['Zulu, Ana M. L.']);
    }
    (document.getElementById('eosyGradeFilter') as HTMLSelectElement).value = 'Grade 1';
    renderEosyReport();
    expect(names('eosy')).toEqual([]);
    expect(mocks.remember).toHaveBeenLastCalledWith('eosy:2026-2027', expect.arrayContaining(['eosySort', 'eosySortDirection']));
  });

  it('sorts before paginating and returns to the first page after a sort change', async () => {
    document.body.innerHTML = eosyMarkup;
    mocks.reports.mockResolvedValue({ learners: Array.from({ length: 26 }, (_, i) => ({
      firstName: 'Sample', lastName: `Surname ${i + 1}`, learnerId: String(i + 1).padStart(12, '0'),
      eosyStatus: 'Promoted', gradeLevel: 'Grade 1', section: 'A',
    })) });
    await initEosyReport();
    document.querySelector<HTMLButtonElement>('#eosyPagerBtns button:last-child')!.click();
    expect(names('eosy')).toHaveLength(1);
    select('eosySort', 'learnerId');
    select('eosySortDirection', 'desc');
    expect(names('eosy')).toHaveLength(25);
    expect(document.querySelector('#eosyStatusTableBody td')?.textContent).toBe('000000000026');
    expect(document.getElementById('eosyPageInfo')?.textContent).toContain('1-25 of 26');
  });
});
