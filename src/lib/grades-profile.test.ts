import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./enrollment-data', () => ({ enrollmentGradeLabel: (grade: string) => grade }));
vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: vi.fn(), initYearSwitcher: vi.fn() }));
const shellMocks = vi.hoisted(() => ({ showToast: vi.fn() }));
const editorMocks = vi.hoisted(() => ({ cell: vi.fn(), initialize: vi.fn(), reset: vi.fn(), dispose: vi.fn() }));
vi.mock('./profile-editor', () => ({ createProfileEditor: () => editorMocks }));
vi.mock('./preference-runtime', () => ({ currentUserPreferences: () => ({ tablePageSize: 10 }), restoreFilterControls: vi.fn(), rememberFilterControls: vi.fn(), readRememberedView: () => ({}) }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? ''),
  renderShell: vi.fn(),
  showToast: shellMocks.showToast,
  startExportIndicator: vi.fn(),
}));
vi.mock('./app-config', () => ({ paginationPageNumbers: vi.fn(() => []) }));
vi.mock('./firestore-api', () => ({
  fsGetGradeLevelGradingConfigurations: vi.fn(),
  fsGetGradeTermCount: vi.fn().mockResolvedValue(3),
}));

import {
  createGradeProfileFromLearner,
  gradeSubjectsForFilter,
  editableGradeCell,
  gradesGradingByGrade,
  gradesTerms,
  initGradesProfile,
  selectGradesTerm,
  compareGradeProfiles,
} from './grades-profile';
import { fsGetGradeTermCount } from './firestore-api';
import { initYearSwitcher } from './school-year';
import gradesMarkup from '../pages/markup/grades-profile.html?raw';

afterEach(() => {
  vi.restoreAllMocks();
  shellMocks.showToast.mockClear();
  editorMocks.cell.mockReset();
  Object.keys(gradesGradingByGrade).forEach(key => delete gradesGradingByGrade[key]);
  document.body.innerHTML = '';
});

describe('inline grade editing', () => {
  it('ignores stale initialization and its cleanup after a newer page takes ownership', async () => {
    document.body.innerHTML = gradesMarkup;
    editorMocks.initialize.mockClear();
    editorMocks.dispose.mockClear();
    vi.mocked(initYearSwitcher).mockClear();
    let resolveOlder: (count: number) => void;
    let resolveCurrent: (count: number) => void;
    vi.mocked(fsGetGradeTermCount)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveCurrent = resolve; }));

    const olderInit = initGradesProfile();
    const currentInit = initGradesProfile();
    resolveCurrent!(4);
    const currentCleanup = await currentInit;
    expect(editorMocks.initialize).toHaveBeenCalledOnce();
    expect(initYearSwitcher).toHaveBeenCalledOnce();

    resolveOlder!(1);
    const olderCleanup = await olderInit;
    olderCleanup();
    expect(editorMocks.dispose).not.toHaveBeenCalled();
    expect(editorMocks.initialize).toHaveBeenCalledOnce();
    expect(initYearSwitcher).toHaveBeenCalledOnce();
    expect(gradesTerms).toHaveLength(5);

    currentCleanup();
    expect(editorMocks.dispose).toHaveBeenCalledOnce();
  });

  it('maps the displayed subject and selected term to the editor', () => {
    document.body.innerHTML = gradesMarkup;
    selectGradesTerm('quarter2');
    const learner = { learnerId: 'learner-1', name: 'Learner One', gradeLevel: 'Grade 4', math: '88' };
    editorMocks.cell.mockReturnValue('<input data-inline-grade>');

    expect(editableGradeCell(learner, 'math')).toContain('data-inline-grade');
    expect(editorMocks.cell).toHaveBeenCalledWith(learner, 'math', '88', expect.objectContaining({ term: 'quarter2', numeric: true }));
    expect(editorMocks.cell.mock.calls[0][3].label).toContain('2nd Term');
  });

  it('uses the grade level letter scale for editing and keeps read-only display when unavailable', () => {
    document.body.innerHTML = gradesMarkup;
    selectGradesTerm('final');
    gradesGradingByGrade.grade4 = { gradingType: 'letter', letterScale: [{ letter: 'P', min: 75, max: 100 }, { letter: 'F', min: 0, max: 74 }] };
    const learner = { learnerId: 'learner-1', gradeLevel: 'Grade 4', math: 'P' };
    editorMocks.cell.mockReturnValue('');

    expect(editableGradeCell(learner, 'math')).toBe('<strong>P</strong>');
    expect(editorMocks.cell).toHaveBeenCalledWith(learner, 'math', 'P', expect.objectContaining({ term: 'final', numeric: false, choices: ['P', 'F'] }));
  });
});

describe('grade profile curricula', () => {
  it('keeps grade export available after relocating card printing to Printables', () => {
    expect(gradesMarkup).toContain('id="exportGradesBtn"');
    expect(gradesMarkup).not.toContain('printStudentCardBtn');
  });

  it('shows only the selected grade subject assignment', () => {
    const assignments = {
      'Grade 4': { configured: true, subjectIds: ['math', 'eppTle'] },
      'Grade 5': { configured: true, subjectIds: ['science'] },
    };

    expect(gradeSubjectsForFilter('Grade 4', assignments, true).map(({ id }) => id))
      .toEqual(['math', 'eppTle']);
  });

  it('shows the unique union of assigned subjects for all grades', () => {
    const assignments = {
      'Grade 4': { configured: true, subjectIds: ['math', 'eppTle'] },
      'Grade 5': { configured: true, subjectIds: ['science', 'math'] },
    };

    expect(gradeSubjectsForFilter('', assignments, true).map(({ id }) => id))
      .toEqual(['math', 'science', 'eppTle']);
  });

  it('fails closed for unconfigured grades and averages only assigned subjects', () => {
    expect(gradeSubjectsForFilter('Grade 6', {}, true)).toEqual([]);
    const profile = createGradeProfileFromLearner({
      learnerId: '123456789012',
      gradeLevel: 'Grade 4',
      math: '90',
      science: '70',
    }, ['math']);

    expect(profile.math).toBe('90');
    expect(profile.science).toBe('70');
    expect(profile.average).toBe(90);
  });

  it('does not calculate a numeric average for a letter-graded level', () => {
    const profile = createGradeProfileFromLearner({
      learnerId: '123456789012',
      gradeLevel: 'Grade 4',
      math: 'A',
      science: 'B',
    }, ['math', 'science'], undefined, undefined, 'letter');

    expect(profile.math).toBe('A');
    expect(profile.science).toBe('B');
    expect(profile.average).toBe('');
  });

  it('switches displayed grades by term without deriving the manual final grade', () => {
    const learner = {
      learnerId: '123456789012',
      gradeLevel: 'Grade 4',
      math: '94',
      gradesByTerm: {
        quarter1: { math: '80' },
        quarter2: { math: '85' },
        quarter3: { math: '90' },
        quarter4: { math: '92' },
      },
    };
    const subjects = [{ id: 'math', label: 'Math' }];

    expect(createGradeProfileFromLearner(learner, ['math'], subjects, 'quarter1').math).toBe('80');
    expect(createGradeProfileFromLearner(learner, ['math'], subjects, 'quarter4').math).toBe('92');
    expect(createGradeProfileFromLearner(learner, ['math'], subjects, 'final').math).toBe('94');
    expect(createGradeProfileFromLearner({ ...learner, math: '' }, ['math'], subjects, 'final').math).toBe('');
  });
});

describe('grade profile names and sorting', () => {
  it('places the sort controls after every filter in the filter toolbar', () => {
    document.body.innerHTML = gradesMarkup;
    const toolbar = document.querySelector('.grades-filter-toolbar');
    expect(toolbar?.lastElementChild?.classList.contains('profile-sort-controls')).toBe(true);
    expect(toolbar?.querySelector('#gradesSort')).not.toBeNull();
    expect(toolbar?.querySelector('#gradesSortDirection')).not.toBeNull();
    expect(document.querySelector('.grades-panel-header #gradesSort')).toBeNull();
    expect(document.querySelectorAll('#gradesSort')).toHaveLength(1);
  });

  it('uses surname-first display while retaining full and original names for searching', () => {
    const profile = createGradeProfileFromLearner({
      learnerId: 'learner-1', firstName: 'Juan', middleName: 'Pedro', lastName: 'Santos', suffix: 'Jr.',
      name: 'Original imported learner name', gradeLevel: 'Grade 4',
    }, []);
    expect(profile.name).toBe('Santos Jr., Juan P.');
    expect(profile.searchName).toContain('Juan Pedro Santos Jr.');
    expect(profile.searchName).toContain('Original imported learner name');
  });

  it('sorts averages numerically, retains missing averages last, and breaks ties by surname', async () => {
    document.body.innerHTML = gradesMarkup;
    const cleanup = await initGradesProfile();
    const field = document.getElementById('gradesSort') as HTMLSelectElement;
    const direction = document.getElementById('gradesSortDirection') as HTMLSelectElement;
    const profiles = [
      { learnerId: 'empty', lastName: 'Absent', average: '' },
      { learnerId: 'zulu', lastName: 'Zulu', average: '90' },
      { learnerId: 'low', lastName: 'Low', average: 9 },
      { learnerId: 'alpha', lastName: 'Alpha', average: 90 },
    ];
    field.value = 'average';
    direction.value = 'asc';
    field.dispatchEvent(new Event('change'));
    expect(profiles.slice().sort(compareGradeProfiles).map(profile => profile.learnerId)).toEqual(['low', 'alpha', 'zulu', 'empty']);
    direction.value = 'desc';
    direction.dispatchEvent(new Event('change'));
    const descending = profiles.slice().sort(compareGradeProfiles).map(profile => profile.learnerId);
    expect(descending.at(-1)).toBe('empty');
    expect(descending.indexOf('low')).toBe(2);
    expect(descending.indexOf('alpha')).toBeLessThan(descending.indexOf('zulu'));
    cleanup();
  });
});
