import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./enrollment-data', () => ({ enrollmentGradeLabel: (grade: string) => grade }));
vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: vi.fn(), initYearSwitcher: vi.fn() }));
const shellMocks = vi.hoisted(() => ({ showToast: vi.fn() }));
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
} from './grades-profile';
import gradesMarkup from '../pages/markup/grades-profile.html?raw';

afterEach(() => {
  vi.restoreAllMocks();
  shellMocks.showToast.mockClear();
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
