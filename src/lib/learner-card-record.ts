import { gradeTermsForCount, MAX_GRADE_TERM_COUNT } from './academic-grades';
import { attendanceAbsent, attendanceTotal, isAttendanceCount } from './attendance';

export const TEACHER_COMMENT_TERMS = ['1st Term', '2nd Term', '3rd Term'] as const;
export const ATTENDANCE_ROW_IDS = ['classDays', 'daysPresent', 'daysAbsent'] as const;
export type AttendanceRecord = Record<typeof ATTENDANCE_ROW_IDS[number], Record<string, string>>;
export type LearnerCardRecord = { teacherComments: string[]; attendance: AttendanceRecord };
export type AttendancePreferences = {
  attendanceMonths: readonly string[];
  attendanceRows: ReadonlyArray<{ id: string; label: string }>;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Missing fields on older learners are empty; never share mutable defaults. */
export function learnerCardRecord(learner: Record<string, unknown> = {}, validate = false): LearnerCardRecord {
  if (validate && learner.teacherComments != null && learner.teacherComments !== ''
    && (!Array.isArray(learner.teacherComments) || ![3, MAX_GRADE_TERM_COUNT].includes(learner.teacherComments.length)
      || learner.teacherComments.some((value) => typeof value !== 'string'))) {
    throw new Error('Teacher Comments must contain three text values, or four for a four-term school year.');
  }
  if (validate && learner.attendance != null && learner.attendance !== ''
    && (typeof learner.attendance !== 'object' || Array.isArray(learner.attendance))) {
    throw new Error('Attendance must contain monthly records for class days, present, and absent.');
  }
  const comments = Array.isArray(learner.teacherComments) ? learner.teacherComments : [];
  const source = record(learner.attendance);
  const attendance = Object.fromEntries(ATTENDANCE_ROW_IDS.map((row) => {
    if (validate && source[row] != null && (typeof source[row] !== 'object' || Array.isArray(source[row]))) {
      throw new Error(`Attendance row ${row} must contain monthly counts.`);
    }
    return [row, Object.fromEntries(Object.entries(record(source[row])).map(([month, value]) => {
      const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
      if (validate && ((value != null && typeof value !== 'string' && typeof value !== 'number')
        || (text !== '' && !isAttendanceCount(text)))) {
        throw new Error(`Attendance for ${month} must be a non-negative number. Decimals are allowed.`);
      }
      return [month, text];
    }))];
  })) as AttendanceRecord;
  return {
    teacherComments: Array.from({ length: Math.max(TEACHER_COMMENT_TERMS.length, Math.min(MAX_GRADE_TERM_COUNT, comments.length)) }, (_, index) => typeof comments[index] === 'string' ? comments[index] : ''),
    attendance,
  };
}

const originals = new WeakMap<HTMLElement, LearnerCardRecord>();
const requests = new WeakMap<HTMLElement, object>();

/** Comment indexes match the configured quarter1…quarter4 grade IDs. */
export function teacherCommentIndex(term: string): number | null {
  const index = /^quarter([1-4])$/.exec(term)?.[1];
  return index ? Number(index) - 1 : null;
}

/** Keep inactive inputs mounted so switching terms never discards draft comments. */
export function syncLearnerCardTerm(host: HTMLElement, term?: string): void {
  const selectedTerm = term ?? host.querySelector<HTMLSelectElement>('#f_gradeTerm')?.value;
  if (!selectedTerm) return; // Archive and migration editors show all saved terms.
  const index = teacherCommentIndex(selectedTerm);
  const comments = host.querySelector<HTMLElement>('[data-teacher-comments]');
  if (comments && index !== null && !comments.querySelector(`[data-teacher-comment="${index}"]`)) {
    appendTeacherComment(comments, index, originals.get(host)?.teacherComments[index] || '');
  }
  if (comments) comments.hidden = index === null;
  host.querySelectorAll<HTMLTextAreaElement>('[data-teacher-comment]').forEach((input) => {
    const field = input.closest<HTMLElement>('label');
    if (field) field.hidden = Number(input.dataset.teacherComment) !== index;
  });
}

function appendTeacherComment(host: HTMLElement, index: number, value: string): void {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(document.createTextNode(gradeTermsForCount(MAX_GRADE_TERM_COUNT)[index].label));
  const input = document.createElement('textarea');
  input.rows = 3;
  input.name = `teacherComments_${index}`;
  input.dataset.teacherComment = String(index);
  input.value = value;
  label.append(input);
  host.append(label);
}

export async function loadLearnerCardFields(
  host: HTMLElement,
  learner: Record<string, unknown>,
  getPreferences: () => Promise<AttendancePreferences>,
): Promise<void> {
  const request = {};
  requests.set(host, request);
  originals.delete(host);
  let container = host.querySelector<HTMLElement>('[data-learner-card-record]');
  if (!container) {
    container = document.createElement('div');
    container.className = 'field span-2 learner-card-record-fields';
    container.dataset.learnerCardRecord = '';
    (host.querySelector('.field-grid') || host).append(container);
  }
  container.setAttribute('role', 'status');
  container.textContent = 'Loading Teacher Comments and attendance settings…';
  try {
    const preferences = await getPreferences();
    if (requests.get(host) !== request) return;
    renderLearnerCardFields(host, learner, preferences);
  } catch {
    if (requests.get(host) !== request) return;
    originals.delete(host);
    container.textContent = 'Teacher Comments and attendance settings could not be loaded. Close and reopen this form to retry before saving.';
  }
}

/** The same controls are used in active, archived, and succeeding-year forms. */
export function renderLearnerCardFields(host: HTMLElement, learner: Record<string, unknown>, preferences: AttendancePreferences): void {
  let container = host.querySelector<HTMLElement>('[data-learner-card-record]');
  if (!container) {
    container = document.createElement('div');
    container.className = 'field span-2 learner-card-record-fields';
    container.dataset.learnerCardRecord = '';
    (host.querySelector('.field-grid') || host).append(container);
  }
  const saved = learnerCardRecord(learner);
  container.removeAttribute('role');
  container.replaceChildren();
  const comments = document.createElement('fieldset');
  comments.dataset.teacherComments = '';
  const legend = document.createElement('legend');
  legend.textContent = 'Teacher Comments';
  comments.append(legend);
  saved.teacherComments.forEach((value, index) => appendTeacherComment(comments, index, value));
  const attendance = document.createElement('fieldset');
  const attendanceLegend = document.createElement('legend');
  attendanceLegend.textContent = 'Attendance record';
  const scroll = document.createElement('div');
  scroll.className = 'learner-attendance-scroll';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Monthly attendance');
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Attendance', ...preferences.attendanceMonths, 'Total'].forEach((text) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = text;
    head.append(cell);
  });
  const body = table.createTBody();
  const attendanceInputs = new Map<string, Map<string, HTMLInputElement>>();
  const rowTotals = new Map<string, HTMLTableCellElement>();
  preferences.attendanceRows.forEach(({ id, label }) => {
    if (!ATTENDANCE_ROW_IDS.includes(id as typeof ATTENDANCE_ROW_IDS[number])) return;
    const row = body.insertRow();
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    const inputs = new Map<string, HTMLInputElement>();
    attendanceInputs.set(id, inputs);
    preferences.attendanceMonths.forEach((month, index) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.max = String(Number.MAX_SAFE_INTEGER);
      input.inputMode = 'decimal';
      input.readOnly = id === 'daysAbsent';
      if (input.readOnly) input.setAttribute('aria-description', 'Calculated automatically as class days minus present.');
      input.name = `attendance_${id}_${index}`;
      input.dataset.attendanceRow = id;
      input.dataset.attendanceMonth = month;
      input.setAttribute('aria-label', `${label} ${month}`);
      input.value = saved.attendance[id as keyof AttendanceRecord][month] ?? '';
      row.insertCell().append(input);
      inputs.set(month, input);
    });
    const total = row.insertCell();
    rowTotals.set(id, total);
  });
  const updateAttendance = () => {
    preferences.attendanceMonths.forEach((month) => {
      const days = attendanceInputs.get('classDays')?.get(month);
      const present = attendanceInputs.get('daysPresent')?.get(month);
      const absent = attendanceInputs.get('daysAbsent')?.get(month);
      const calculated = attendanceAbsent(days?.value || '', present?.value || '');
      const invalid = calculated.startsWith('-');
      if (present) present.setCustomValidity(invalid ? 'Present days cannot exceed class days.' : '');
      if (absent) absent.value = invalid ? '' : calculated;
    });
    attendanceInputs.forEach((inputs, id) => {
      rowTotals.get(id)!.textContent = attendanceTotal([...inputs.values()].map((input) => input.value));
    });
  };
  attendanceInputs.forEach((inputs) => inputs.forEach((input) => input.addEventListener('input', updateAttendance)));
  updateAttendance();
  scroll.append(table);
  attendance.append(attendanceLegend, scroll);
  container.append(comments, attendance);
  originals.set(host, saved);
  syncLearnerCardTerm(host);
}

export function collectLearnerCardFields(host: HTMLElement): LearnerCardRecord {
  const saved = originals.get(host);
  if (!saved) throw new Error('Learner card fields could not be loaded. Reopen the learner form and try again.');
  const result = learnerCardRecord(saved);
  host.querySelectorAll<HTMLTextAreaElement>('[data-teacher-comment]').forEach((input) => {
    result.teacherComments[Number(input.dataset.teacherComment)] = input.value.trim();
  });
  host.querySelectorAll<HTMLInputElement>('[data-attendance-row]').forEach((input) => {
    const row = input.dataset.attendanceRow as keyof AttendanceRecord;
    const month = input.dataset.attendanceMonth!;
    if (input.validity.badInput) throw new Error(`Enter a valid attendance number for ${month}.`);
    // Keep months that are no longer in Card Preferences, so layout edits never erase history.
    result.attendance[row] = { ...result.attendance[row], [month]: input.value };
  });
  // Recompute during collection too; a stale or modified readonly value is never saved.
  host.querySelectorAll<HTMLInputElement>('[data-attendance-row="daysAbsent"]').forEach((input) => {
    const month = input.dataset.attendanceMonth!;
    const value = attendanceAbsent(result.attendance.classDays[month] || '', result.attendance.daysPresent[month] || '');
    if (value.startsWith('-')) throw new Error(`Present days cannot exceed class days for ${month}.`);
    result.attendance.daysAbsent = { ...result.attendance.daysAbsent, [month]: value };
  });
  return learnerCardRecord(result, true);
}
