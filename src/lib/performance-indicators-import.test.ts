import { describe, expect, it } from 'vitest';
import { read, utils } from 'xlsx';
import { emptyPerformanceConfig, performanceRate } from './performance-indicators';
import { mergePerformanceImport, parsePerformanceSheets, performanceCsv } from './performance-indicators-import';

const table = ['School Year', 'Indicator', 'Numerator', 'Denominator', 'Numerator Label', 'Denominator Label'];
const workbookRows = [
  ['PERFORMANCE INDICATORS'], ['SY: 2025-2026'],
  ['No.', 'PERFORMANCE INDICATOR', 'COMPUTATIONAL GUIDE', null, 'COMPUTATION', null, null, 'RATE', 'Variance from Previous S.Y.'],
  [1, 'Graduation Rate', 'Graduates School Year 2025-2026 (Grade 6)', 'X 100', 'GR=', 45, 'X 100', 1, '-90%'],
  [null, null, 'Enrollment School Year 2025-2026 (Grade 6)', null, null, 45],
  [2, 'Completion Rate', 'Graduates School Year 2025-2026 (Grade 6)', 'X 100', 'CR=', 45, 'X 100', 1],
  [null, null, 'Enrollment School Year 2019-2020 (Kindergarten)', null, null, 48],
];
describe('performance imports', () => {
  it('extracts source counts and labels, ignoring cached rates and handwritten variance', () => {
    const result = parsePerformanceSheets([{ name: 'School data', rows: workbookRows }]);
    expect(result.rows).toHaveLength(2);
    expect(performanceRate(result.rows[0].entry)).toBe(100);
    expect(performanceRate(result.rows[1].entry)).toBe(93.75);
    expect(result.rows[1].entry.denominatorLabel).toContain('2019-2020');
  });
  it('reports duplicate sheets and excludes unrelated sheets without overwriting data', () => {
    const result = parsePerformanceSheets([{ name: '2025-2026', rows: workbookRows }, { name: '2025-2026 (2)', rows: workbookRows }, { name: 'Other report', rows: [['Pupil', 'Award']] }]);
    expect(result.rows).toHaveLength(2);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('identical data skipped');
    expect(result.ignoredSheets).toBe(1);
  });
  it('imports CSV tables with grouping separators and alternate spelling', () => {
    const result = parsePerformanceSheets([{ name: 'CSV', rows: [table, ['2025-2026', 'Repitition Rate', 0, '1,200'], ['2024-2025', 'Enrolment Rate', 442, 538]] }]);
    expect(result.rows.map(row => row.id)).toEqual(['repetition', 'enrollment']);
    expect(result.rows[0].entry).toEqual({ numerator: 0, denominator: 1200 });
  });
  it('skips invalid, missing, unknown, and future entries with notices', () => {
    const result = parsePerformanceSheets([{ name: 'CSV', rows: [table,
      ['2025-2027', 'Graduation Rate', 45, 45], ['2025-2026', 'Graduation Rate', -1, 45],
      ['2025-2026', 'Completion Rate', '', 45], ['2025-2026', 'Unknown', 45, 45],
      ['2026-2027', 'Graduation Rate', 45, 45], ['2025-2026', 'Drop Out Rate', 0, 0],
      ['2025-2026', 'Failure Rate', '1.2', 45], ['2025-2026', 'Promotion Rate', '=1+1', 45],
    ] }], '2025-2026');
    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(8);
    expect(result.rows[0].entry.denominator).toBe(0);
  });
  it('only replaces existing indicator data when explicitly selected', () => {
    const config = emptyPerformanceConfig();
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 30, denominator: 45 }, failure: { numerator: 1, denominator: 45 } } };
    const imported = parsePerformanceSheets([{ name: 'Sheet', rows: workbookRows }]);
    const kept = mergePerformanceImport(config, imported.rows, false);
    expect(kept.configurations['2025-2026'].indicators.graduation!.numerator).toBe(30);
    expect(kept.configurations['2025-2026'].indicators.completion!.numerator).toBe(45);
    const replaced = mergePerformanceImport(config, imported.rows, true);
    expect(replaced.configurations['2025-2026'].indicators.graduation!.numerator).toBe(45);
    expect(replaced.configurations['2025-2026'].indicators.failure!.numerator).toBe(1);
    expect(config.configurations['2025-2026'].indicators.graduation!.numerator).toBe(30);
  });
  it('exports a reusable template and round-trips counts and labels', () => {
    const template = read(performanceCsv(undefined, '2025-2026'), { type: 'string' });
    const rows = utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 });
    expect(rows).toHaveLength(13);
    const config = emptyPerformanceConfig();
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 45, denominator: 45, numeratorLabel: 'Graduates, Grade 6' } } };
    const workbook = read(performanceCsv(config), { type: 'string' });
    const parsed = parsePerformanceSheets([{ name: 'CSV', rows: utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }) }]);
    expect(parsed.rows[0].entry.numeratorLabel).toBe('Graduates, Grade 6');
    expect(parsed.rows[0].entry.numerator).toBe(45);
  });
  it('protects exported labels against spreadsheet formula injection', () => {
    const config = emptyPerformanceConfig();
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 1, denominator: 1, numeratorLabel: '=HYPERLINK("https://example.com")' } } };
    expect(performanceCsv(config)).toContain('"\'=HYPERLINK');
  });
});
