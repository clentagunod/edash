/** Workbook-compatible definitions. Counts are stored; rates are always derived. */
export const PERFORMANCE_WINDOW_OPTIONS = [3, 5, 6, 9] as const;
export type PerformanceWindow = typeof PERFORMANCE_WINDOW_OPTIONS[number];
export const PERFORMANCE_INDICATORS = [
  { id: 'graduation', label: 'Graduation Rate', lowerIsBetter: false },
  { id: 'completion', label: 'Completion Rate', lowerIsBetter: false },
  { id: 'promotion', label: 'Promotion Rate', lowerIsBetter: false },
  { id: 'survival', label: 'Survival Rate', lowerIsBetter: false },
  { id: 'retention', label: 'Retention Rate', lowerIsBetter: false },
  { id: 'participation', label: 'Participation Rate', lowerIsBetter: false },
  { id: 'dropout', label: 'Drop Out Rate', lowerIsBetter: true },
  { id: 'repetition', label: 'Repetition Rate', lowerIsBetter: true },
  { id: 'enrollment', label: 'Enrollment Rate', lowerIsBetter: false },
  { id: 'failure', label: 'Failure Rate', lowerIsBetter: true },
  { id: 'transition', label: 'Transition Rate', lowerIsBetter: false },
  { id: 'kinderIntake', label: 'Kinder Intake Rate', lowerIsBetter: false },
] as const;
export type PerformanceIndicatorId = typeof PERFORMANCE_INDICATORS[number]['id'];
export interface PerformanceEntry {
  numerator: number | null;
  denominator: number | null;
  /** Optional original computational-guide labels from an imported workbook. */
  numeratorLabel?: string;
  denominatorLabel?: string;
}
export interface PerformanceYear { indicators: Partial<Record<PerformanceIndicatorId, PerformanceEntry>> }
export interface PerformanceConfig {
  version: 1;
  revision: number;
  windowYears: PerformanceWindow;
  configurations: Record<string, PerformanceYear>;
}
export const MAX_PERFORMANCE_YEARS = 100;
export const MAX_PERFORMANCE_COUNT = 1_000_000_000;
export function emptyPerformanceConfig(): PerformanceConfig {
  return { version: 1, revision: 0, windowYears: 5, configurations: {} };
}
export function normalizePerformanceYear(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})\s*[-–/]\s*(\d{4})$/);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 2199 || Number(match[2]) !== Number(match[1]) + 1) return null;
  return `${match[1]}-${match[2]}`;
}
export function performanceYear(start: number) { return `${start}-${start + 1}`; }
export function performanceLabels(id: PerformanceIndicatorId, year: string): [string, string] {
  const start = Number(year.slice(0, 4));
  const previous = performanceYear(start - 1), cohort = performanceYear(start - 6);
  const enrollment = `Enrollment School Year ${year}`;
  switch (id) {
    case 'graduation': return [`Graduates School Year ${year} (Grade 6)`, `${enrollment} (Grade 6)`];
    case 'completion': return [`Graduates School Year ${year} (Grade 6)`, `Enrollment School Year ${cohort} (Kindergarten)`];
    case 'promotion': return [`Promoted School Year ${year} (Kindergarten–Grade 6)`, `${enrollment} (Kindergarten–Grade 6)`];
    case 'survival': return [`${enrollment} (Grade 6)`, `Enrollment School Year ${cohort} (Kindergarten)`];
    case 'retention': return [`${enrollment} (Grade 1–Grade 6)`, `Enrollment School Year ${previous} (Kindergarten–Grade 5)`];
    case 'participation': return [`${enrollment} (Kindergarten–Grade 6)`, `${start} Barangay Population of 5–11 years old`];
    case 'dropout': return [`Drop Outs School Year ${year}`, enrollment];
    case 'repetition': return [`Repeaters School Year ${year}`, enrollment];
    case 'enrollment': return [`Total Enrolment (All ages) based on October 31, ${start} Annual Enrolment`, 'Barangay or Sitio Population Ages youngest up to eldest age of the School Age Profile'];
    case 'failure': return [`Total Number of Failures (All Grades SY ${year})`, `Total Number of Enrollment (All Grades SY ${year})`];
    case 'transition': return [`Enrolment Grade 5 (October 31, ${start}) current SY ${year}`, `Enrolment Grade 4 (July 31, ${start - 1}) previous SY ${previous}`];
    case 'kinderIntake': return [`Enrolment Kindergarten (October 31, ${start}) current SY ${year}`, `${start} Barangay Population of 5 years old`];
  }
}
export function performanceRate(entry?: PerformanceEntry): number | null {
  if (!entry || entry.numerator === null || entry.denominator === null || entry.denominator <= 0) return null;
  if (![entry.numerator, entry.denominator].every(value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_PERFORMANCE_COUNT)) return null;
  return entry.numerator / entry.denominator * 100;
}
export function performanceVariance(config: PerformanceConfig, year: string, id: PerformanceIndicatorId): number | null {
  const rate = performanceRate(config.configurations[year]?.indicators[id]);
  const previous = performanceRate(config.configurations[performanceYear(Number(year.slice(0, 4)) - 1)]?.indicators[id]);
  return rate === null || previous === null ? null : rate - previous;
}
export function formatPerformanceRate(rate: number | null) {
  return rate === null ? 'No data' : `${rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
export function formatPerformanceVariance(variance: number | null) {
  if (variance === null) return 'No previous S.Y. data';
  const rounded = Math.round(variance * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)} pp`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Reject malformed records instead of silently dropping data on the next save. */
export function validatePerformanceConfig(input: unknown): PerformanceConfig {
  if (!isRecord(input) || input.version !== 1 || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 ||
    !PERFORMANCE_WINDOW_OPTIONS.includes(input.windowYears as PerformanceWindow) || !isRecord(input.configurations)) {
    throw new Error('The performance indicator configuration is invalid. Reload or restore a valid backup.');
  }
  const years = Object.entries(input.configurations);
  if (years.length > MAX_PERFORMANCE_YEARS) throw new Error(`At most ${MAX_PERFORMANCE_YEARS} performance school years are supported.`);
  const configurations: PerformanceConfig['configurations'] = {};
  for (const [year, data] of years) {
    if (normalizePerformanceYear(year) !== year || !isRecord(data) || !isRecord(data.indicators)) throw new Error(`Invalid performance school year: ${year}.`);
    const indicators: PerformanceYear['indicators'] = {};
    for (const [id, entry] of Object.entries(data.indicators)) {
      if (!PERFORMANCE_INDICATORS.some(definition => definition.id === id) || !isRecord(entry)) throw new Error(`Invalid indicator in ${year}.`);
      for (const field of ['numerator', 'denominator'] as const) {
        if (entry[field] !== null && (typeof entry[field] !== 'number' || !Number.isSafeInteger(entry[field]) || Number(entry[field]) < 0 || Number(entry[field]) > MAX_PERFORMANCE_COUNT)) {
          throw new Error(`Enter a whole-number count between 0 and ${MAX_PERFORMANCE_COUNT.toLocaleString()} for ${year} ${id}.`);
        }
      }
      const cleaned: PerformanceEntry = { numerator: entry.numerator as number | null, denominator: entry.denominator as number | null };
      for (const field of ['numeratorLabel', 'denominatorLabel'] as const) {
        if (entry[field] !== undefined) {
          if (typeof entry[field] !== 'string' || !entry[field].trim() || entry[field].length > 300) throw new Error('Computational-guide labels must contain 1–300 characters.');
          cleaned[field] = entry[field].trim();
        }
      }
      indicators[id as PerformanceIndicatorId] = cleaned;
    }
    configurations[year] = { indicators };
  }
  return { version: 1, revision: input.revision as number, windowYears: input.windowYears as PerformanceWindow, configurations };
}
export function performanceWindowBounds(config: PerformanceConfig) {
  const years = Object.keys(config.configurations).sort();
  if (!years.length) return null;
  const first = Number(years[0].slice(0, 4)), last = Number(years[years.length - 1].slice(0, 4));
  return { min: Math.min(first + config.windowYears - 1, last), max: last, first };
}
/** Calendar-year windows include gaps, so missing years never imply continuity. */
export function visiblePerformanceYears(config: PerformanceConfig, end?: number): string[] {
  const bounds = performanceWindowBounds(config);
  if (!bounds) return [];
  const last = Math.max(bounds.min, Math.min(bounds.max, end ?? bounds.max));
  const first = Math.max(bounds.first, last - config.windowYears + 1);
  return Array.from({ length: last - first + 1 }, (_, index) => performanceYear(first + index));
}
export function indicatorIdFromLabel(value: unknown): PerformanceIndicatorId | null {
  const label = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '').replace('repitition', 'repetition').replace('enrolment', 'enrollment');
  return PERFORMANCE_INDICATORS.find(item => item.id.toLowerCase() === label || item.label.toLowerCase().replace(/[^a-z]/g, '') === label)?.id ?? null;
}
