import {
  indicatorIdFromLabel, MAX_PERFORMANCE_COUNT, normalizePerformanceYear, PERFORMANCE_INDICATORS,
  performanceLabels, type PerformanceConfig, type PerformanceEntry, type PerformanceIndicatorId,
} from './performance-indicators';

export interface PerformanceImportRow { year: string; id: PerformanceIndicatorId; entry: PerformanceEntry; source: string }
export interface PerformanceImportResult { rows: PerformanceImportRow[]; warnings: string[]; ignoredSheets: number }
export interface PerformanceImportSheet { name: string; rows: unknown[][] }
const headerKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
function count(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'number' && !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw new Error('counts must be nonnegative whole numbers');
  const numeric = typeof value === 'number' ? value : Number(text.replace(/,/g, ''));
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_PERFORMANCE_COUNT) throw new Error('a count is outside the supported range');
  return numeric;
}
function label(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (text.length > 300) throw new Error('a computational-guide label exceeds 300 characters');
  return text || undefined;
}
/** Accept the supplied two-row computational guide or a named-column table. Never evaluate formulas. */
export function parsePerformanceSheets(sheets: PerformanceImportSheet[], currentYear?: string): PerformanceImportResult {
  const result: PerformanceImportResult = { rows: [], warnings: [], ignoredSheets: 0 };
  const seen = new Map<string, PerformanceImportRow>();
  const add = (yearValue: unknown, idValue: unknown, numerator: unknown, denominator: unknown, numeratorLabel: unknown, denominatorLabel: unknown, source: string) => {
    try {
      const year = normalizePerformanceYear(yearValue);
      if (!year) throw new Error('a valid school year (YYYY-YYYY) is required');
      if (currentYear && year > currentYear) throw new Error(`school year ${year} is after the current school year ${currentYear}`);
      const id = indicatorIdFromLabel(idValue);
      if (!id) throw new Error(`unrecognized indicator “${String(idValue)}”`);
      const entry: PerformanceEntry = { numerator: count(numerator), denominator: count(denominator) };
      if (entry.numerator === null || entry.denominator === null) throw new Error('both source counts are required; the indicator was skipped');
      const topLabel = label(numeratorLabel), bottomLabel = label(denominatorLabel);
      if (topLabel) entry.numeratorLabel = topLabel;
      if (bottomLabel) entry.denominatorLabel = bottomLabel;
      const key = `${year}/${id}`;
      const duplicate = seen.get(key);
      if (duplicate) {
        result.warnings.push(`${source}: duplicate ${year} ${id}; ${JSON.stringify(duplicate.entry) === JSON.stringify(entry) ? 'identical data' : 'conflicting data'} skipped. Kept ${duplicate.source}.`);
        return;
      }
      if (entry.denominator === 0) result.warnings.push(`${source}: zero denominator; the rate will show “No data”.`);
      const row = { year, id, entry, source };
      seen.set(key, row);
      result.rows.push(row);
    } catch (error) { result.warnings.push(`${source}: ${(error as Error).message}.`); }
  };
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.findIndex(row => {
      const keys = row.map(headerKey);
      return keys.some(key => ['indicator', 'performanceindicator'].includes(key)) &&
        (keys.includes('computationalguide') || (keys.includes('numerator') && keys.includes('denominator')));
    });
    if (headerIndex < 0) { result.ignoredSheets++; continue; }
    const headers = sheet.rows[headerIndex].map(headerKey);
    const indicatorCol = headers.findIndex(key => ['indicator', 'performanceindicator'].includes(key));
    const guideCol = headers.indexOf('computationalguide');
    if (guideCol >= 0) {
      const titleYear = sheet.rows.slice(0, headerIndex).flat().map(String)
        .map(value => value.match(/\b(?:SY|S\.Y\.|School\s*Year)\s*:?\s*(\d{4}\s*[-–/]\s*\d{4})/i)?.[1]).find(Boolean);
      const year = titleYear || normalizePerformanceYear(sheet.name);
      const computationCol = headers.indexOf('computation'), rateCol = headers.indexOf('rate');
      if (computationCol < 0 || rateCol <= computationCol) {
        result.warnings.push(`${sheet.name}: computation and rate columns are required for a workbook-style sheet.`);
        continue;
      }
      for (let index = headerIndex + 1; index < sheet.rows.length; index++) {
        const row = sheet.rows[index];
        if (!indicatorIdFromLabel(row[indicatorCol])) continue;
        const next = sheet.rows[index + 1] || [];
        // Numeric source counts lie between COMPUTATION and RATE, after the formula abbreviation.
        const valueCol = row.findIndex((value, col) => col > computationCol && col < rateCol &&
          (typeof value === 'number' || (typeof value === 'string' && /^\s*[\d,]+\s*$/.test(value))));
        const safeCol = valueCol >= 0 ? valueCol : computationCol + 1;
        add(year, row[indicatorCol], row[safeCol], next[safeCol], row[guideCol], next[guideCol], `${sheet.name}, row ${index + 1}`);
      }
    } else {
      const yearCol = headers.findIndex(key => ['schoolyear', 'year', 'sy'].includes(key));
      if (yearCol < 0) { result.warnings.push(`${sheet.name}: the table needs a School Year column.`); continue; }
      for (let index = headerIndex + 1; index < sheet.rows.length; index++) {
        const row = sheet.rows[index];
        if (!row.some(value => value !== null && value !== undefined && String(value).trim())) continue;
        add(row[yearCol], row[indicatorCol], row[headers.indexOf('numerator')], row[headers.indexOf('denominator')],
          row[headers.indexOf('numeratorlabel')], row[headers.indexOf('denominatorlabel')], `${sheet.name}, row ${index + 1}`);
      }
    }
  }
  return result;
}
export async function readPerformanceFile(file: File, currentYear: string): Promise<PerformanceImportResult> {
  if (!/\.(xlsx|xls|csv|tsv|ods)$/i.test(file.name)) throw new Error('Choose an XLSX, XLS, CSV, TSV, or ODS file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.');
  const { read, utils } = await import('xlsx');
  const workbook = read(await file.arrayBuffer(), { type: 'array', sheetRows: 5001 });
  if (workbook.SheetNames.length > 100) throw new Error('The workbook contains too many sheets (maximum 100).');
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    if (sheet['!fullref'] && sheet['!fullref'] !== sheet['!ref']) throw new Error(`Sheet ${name} exceeds the 5,000-row import limit. Split it into smaller files.`);
    const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: true });
    if (rows.some(row => row.length > 100)) throw new Error(`Sheet ${name} has too many columns (maximum 100).`);
    return { name, rows };
  });
  const result = parsePerformanceSheets(sheets, currentYear);
  if (!result.rows.length) throw new Error(`No usable performance indicators were found. ${result.warnings.slice(0, 3).join(' ') || 'Use the provided workbook layout or download the CSV template.'}`);
  return result;
}
export function mergePerformanceImport(config: PerformanceConfig, rows: PerformanceImportRow[], overwrite: boolean): PerformanceConfig {
  const configurations = { ...config.configurations };
  for (const { year, id, entry } of rows) {
    const previous = configurations[year]?.indicators || {};
    if (!overwrite && previous[id]) continue;
    configurations[year] = { indicators: { ...previous, [id]: { ...entry } } };
  }
  return { ...config, configurations };
}
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet applications from executing user-editable labels as formulas.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function performanceCsv(config?: PerformanceConfig, templateYear = '2025-2026'): string {
  const rows: unknown[][] = [['School Year', 'Indicator', 'Numerator', 'Denominator', 'Numerator Label', 'Denominator Label']];
  for (const year of config ? Object.keys(config.configurations).sort() : [templateYear]) {
    for (const { id, label: name } of PERFORMANCE_INDICATORS) {
      const entry = config?.configurations[year].indicators[id];
      if (config && !entry) continue;
      const labels = performanceLabels(id, year);
      rows.push([year, name, entry?.numerator ?? '', entry?.denominator ?? '', entry?.numeratorLabel || labels[0], entry?.denominatorLabel || labels[1]]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
