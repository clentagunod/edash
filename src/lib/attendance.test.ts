import { describe, expect, it } from 'vitest';
import { attendanceClassDays, attendanceTotal, isAttendanceCount } from './attendance';

describe('decimal attendance arithmetic', () => {
  it.each([['0.1', '0.2', '0.3'], ['20.25', '2.25', '22.5'], ['20', '0', '20'], ['.25', '0.75', '1'], ['0', '0', '0']])('adds %s present and %s absent exactly', (present, absent, days) => {
    expect(attendanceClassDays(present, absent)).toBe(days);
  });
  it('keeps partial attendance blank and sums decimals without floating point artifacts', () => {
    expect(attendanceClassDays('20', '')).toBe('');
    expect(attendanceClassDays('', '10')).toBe('');
    expect(attendanceClassDays('-1', '10')).toBe('');
    expect(attendanceClassDays('10', 'Infinity')).toBe('');
    expect(attendanceTotal(['0.1', '0.2', '', 'invalid'])).toBe('0.3');
    expect(attendanceTotal(['10.50', '9.5', '0'])).toBe('20');
    expect(attendanceTotal(['', 'invalid'])).toBe('');
    expect(isAttendanceCount('-1')).toBe(false);
    expect(isAttendanceCount('0.5')).toBe(true);
  });
});
