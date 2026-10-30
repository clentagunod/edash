/** Day counts allow decimals; integer arithmetic avoids 0.3 - 0.1 artifacts. */
export function isAttendanceCount(value: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)
    && Number.isFinite(Number(value)) && Number(value) <= Number.MAX_SAFE_INTEGER;
}

function parts(value: string): { digits: bigint; scale: number } {
  const [whole, fraction = ''] = value.split('.');
  return { digits: BigInt((whole || '0') + fraction), scale: fraction.length };
}

function decimalString(digits: bigint, scale: number): string {
  const negative = digits < 0n;
  const text = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
  const result = scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.?0+$/, '') : text;
  return `${negative ? '-' : ''}${result}`;
}

export function attendanceAbsent(classDays: string, present: string): string {
  if (!isAttendanceCount(classDays) || !isAttendanceCount(present)) return '';
  const left = parts(classDays), right = parts(present);
  const scale = Math.max(left.scale, right.scale);
  return decimalString(left.digits * 10n ** BigInt(scale - left.scale) - right.digits * 10n ** BigInt(scale - right.scale), scale);
}

export function attendanceTotal(values: readonly string[]): string {
  const valid = values.filter(isAttendanceCount).map(parts);
  if (!valid.length) return '';
  const scale = Math.max(...valid.map((value) => value.scale));
  return decimalString(valid.reduce((sum, value) => sum + value.digits * 10n ** BigInt(scale - value.scale), 0n), scale);
}
