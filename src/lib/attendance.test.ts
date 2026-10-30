import { describe, expect, it } from 'vitest';
import { attendanceAbsent, attendanceTotal, isAttendanceCount } from './attendance';

describe('decimal attendance arithmetic', () => {
  it.each([['0.3', '0.1', '0.2'], ['22.5', '20.25', '2.25'], ['20', '20', '0'], ['1.00', '.25', '0.75'], ['20', '21', '-1']])('subtracts %s minus %s exactly', (days, present, absent) => {
    expect(attendanceAbsent(days, present)).toBe(absent);
  });
  it('keeps partial attendance blank and sums decimals without floating point artifacts', () => {
    expect(attendanceAbsent('20', '')).toBe('');
    expect(attendanceAbsent('', '10')).toBe('');
    expect(attendanceTotal(['0.1', '0.2', '', 'invalid'])).toBe('0.3');
    expect(attendanceTotal(['10.50', '9.5', '0'])).toBe('20');
    expect(attendanceTotal(['', 'invalid'])).toBe('');
    expect(isAttendanceCount('-1')).toBe(false);
    expect(isAttendanceCount('0.5')).toBe(true);
  });
});
