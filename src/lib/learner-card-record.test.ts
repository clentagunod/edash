import { describe, expect, it, vi } from 'vitest';
import {
  collectLearnerCardFields, learnerCardRecord, loadLearnerCardFields, renderLearnerCardFields, syncLearnerCardTerm,
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
  it('switches the visible term comment while retaining every draft and supporting a configured fourth term', () => {
    const host = form();
    host.insertAdjacentHTML('afterbegin', '<select id="f_gradeTerm"><option value="quarter1">1st Term</option><option value="quarter2">2nd Term</option><option value="quarter3">3rd Term</option><option value="quarter4">4th Term</option><option value="final">Final Grade</option></select>');
    renderLearnerCardFields(host, { teacherComments: ['First', 'Second', 'Third'] }, preferences);
    const select = host.querySelector<HTMLSelectElement>('select')!;
    const visible = () => [...host.querySelectorAll<HTMLTextAreaElement>('[data-teacher-comment]')].filter((input) => !input.closest('label')!.hidden);
    expect(visible().map((input) => input.value)).toEqual(['First']);
    visible()[0].value = 'First draft';
    select.value = 'quarter2';
    syncLearnerCardTerm(host);
    expect(visible().map((input) => input.value)).toEqual(['Second']);
    visible()[0].value = 'Second draft';
    syncLearnerCardTerm(host, 'quarter4');
    expect(visible()).toHaveLength(1);
    visible()[0].value = 'Fourth draft';
    syncLearnerCardTerm(host, 'final');
    expect(host.querySelector<HTMLElement>('[data-teacher-comments]')!.hidden).toBe(true);
    syncLearnerCardTerm(host, 'quarter1');
    expect(visible()[0].value).toBe('First draft');
    expect(collectLearnerCardFields(host).teacherComments).toEqual(['First draft', 'Second draft', 'Third', 'Fourth draft']);
    expect(learnerCardRecord({ teacherComments: ['First', 'Second', 'Third', 'Fourth'] }, true).teacherComments[3]).toBe('Fourth');
  });
  it('gives older learners independent empty defaults and preserves zero counts', () => {
    const first = learnerCardRecord();
    first.teacherComments[0] = 'Changed';
    first.attendance.daysPresent.Aug = '20';
    expect(learnerCardRecord()).toEqual({
      teacherComments: ['', '', ''], attendance: { classDays: {}, daysPresent: {}, daysAbsent: {} },
    });
    expect(learnerCardRecord({ attendance: { daysAbsent: { Aug: 0 } } }).attendance.daysAbsent.Aug).toBe('0');
  });

  it.each([-1, 'Infinity', 'NaN', '1e3', '9007199254740992', true])('rejects invalid attendance %s', (value) => {
    expect(() => learnerCardRecord({ attendance: { daysPresent: { Aug: value } } }, true)).toThrow('non-negative number');
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
      attendance: { classDays: { Aug: '20', Sep: '20' }, daysPresent: { Jun: '18', Aug: '20' }, daysAbsent: { Aug: '0' } },
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
    expect(saved.attendance.daysAbsent.Sep).toBe('1');
    expect(learner.attendance.daysPresent).toEqual({ Jun: '18', Aug: '20' });
  });

  it('clears fields when switching learners, rejects negative input, and accepts fractional days', () => {
    const host = form();
    renderLearnerCardFields(host, { teacherComments: ['Old', '', ''] }, preferences);
    renderLearnerCardFields(host, {}, preferences);
    expect(host.querySelector<HTMLTextAreaElement>('[data-teacher-comment]')!.value).toBe('');
    const input = host.querySelector<HTMLInputElement>('[data-attendance-row="daysPresent"]')!;
    host.querySelector<HTMLInputElement>('[data-attendance-row="classDays"]')!.value = '10';
    input.value = '-1';
    expect(host.checkValidity()).toBe(false);
    expect(() => collectLearnerCardFields(host)).toThrow('non-negative number');
    input.value = '2.5';
    expect(collectLearnerCardFields(host).attendance.daysAbsent.Aug).toBe('7.5');
    input.value = '0';
    expect(host.checkValidity()).toBe(true);
  });

  it('calculates readonly absences exactly, updates totals, handles cleared values and rejects present above class days', () => {
    const host = form();
    renderLearnerCardFields(host, {}, preferences);
    const days = host.querySelector<HTMLInputElement>('[data-attendance-row="classDays"][data-attendance-month="Aug"]')!;
    const present = host.querySelector<HTMLInputElement>('[data-attendance-row="daysPresent"][data-attendance-month="Aug"]')!;
    const absent = host.querySelector<HTMLInputElement>('[data-attendance-row="daysAbsent"][data-attendance-month="Aug"]')!;
    expect(absent.readOnly).toBe(true);
    days.value = '0.3';
    present.value = '0.1';
    present.dispatchEvent(new Event('input', { bubbles: true }));
    expect(absent.value).toBe('0.2');
    expect(absent.closest('tr')!.lastElementChild!.textContent).toBe('0.2');
    absent.value = '99';
    expect(collectLearnerCardFields(host).attendance.daysAbsent.Aug).toBe('0.2');
    present.value = '0.4';
    present.dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.checkValidity()).toBe(false);
    expect(absent.value).toBe('');
    expect(() => collectLearnerCardFields(host)).toThrow('cannot exceed');
    present.value = '';
    present.dispatchEvent(new Event('input', { bubbles: true }));
    expect(absent.value).toBe('');
    expect(host.checkValidity()).toBe(true);
    expect(collectLearnerCardFields(host).attendance.daysAbsent.Aug).toBe('');
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
