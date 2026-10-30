import { describe, expect, it, vi } from 'vitest';
import {
  collectLearnerCardFields, learnerCardRecord, loadLearnerCardFields, renderLearnerCardFields,
  type AttendancePreferences,
} from './learner-card-record';
import { organizeLearnerForm } from './learner-form-layout';

const preferences: AttendancePreferences = {
  attendanceMonths: ['Aug', 'Sep'],
  attendanceRows: [
    { id: 'daysAbsent', label: 'Absences' },
    { id: 'classDays', label: 'School days' },
    { id: 'daysPresent', label: 'Days attended' },
  ],
};

function form() {
  document.body.innerHTML = '<form id="cardForm"><div class="field-grid"></div></form>';
  return document.querySelector<HTMLFormElement>('form')!;
}

describe('persistent learner card records', () => {
  it('gives older learners independent empty defaults and preserves zero counts', () => {
    const first = learnerCardRecord();
    first.teacherComments[0] = 'Changed';
    first.attendance.daysPresent.Aug = '20';
    expect(learnerCardRecord()).toEqual({
      teacherComments: ['', '', ''], attendance: { classDays: {}, daysPresent: {}, daysAbsent: {} },
    });
    expect(learnerCardRecord({ attendance: { daysAbsent: { Aug: 0 } } }).attendance.daysAbsent.Aug).toBe('0');
  });

  it.each([-1, 1.5, 'Infinity', 'NaN', '1e3', '9007199254740992', true])('rejects invalid attendance %s', (value) => {
    expect(() => learnerCardRecord({ attendance: { daysPresent: { Aug: value } } }, true)).toThrow('whole number');
  });

  it('rejects malformed comments and attendance shapes before persistence', () => {
    expect(() => learnerCardRecord({ teacherComments: 'wrong' }, true)).toThrow('three text');
    expect(() => learnerCardRecord({ teacherComments: ['one', 'two', 3] }, true)).toThrow('three text');
    expect(() => learnerCardRecord({ attendance: [] }, true)).toThrow('monthly records');
    expect(() => learnerCardRecord({ attendance: { daysPresent: '20' } }, true)).toThrow('monthly counts');
  });

  it('uses preference order and labels, saves three terms, and preserves hidden months', () => {
    const host = form();
    const learner = {
      teacherComments: ['Good progress', 'Keep reading', 'Ready for next year'],
      attendance: { daysPresent: { Jun: '18', Aug: '20' }, daysAbsent: { Aug: '0' } },
    };
    renderLearnerCardFields(host, learner, preferences);
    organizeLearnerForm(host);
    organizeLearnerForm(host);
    expect(host.querySelectorAll('[data-teacher-comment]')).toHaveLength(3);
    expect([...host.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual(['Absences', 'School days', 'Days attended']);
    expect([...host.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Attendance', 'Aug', 'Sep', 'Total']);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Days attended Sep"]')!;
    input.value = '19';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.closest('tr')!.lastElementChild!.textContent).toBe('39');
    const saved = collectLearnerCardFields(host);
    expect(saved.teacherComments).toEqual(learner.teacherComments);
    expect(saved.attendance.daysPresent).toEqual({ Jun: '18', Aug: '20', Sep: '19' });
    expect(saved.attendance.daysAbsent.Aug).toBe('0');
    expect(learner.attendance.daysPresent).toEqual({ Jun: '18', Aug: '20' });
  });

  it('clears fields when switching learners and validates negative or fractional input', () => {
    const host = form();
    renderLearnerCardFields(host, { teacherComments: ['Old', '', ''] }, preferences);
    renderLearnerCardFields(host, {}, preferences);
    expect(host.querySelector<HTMLTextAreaElement>('[data-teacher-comment]')!.value).toBe('');
    const input = host.querySelector<HTMLInputElement>('[data-attendance-row]')!;
    input.value = '-1';
    expect(host.checkValidity()).toBe(false);
    expect(() => collectLearnerCardFields(host)).toThrow('whole number');
    input.value = '2.5';
    expect(() => collectLearnerCardFields(host)).toThrow('whole number');
    input.value = '0';
    expect(host.checkValidity()).toBe(true);
  });

  it('blocks saving if preferences fail, and prevents an older load from replacing another learner', async () => {
    const host = form();
    renderLearnerCardFields(host, { teacherComments: ['Previous', '', ''] }, preferences);
    await loadLearnerCardFields(host, {}, vi.fn().mockRejectedValue(new Error('Offline')));
    expect(host.textContent).toContain('could not be loaded');
    expect(() => collectLearnerCardFields(host)).toThrow('could not be loaded');
    let resolveFirst!: (value: AttendancePreferences) => void;
    const older = loadLearnerCardFields(host, { teacherComments: ['Older', '', ''] }, () => new Promise((resolve) => { resolveFirst = resolve; }));
    await loadLearnerCardFields(host, { teacherComments: ['Current', '', ''] }, async () => preferences);
    resolveFirst(preferences);
    await older;
    expect(collectLearnerCardFields(host).teacherComments[0]).toBe('Current');
  });
});
