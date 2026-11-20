import { isAttendanceCount } from '../attendance';

export const ATTENDANCE_MONTHS = [
  ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'], ['Apr', 'April'],
  ['May', 'May'], ['Jun', 'June'], ['Jul', 'July'], ['Aug', 'August'],
  ['Sep', 'September'], ['Oct', 'October'], ['Nov', 'November'], ['Dec', 'December'],
] as const;
export const ATTENDANCE_COUNT_ROWS = ['classDays', 'daysPresent', 'daysAbsent'] as const;
type Counts = { classDays: string; daysPresent: string; daysAbsent: string };
export const attendanceObject = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export function canonicalAttendanceMonth(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (key === 'sept') return 'Sep';
  return ATTENDANCE_MONTHS.find(([abbreviation, name]) => key === abbreviation.toLowerCase() || key === name.toLowerCase())?.[0] || '';
}

/** All aliases are reviewed so a hidden conflicting legacy value cannot be overwritten silently. */
export function attendanceMonthValues(attendance: unknown, month: string): Record<keyof Counts, string[]> {
  const source = attendanceObject(attendance);
  return Object.fromEntries(ATTENDANCE_COUNT_ROWS.map(row => [row,
    Object.entries(attendanceObject(source[row])).filter(([key]) => canonicalAttendanceMonth(key) === month).map(([, value]) => String(value ?? '').trim()),
  ])) as Record<keyof Counts, string[]>;
}

export function equivalentAttendanceCount(previous: string, next: string): boolean {
  return isAttendanceCount(previous) && isAttendanceCount(next) && Number(previous) === Number(next);
}

export function attendanceMonthNeedsReplacement(attendance: unknown, month: string, counts: Counts): boolean {
  const previous = attendanceMonthValues(attendance, month);
  return ATTENDANCE_COUNT_ROWS.some(row => previous[row].some(value => value !== '' && !equivalentAttendanceCount(value, counts[row])));
}
