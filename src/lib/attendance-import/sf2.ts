import * as XLSX from 'xlsx';
import { attendanceTotal, isAttendanceCount } from '../attendance';
import { normalizeCurriculumGrade } from '../curriculum-subjects';
import { formatProfileLearnerName } from '../learner-sorting';
import { normalizeNameSuffix, normalizeStudentName } from '../student-import/names';

export const SF2_MONTHS = [
  ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'], ['Apr', 'April'],
  ['May', 'May'], ['Jun', 'June'], ['Jul', 'July'], ['Aug', 'August'],
  ['Sep', 'September'], ['Oct', 'October'], ['Nov', 'November'], ['Dec', 'December'],
].map(([value, label]) => ({ value, label }));

export interface Sf2Sheet {
  name: string;
  rows: unknown[][];
  errors?: { row: number; column: number; message: string }[];
}
export interface Sf2Row {
  rowNumber: number; sourceName: string; learnerId?: string;
  daysPresent: string; daysAbsent: string; classDays: string;
}
export interface Sf2Report {
  month: string; detectedMonth?: string; detectedSchoolYear?: string;
  detectedGrade?: string; detectedSection?: string;
  rows: Sf2Row[]; errors: string[]; warnings: string[];
}
export interface AttendanceTarget {
  learnerId: string; firstName?: unknown; middleName?: unknown; lastName?: unknown;
  suffix?: unknown; name?: unknown; gradeLevel: string; section: string; attendance?: unknown;
  expectedIdentity?: Record<string, unknown>;
}
export interface AttendanceImportEntry extends Sf2Row {
  learnerId: string; name: string; expectedAttendance: unknown;
  expectedIdentity?: Record<string, unknown>;
}
export interface Sf2Review {
  entries: AttendanceImportEntry[]; errors: string[]; warnings: string[]; unmatchedMasterlist: string[];
}
export interface Sf2ScanOptions {
  month: string; schoolYear: string; gradeLevel: string; section: string; schoolId?: string;
}

const text = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const key = (value: unknown) => text(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const MAX_ROWS = 20000, MAX_COLUMNS = 256, MAX_SHEETS = 30;

/** Reads cached Excel values. Daily marks and formulas are never executed. */
export function readSf2Workbook(buffer: ArrayBuffer): { sheets: Sf2Sheet[] } {
  if (!buffer.byteLength) throw new Error('The selected Excel file is empty.');
  if (buffer.byteLength > 10 * 1024 * 1024) throw new Error('Maximum SF2 file size is 10 MB.');
  const bytes = new Uint8Array(buffer);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!zip && !ole) throw new Error('Choose an Excel .xlsx or .xls workbook in School Form 2 format.');
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', raw: true, cellFormula: true, cellHTML: false, bookVBA: true, sheetRows: MAX_ROWS + 1 });
  } catch { throw new Error('Unable to read this Excel workbook. Use an unencrypted .xlsx or .xls file.'); }
  if (workbook.vbaraw) throw new Error('Macro-enabled workbooks are not supported. Save a macro-free .xlsx copy.');
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_SHEETS) throw new Error('The workbook must contain 1–30 worksheets.');
  return { sheets: workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r >= MAX_ROWS || range.e.c >= MAX_COLUMNS) throw new Error(`Worksheet "${name}" exceeds 20,000 rows or 256 columns. Remove unused formatted rows and columns.`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, range: 0 });
    const errors: NonNullable<Sf2Sheet['errors']> = [];
    for (const address of Object.keys(sheet).filter(value => !value.startsWith('!'))) {
      const cell = sheet[address] as XLSX.CellObject;
      if (cell.t === 'e' || (cell.f && cell.v == null)) {
        const position = XLSX.utils.decode_cell(address);
        errors.push({ row: position.r + 1, column: position.c, message: cell.t === 'e'
          ? `Spreadsheet error at ${address}. Correct the workbook before importing.`
          : `Formula at ${address} has no saved result. Recalculate and save the workbook in Excel before importing.` });
      }
    }
    return { name, rows, errors };
  }) };
}

function monthValue(value: unknown): string | undefined {
  const words: string[] = text(value).toLowerCase().match(/[a-z]+/g) || [];
  const found = SF2_MONTHS.filter(month => words.includes(month.label.toLowerCase()) || words.includes(month.value.toLowerCase()) || (month.value === 'Sep' && words.includes('sept')));
  return found.length === 1 ? found[0].value : undefined;
}

function metadata(rows: unknown[][], matches: (label: string) => boolean, accept: (value: unknown) => boolean): unknown[] {
  const found: unknown[] = [];
  rows.forEach((row, r) => row.forEach((value, c) => {
    if (!matches(key(value))) return;
    if (accept(value)) found.push(value);
    // Standard SF2 uses merged labels with the value to the right. Some school
    // templates place it underneath; inspect both directions before giving up.
    const horizontal = row.slice(c + 1, c + 15).find(accept);
    if (horizontal !== undefined) found.push(horizontal);
    else {
      const vertical = rows.slice(r + 1, r + 7).flatMap(next => next.slice(c, c + 3)).find(accept);
      if (vertical !== undefined) found.push(vertical);
    }
  }));
  return found;
}

const absentHeader = (value: unknown) => /^(?:absent|absences|daysabsent|totalabsent|totalabsences|noofabsences|numberofabsences|noofdaysabsent|numberofdaysabsent)$/.test(key(value));
const presentHeader = (value: unknown) => /^(?:present|dayspresent|totalpresent|noofdayspresent|numberofdayspresent)$/.test(key(value));
const nameHeader = (value: unknown) => /^(?:learners?name|nameoflearners?|students?name|nameofstudents?|fullname)/.test(key(value));
const lrnHeader = (value: unknown) => /^(?:lrn|learnerid|learnerreferencenumber)$/.test(key(value));
const summaryLabel = (value: unknown) => /^(?:(?:male|female)(?:total.*)?|combinedtotal.*|totalperday|totallearners|totalnooflearners)$/.test(key(value));
const footerLabel = (value: unknown) => /^(?:combinedtotal|guidelines|summary|preparedby|certifiedcorrect|submittedby)/.test(key(value));
const labelLike = (value: unknown) => /^(?:schoolyear|schoolid|nameofschool|gradelevel|section|reportforthemonthof|reportforthemonth)$/.test(key(value));

export function scanSf2Sheet(sheet: Sf2Sheet, options: Sf2ScanOptions): Sf2Report {
  const report: Sf2Report = { month: '', rows: [], errors: [], warnings: [] };
  if (sheet.rows.length > MAX_ROWS || sheet.rows.some(row => row.length > MAX_COLUMNS)) {
    report.errors.push('This worksheet exceeds the supported SF2 dimensions.'); return report;
  }
  const rows = sheet.rows;
  const candidates = rows.slice(0, 60).map((row, index) => ({ index, absent: row.findIndex(absentHeader), present: row.findIndex(presentHeader) }))
    .filter(value => value.absent >= 0 && value.present >= 0 && value.absent !== value.present);
  const header = candidates[0];
  const title = rows.slice(0, 15).flat().map(text).join(' ');
  if (!/(?:school\s*form\s*2|\bsf\s*2\b)/i.test(title) || !/daily\s+attendance/i.test(title)) report.errors.push('This worksheet is not a School Form 2 Daily Attendance Report.');
  if (!header) { report.errors.push('The SF2 ABSENT and PRESENT total columns could not be found.'); return report; }
  if (candidates.length > 1) report.errors.push('Multiple ABSENT/PRESENT header pairs were found. Keep one SF2 report per worksheet.');
  const upper = rows.slice(0, header.index + 1);
  const nameLabels = upper.flatMap((row, r) => row.flatMap((value, c) => nameHeader(value) ? [{ r, c }] : []));
  const name = nameLabels[nameLabels.length - 1];
  if (!name || name.c >= Math.min(header.absent, header.present)) { report.errors.push('The SF2 learner name column could not be found.'); return report; }
  const monthLabels = metadata(upper, label => /^reportforthemonth(?:of)?/.test(label), value => Boolean(monthValue(value)));
  const detectedMonths = [...new Set(monthLabels.map(monthValue).filter(Boolean))];
  if (detectedMonths.length > 1) report.errors.push('The report contains conflicting month labels. Correct the workbook before importing.');
  report.detectedMonth = detectedMonths[0] || monthValue(sheet.name);
  if (options.month === 'auto') {
    report.month = report.detectedMonth || '';
    if (!report.month) report.errors.push('The report month could not be detected. Choose its month manually.');
  } else {
    report.month = SF2_MONTHS.find(month => month.value === options.month)?.value || '';
    if (!report.month) report.errors.push('Choose a valid report month.');
    if (report.detectedMonth && report.detectedMonth !== report.month) report.warnings.push(`The workbook says ${report.detectedMonth}; this import will be saved to ${report.month} as selected.`);
  }
  const yearPattern = /\b(20\d{2})\s*[-/–—]\s*(20\d{2})\b/;
  const years = metadata(upper, label => label === 'schoolyear', value => yearPattern.test(text(value)))
    .map(value => text(value).match(yearPattern)!.slice(1).join('-'));
  report.detectedSchoolYear = years[0];
  if (years.some(value => value !== options.schoolYear)) report.errors.push(`The workbook school year (${[...new Set(years)].join(', ')}) does not match ${options.schoolYear}.`);
  const grades = metadata(upper, label => label === 'gradelevel', value => /^(?:(?:grade\s*)?[1-9]|kinder(?:garten)?|kg)$/i.test(text(value)));
  report.detectedGrade = grades.length ? normalizeCurriculumGrade(grades[0]) : undefined;
  if (grades.some(value => normalizeCurriculumGrade(value) !== normalizeCurriculumGrade(options.gradeLevel))) report.errors.push(`The workbook grade (${report.detectedGrade}) does not match ${options.gradeLevel}.`);
  const sections = metadata(upper, label => label === 'section', value => Boolean(text(value)) && !labelLike(value));
  report.detectedSection = sections.length ? text(sections[0]) : undefined;
  if (sections.some(value => key(value) !== key(options.section))) report.errors.push(`The workbook section (${report.detectedSection}) does not match ${options.section}.`);
  if (options.schoolId) {
    const ids = metadata(upper, label => label === 'schoolid', value => /^\d{6}$/.test(text(value)));
    if (ids.some(value => text(value) !== options.schoolId)) report.errors.push('The workbook School ID does not match the current school.');
  }
  const dateLabel = upper[name.r].findIndex(value => /(?:1st\s*row\s*for\s*date|2nd\s*row\s*for\s*day)/i.test(text(value)));
  const nameEnd = dateLabel > name.c ? dateLabel : Math.min(name.c + 6, header.absent, header.present);
  const lrnColumn = upper.flatMap(row => row.flatMap((value, c) => lrnHeader(value) ? [c] : []))[0];
  const schoolDays = metadata(upper, label => /^(?:noofschooldays|numberofschooldays)$/.test(label), value => isAttendanceCount(text(value)) && Number(value) <= 31).map(value => text(value))[0];
  const sourceNames = new Set<string>();
  for (let r = header.index + 1; r < rows.length; r++) {
    const row = rows[r];
    const names = row.slice(name.c, nameEnd).filter(value => typeof value === 'string' && /\p{L}/u.test(value) && text(value));
    if (names.some(footerLabel)) break;
    if (names.some(summaryLabel)) continue;
    const sourceName = text(names[0]);
    const countValues = [row[header.present], row[header.absent]].map(text);
    if (!sourceName && !countValues.some(Boolean)) continue; // Empty numbered template row.
    const rowNumber = r + 1;
    const rowErrors = (sheet.errors || []).filter(issue => issue.row === rowNumber && (issue.column === header.present || issue.column === header.absent || (issue.column >= name.c && issue.column < nameEnd)));
    report.errors.push(...rowErrors.map(issue => `Row ${rowNumber}: ${issue.message}`));
    if (!sourceName) { report.errors.push(`Row ${rowNumber}: attendance totals have no learner name.`); continue; }
    if (names.length > 1) { report.errors.push(`Row ${rowNumber}: multiple learner names occupy the name columns. Correct this row.`); continue; }
    if (sourceName.length > 250) { report.errors.push(`Row ${rowNumber}: learner name exceeds 250 characters.`); continue; }
    const sourceKey = normalizedName(sourceName);
    if (sourceNames.has(sourceKey)) report.errors.push(`Row ${rowNumber}: duplicate learner name "${sourceName}" in the SF2 file.`);
    sourceNames.add(sourceKey);
    if (!countValues.every(value => value !== '' && isAttendanceCount(value))) {
      report.errors.push(`Row ${rowNumber} (${sourceName}): Present and Absent must both contain non-negative saved numbers. Recalculate and save formula cells first.`); continue;
    }
    const [daysPresent, daysAbsent] = countValues;
    const classDays = attendanceTotal(countValues);
    if (Number(classDays) > 31) { report.errors.push(`Row ${rowNumber} (${sourceName}): Present + Absent exceeds 31 days.`); continue; }
    if (schoolDays && Number(classDays) > Number(schoolDays)) report.errors.push(`Row ${rowNumber} (${sourceName}): Present + Absent exceeds the report's ${schoolDays} school days.`);
    else if (schoolDays && Number(classDays) !== Number(schoolDays)) report.warnings.push(`Row ${rowNumber} (${sourceName}) totals ${classDays} days; the report declares ${schoolDays} school days.`);
    const learnerId = lrnColumn === undefined ? '' : text(row[lrnColumn]);
    if (learnerId && !/^\d{12}$/.test(learnerId)) report.errors.push(`Row ${rowNumber}: LRN must contain exactly 12 digits.`);
    report.rows.push({ rowNumber, sourceName, ...(learnerId ? { learnerId } : {}), daysPresent, daysAbsent, classDays });
  }
  if (!report.rows.length) report.errors.push('No complete learner attendance rows were found in this SF2 worksheet.');
  return report;
}

function normalizedName(value: unknown): string {
  return text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[.'’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function nameAliases(learner: AttendanceTarget, includeMiddleInitials = true): Set<string> {
  const aliases = new Set<string>();
  const add = (...values: unknown[]) => { const value = normalizedName(values.map(text).filter(Boolean).join(' ')); if (value) aliases.add(value); };
  const structured = Boolean(text(learner.firstName) && text(learner.lastName));
  // Older records may keep JR. in a name field, in the suffix field, or both.
  // Normalize a copy using the SF1 rules without altering the reviewed record.
  const name: Record<string, string> = structured
    ? Object.fromEntries(['firstName', 'middleName', 'lastName', 'suffix'].map(field => [field, text(learner[field])]))
    : { suffix: text(learner.suffix) };
  if (!structured) {
    const fullName = text(learner.name);
    if (fullName.includes(',')) name.name = fullName;
    else name.firstName = fullName; // Retain the order of names without comma anchors.
  }
  try {
    if (!structured && !name.name) {
      const parts = text(name.firstName).split(/\s+/).filter(Boolean);
      const embedded = parts.filter(part => /^(?:jr|jnr|sr|snr)$/.test(normalizedName(part)));
      if (parts.length > embedded.length && embedded.length) {
        const suffixes = new Set([...embedded, name.suffix].map(normalizeNameSuffix).filter(Boolean));
        if (suffixes.size > 1) return aliases;
        name.suffix = [...suffixes][0];
        name.firstName = parts.filter(part => !embedded.includes(part)).join(' ');
      }
    }
    normalizeStudentName(name);
  }
  catch { return aliases; } // Conflicting suffixes cannot identify a learner safely.
  const suffix = text(name.suffix);
  const suffixes = normalizedName(suffix) === 'jr' ? ['Jr.', 'Junior', 'Jnr', 'J. R.']
    : normalizedName(suffix) === 'sr' ? ['Sr.', 'Senior', 'Snr', 'S. R.'] : [suffix];
  if (name.firstName && name.lastName) {
    const middles = [text(name.middleName)];
    if (includeMiddleInitials && middles[0]) middles.push(middles[0].split(/\s+/).map(value => value[0]).join(' '));
    for (const middle of middles) for (const extension of suffixes) {
      add(name.lastName, name.firstName, middle, extension);
      add(name.lastName, extension, name.firstName, middle);
      add(name.lastName, name.firstName, extension, middle);
      add(name.firstName, middle, name.lastName, extension);
      add(name.firstName, extension, middle, name.lastName);
      add(name.firstName, middle, extension, name.lastName);
    }
  } else {
    const parts = text(name.firstName).split(/\s+/).filter(Boolean);
    for (const extension of suffixes) {
      // Move only the recognized suffix; preserve every other token's order.
      for (let index = 0; index <= parts.length; index++) add(...parts.slice(0, index), extension, ...parts.slice(index));
    }
  }
  return aliases;
}

/** Exact normalized aliases only. Ambiguous identities never become automatic matches. */
export function matchSf2Rows(report: Sf2Report, learners: AttendanceTarget[]): Sf2Review {
  const review: Sf2Review = { entries: [], errors: [...report.errors], warnings: [...report.warnings], unmatchedMasterlist: [] };
  const aliases = new Map<string, AttendanceTarget[]>();
  const ids = new Map<string, AttendanceTarget[]>();
  for (const learner of learners) {
    ids.set(learner.learnerId, [...(ids.get(learner.learnerId) || []), learner]);
    for (const alias of nameAliases(learner)) aliases.set(alias, [...(aliases.get(alias) || []), learner]);
  }
  const matched = new Set<string>();
  for (const row of report.rows) {
    // A spelled-out source middle name must not match a different middle name
    // merely because they share an initial. Only masterlist aliases abbreviate.
    const sourceAliases = nameAliases({ learnerId: '', name: row.sourceName, gradeLevel: '', section: '' }, false);
    const byName = [...new Set([...sourceAliases].flatMap(alias => aliases.get(alias) || []))];
    const candidates = row.learnerId ? ids.get(row.learnerId) || [] : byName;
    if (candidates.length !== 1) {
      review.errors.push(`Row ${row.rowNumber} (${row.sourceName}): ${candidates.length ? 'ambiguous match; multiple learners have this identity' : 'no matching learner in the selected section'}. Correct the file or masterlist before importing.`); continue;
    }
    const learner = candidates[0];
    if (row.learnerId && !byName.includes(learner)) { review.errors.push(`Row ${row.rowNumber}: LRN matches ${learner.learnerId}, but its learner name does not match the masterlist.`); continue; }
    if (matched.has(learner.learnerId)) { review.errors.push(`Row ${row.rowNumber}: learner ${learner.learnerId} occurs more than once in the SF2 file.`); continue; }
    matched.add(learner.learnerId);
    review.entries.push({ ...row, learnerId: learner.learnerId, name: formatProfileLearnerName(learner, learner.learnerId), expectedAttendance: learner.attendance,
      ...(learner.expectedIdentity ? { expectedIdentity: { ...learner.expectedIdentity } } : {}) });
  }
  review.unmatchedMasterlist = learners.filter(learner => !matched.has(learner.learnerId)).map(learner => formatProfileLearnerName(learner, learner.learnerId));
  if (review.unmatchedMasterlist.length) review.warnings.push(`${review.unmatchedMasterlist.length} masterlist learner(s) are missing from this SF2 report. Their attendance will remain unchanged.`);
  if (!review.entries.length && !review.errors.length) review.errors.push('No learners matched the selected section.');
  return review;
}
