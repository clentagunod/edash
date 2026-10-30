import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app-config', () => ({
  APP_CONFIG: { firestore: { learnerFields: ['firstName', 'guardian', 'contact', 'teacherComments', 'attendance'] } },
  canManageLearners: () => true, isTeacher: () => true, paginationPageNumbers: () => [1],
}));
vi.mock('./learner-list', () => ({ debounce: (callback: () => void) => callback }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: () => '2026-2027', initYearSwitcher: vi.fn() }));
vi.mock('./shell', () => ({
  appDateInputValue: (value: unknown) => String(value || ''), renderShell: vi.fn(), showToast: vi.fn(),
  escapeHtml: (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
}));
vi.mock('./firestore-api', () => ({
  fsGetCardPrintingPreferences: vi.fn(), fsGetPromotionConfiguration: vi.fn(), fsGetSections: vi.fn(),
}));
vi.mock('./sheets-api', () => ({ LPSApi: {
  getSchoolYears: vi.fn(), getPromotionCandidates: vi.fn(), promoteLearner: vi.fn(),
} }));

import { initPromotion, initRetention, openPromotionForm } from './promotion';
import { fsGetCardPrintingPreferences, fsGetPromotionConfiguration, fsGetSections } from './firestore-api';
import { LPSApi } from './sheets-api';
import { showToast } from './shell';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="promotionAccessNotice"></div>';
  vi.mocked(LPSApi.getSchoolYears).mockResolvedValue([{ schoolYear: '2026-2027' }, { schoolYear: '2027-2028' }]);
  vi.mocked(LPSApi.getPromotionCandidates).mockResolvedValue([]);
  vi.mocked(LPSApi.promoteLearner).mockResolvedValue({});
  vi.mocked(fsGetPromotionConfiguration).mockResolvedValue({ canPromoteStudents: true });
  vi.mocked(fsGetSections).mockResolvedValue([
    { gradeLevel: 'Grade 1', section: 'A' }, { gradeLevel: 'Grade 2', section: 'B' },
  ]);
  vi.mocked(fsGetCardPrintingPreferences).mockResolvedValue({ attendanceMonths: ['Aug'], attendanceRows: [
    { id: 'classDays', label: 'Class days' }, { id: 'daysPresent', label: 'Present' }, { id: 'daysAbsent', label: 'Absent' },
  ] });
});

describe('reviewing learner details before school-year migration', () => {
  it.each(['promotion', 'retention'] as const)('edits %s details and card records without changing the original learner', async (mode) => {
    await (mode === 'promotion' ? initPromotion() : initRetention());
    const learner = {
      learnerId: '123456789012', firstName: 'Alex', lastName: 'Reyes', gradeLevel: 'Grade 1', section: 'A', age: 7,
      eosyStatus: mode === 'promotion' ? 'Promoted' : 'Retained', guardian: 'Original guardian',
      teacherComments: ['Source comment', '', ''], attendance: { daysPresent: { Aug: '20' } },
    };
    const before = JSON.stringify(learner);
    await openPromotionForm(learner);
    const form = document.querySelector<HTMLFormElement>('#promotionForm')!;
    expect(form.querySelectorAll('[data-teacher-comment]')).toHaveLength(3);
    expect(form.querySelector('[data-promotion-field="attendance"]')).toBeNull();
    expect(form.querySelector<HTMLTextAreaElement>('[data-teacher-comment="0"]')!.value).toBe('Source comment');
    form.querySelector<HTMLTextAreaElement>('[data-teacher-comment="0"]')!.value = 'Target-year comment';
    form.querySelector<HTMLInputElement>('[aria-label="Present Aug"]')!.value = '0';
    form.querySelector<HTMLInputElement>('[data-promotion-field="guardian"]')!.value = 'Updated guardian';
    form.querySelector<HTMLInputElement>('#promotionAge')!.value = '8';
    const grade = form.querySelector<HTMLSelectElement>('#promotionGradeLevel')!;
    if (mode === 'promotion') {
      grade.value = 'Grade 2';
      grade.dispatchEvent(new Event('change', { bubbles: true }));
    } else expect(grade.disabled).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(LPSApi.promoteLearner).toHaveBeenCalledWith('2026-2027', '2027-2028', learner.learnerId,
      expect.objectContaining({ gradeLevel: mode === 'promotion' ? 'Grade 2' : 'Grade 1', age: 8, guardian: 'Updated guardian',
        teacherComments: ['Target-year comment', '', ''], attendance: { classDays: { Aug: '' }, daysPresent: { Aug: '0' }, daysAbsent: { Aug: '' } },
      }), mode));
    expect(JSON.stringify(learner)).toBe(before);
  });

  it('prevents migration when card settings cannot be loaded', async () => {
    vi.mocked(fsGetCardPrintingPreferences).mockRejectedValueOnce(new Error('Offline'));
    await initPromotion();
    await openPromotionForm({ learnerId: '123456789012', gradeLevel: 'Grade 1', section: 'A', age: 7 });
    document.querySelector('#promotionForm')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'), 'error'));
    expect(LPSApi.promoteLearner).not.toHaveBeenCalled();
  });
});
