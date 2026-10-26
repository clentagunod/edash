import { BOOLEAN_FIELDS, cleanText, ENUM_FIELDS, GUARDIAN_CONTACT_FIELDS, headerKey, isUnavailableContact, matchHeader, nameCase, NAME_FIELDS, normalizeGrade, NUMERIC_FIELDS } from './schema';
import { type Cell, type ImportOptions, type Mapping, type ScanResult, type StudentRecord, type Table } from './types';

function dateParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || year < 1900) {
    throw new Error('Invalid calendar date.');
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeBirthDate(value: Cell, order: 'mdy' | 'dmy', date1904 = false): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || (!date1904 && Math.floor(value) === 60)) throw new Error('Invalid Excel date.');
    const days = Math.floor(value) + (date1904 ? 1462 : value < 60 ? 1 : 0);
    const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
    return dateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = cleanText(value);
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T\d{2}:\d{2}:[\d.Z:+-]+)?$/);
  if (match) return dateParts(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) return dateParts(+match[3], +(order === 'mdy' ? match[1] : match[2]), +(order === 'mdy' ? match[2] : match[1]));
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthIndex = (text: string) => months.findIndex(month => month === text.toLowerCase() || month.slice(0, 3) === text.toLowerCase());
  match = text.match(/^(\d{1,2})[\s-]+([a-z]+)[\s,-]+(\d{4})$/i);
  if (match && monthIndex(match[2]) >= 0) return dateParts(+match[3], monthIndex(match[2]) + 1, +match[1]);
  match = text.match(/^([a-z]+)[\s-]+(\d{1,2})[\s,-]+(\d{4})$/i);
  if (match && monthIndex(match[1]) >= 0) return dateParts(+match[3], monthIndex(match[1]) + 1, +match[2]);
  throw new Error('Use YYYY-MM-DD, a four-digit-year date in the selected date order, or an Excel date.');
}

function headerAt(table: Table, row: number, column: number) {
  const merge = table.merges.find(range => row >= range.s.r && row <= range.e.r && column >= range.s.c && column <= range.e.c);
  return { value: table.rows[merge?.s.r ?? row]?.[merge?.s.c ?? column], startColumn: merge?.s.c ?? column };
}

function mapColumns(table: Table, start: number, end: number): { mappings: Mapping[]; ignored: string[] } {
  const mappings: Mapping[] = [], ignored: string[] = [];
  const width = Math.max(...table.rows.slice(start, end + 1).map(row => row.length));
  for (let column = 0; column < width; column++) {
    const parts: string[] = [];
    let leafStart = column;
    for (let row = start; row <= end; row++) {
      const cell = headerAt(table, row, column);
      const text = cleanText(cell.value);
      if (text) {
        if (parts[parts.length - 1] !== text) parts.push(text);
        leafStart = cell.startColumn;
      }
    }
    // A horizontally merged label describes one logical field, not N copies.
    if (!parts.length || leafStart !== column) continue;
    const label = parts.join(' / ');
    // Never match a child "Name" without its parent context.
    const field = matchHeader(parts.join(' '));
    if (field) mappings.push({ column, label, field });
    else ignored.push(label);
  }
  return { mappings, ignored };
}

function headerBounds(table: Table, depth: number): [number, number] {
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) throw new Error('Header depth must be Auto or 1–5 rows.');
  const candidates = table.rows.flatMap((row, index) => row.some(cell => matchHeader(cell) === 'learnerId') ? [index] : []);
  if (!candidates.length) throw new Error('No LRN / Learner ID label found. Add a labelled header row or use Export template.');
  for (const start of candidates) {
    let end = start;
    if (depth) end = start + depth - 1;
    else {
      table.merges.filter(merge => merge.s.r <= start && merge.e.r >= start)
        .forEach(merge => { end = Math.max(end, Math.min(start + 4, merge.e.r)); });
      // Delimited/JSON matrices may contain two header rows without merge metadata.
      if (end === start) {
        const next = table.rows[start + 1] || [];
        const labelled = next.filter(cell => matchHeader(cell));
        if (labelled.length >= 2 && !next.some(cell => /^\d{12}$/.test(cleanText(cell)))) end++;
      }
    }
    if (end >= table.rows.length) continue;
    const { mappings } = mapColumns(table, start, end);
    // An isolated LRN label in introductory notes is not a table header.
    if (mappings.some(mapping => mapping.field === 'learnerId') && mappings.some(mapping => ['name', 'firstName', 'lastName'].includes(mapping.field))) return [start, end];
  }
  throw new Error('The header must include LRN and learner name labels. Check the selected header depth or use Export template.');
}

function normalizeCell(field: string, value: Cell, options: ImportOptions, date1904: boolean): string | number | boolean {
  if (typeof value === 'object' && value !== null) throw new Error('Expected a scalar value, not an object or array.');
  const text = cleanText(value);
  if (text.length > 2000) throw new Error('Value exceeds 2,000 characters.');
  if ((field === 'guardian' || field === 'contact') && isUnavailableContact(value)) return 'N/A';
  if (field === 'learnerId') {
    if (!/^\d{12}$/.test(text)) throw new Error('LRN must contain exactly 12 digits. Keep leading zeros as text.');
    return text;
  }
  if (field === 'birthDate') return normalizeBirthDate(value, options.dateOrder, date1904);
  if (NAME_FIELDS.has(field)) return nameCase(value);
  if (field === 'gradeLevel') {
    const grade = normalizeGrade(value);
    if (!grade) throw new Error('Use Kinder or Grade 1–6.');
    return grade;
  }
  if (field === 'schoolYear') {
    const year = text.replace(/[–—/]/g, '-').replace(/\s/g, '');
    if (year !== options.schoolYear) throw new Error(`School year differs from selected target ${options.schoolYear}.`);
    return year;
  }
  if (BOOLEAN_FIELDS.has(field)) {
    const key = headerKey(text);
    if (['true', 'yes', 'y', '1', 'checked', 'x'].includes(key)) return true;
    if (['false', 'no', 'n', '0', 'none', 'na', 'notapplicable'].includes(key)) return false;
    if (field === 'isIP' && /^[\p{L}\s.'-]+$/u.test(text)) return true;
    throw new Error('Use yes/no or true/false.');
  }
  if (ENUM_FIELDS[field]) {
    const key = headerKey(text);
    const gender = field === 'gender' ? ({ m: 'Male', f: 'Female', boy: 'Male', girl: 'Female' }[key]) : undefined;
    const result = gender || ENUM_FIELDS[field].find(option => headerKey(option) === key);
    if (!result) throw new Error(`Expected ${ENUM_FIELDS[field].join(', ')}. Archive and transfer records belong in tenant backup restore.`);
    return result;
  }
  if (NUMERIC_FIELDS.has(field)) {
    const number = Number(text);
    const max = /Height$/.test(field) ? 300 : /Weight$/.test(field) ? 500 : field === 'age' ? 120 : 100;
    if (!Number.isFinite(number) || number < 0 || number > max || (field === 'age' && !Number.isInteger(number))) {
      throw new Error(`Expected a number from 0 to ${max}${field === 'age' ? ' (whole years)' : ''}.`);
    }
    return number;
  }
  if (field === 'contact') {
    let phone = text.replace(/[\s().-]/g, '');
    if (/^\+?639\d{9}$/.test(phone)) phone = `0${phone.replace(/^\+?63/, '')}`;
    if (/^9\d{9}$/.test(phone)) phone = `0${phone}`;
    if (!/^\+?\d{7,15}$/.test(phone)) throw new Error('Expected a phone number with 7–15 digits.');
    return phone;
  }
  return text;
}

function splitName(record: StudentRecord, warnings: ScanResult['warnings'], row: number) {
  if (!record.name || (record.firstName && record.lastName)) return;
  const parts = String(record.name).split(',').map(cleanText);
  if (parts.length >= 2 && parts.length <= 3) {
    record.lastName ||= nameCase(parts[0]);
    record.firstName ||= nameCase(parts[1]);
    if (parts[2]) record.middleName ||= nameCase(parts[2]);
    if (parts.length === 2 && parts[1].includes(' ')) {
      warnings.push({ row, message: 'Two-part comma name: all given names are kept in First name; verify Middle name in the preview.' });
    }
  } else {
    throw new Error('Full name needs "Last Name, First Name, Middle Name", or separate First name and Last name columns.');
  }
}

export function scanStudentTable(table: Table, options: ImportOptions): ScanResult {
  if (!/^\d{4}-\d{4}$/.test(options.schoolYear) || +options.schoolYear.slice(5) !== +options.schoolYear.slice(0, 4) + 1) throw new Error('Select a valid target school year.');
  const selectedGrade = normalizeGrade(options.gradeLevel);
  const target = options.sections.find(section => normalizeGrade(section.gradeLevel) === selectedGrade && section.section === options.section);
  if (!selectedGrade || !options.section || !target) throw new Error('Select a grade and section configured in the school structure for the target year.');
  const [start, end] = headerBounds(table, options.headerRows);
  const columns = mapColumns(table, start, end);
  // Placement is selected from the school structure, never taken from file cells.
  const placementFields = new Set(['gradeLevel', 'section']);
  const mappings = columns.mappings.filter(mapping => !placementFields.has(mapping.field));
  const ignored = [...columns.ignored, ...columns.mappings.filter(mapping => placementFields.has(mapping.field)).map(mapping => mapping.label)];
  if (!mappings.some(mapping => mapping.field === 'learnerId') || !mappings.some(mapping => ['name', 'firstName', 'lastName'].includes(mapping.field))) {
    throw new Error('The header must include LRN and learner name labels. Use the header-depth option for multi-row tables.');
  }
  const result: ScanResult = { headerRow: start + 1, headerEnd: end + 1, mappings, ignored, students: [], sourceRows: [], errors: [], warnings: [], skippedRows: 0 };
  const seen = new Set<string>();
  const duplicateFields = mappings.filter((mapping, index) => mappings.findIndex(other => other.field === mapping.field) !== index);
  duplicateFields.forEach(mapping => result.errors.push({ row: start + 1, message: `More than one column maps to ${mapping.field}. Rename or remove the ambiguous column "${mapping.label}".` }));
  const now = new Date();
  const today = options.today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const idColumn = mappings.find(mapping => mapping.field === 'learnerId')!.column;
  const nameColumns = mappings.filter(mapping => ['name', 'firstName', 'lastName'].includes(mapping.field));
  const cellErrors = new Map(table.errors.map(error => [`${error.row}:${error.column}`, error]));
  let inFooter = false;
  for (let index = end + 1; index < table.rows.length; index++) {
    const row = table.rows[index] || [], rowNumber = index + 1;
    const id = cleanText(row[idColumn]);
    const names = nameColumns.map(mapping => cleanText(row[mapping.column])).filter(Boolean).join(' ');
    const nonempty = mappings.filter(mapping => cleanText(row[mapping.column])).length;
    if (matchHeader(id) === 'learnerId') { inFooter = false; result.skippedRows++; continue; }
    // SF1 ends with a remarks legend and signatory/summary tables. Their cells
    // are not learner rows even when they overlap the original LRN columns.
    if (!/^\d{12}$/.test(id) && !names && /^(list and code of indicators\b|legend\b|generated on\s*:|prepared by\s*[:;]|certified correct\s*[:;])/i.test(id)) inFooter = true;
    const summary = /^\d{0,3}$/.test(id) && /^(male|female|total(male|female)?|subtotal(male|female)?|combined)$/.test(headerKey(names));
    if (inFooter || !nonempty || summary) {
      result.skippedRows++; continue;
    }
    // Footer rows with no identity and only numeric totals are not students.
    if (!id && !names) { result.skippedRows++; continue; }
    const record: StudentRecord = {};
    const before = result.errors.length;
    for (const mapping of mappings) {
      const value = row[mapping.column];
      const error = cellErrors.get(`${rowNumber}:${mapping.column}`);
      if (error) { result.errors.push({ row: rowNumber, message: `${mapping.label}: ${error.message}` }); continue; }
      if (value == null || cleanText(value) === '') continue; // Missing optional values are omitted; contact defaults are applied below.
      try { record[mapping.field] = normalizeCell(mapping.field, value, options, table.date1904); }
      catch (error) { result.errors.push({ row: rowNumber, message: `${mapping.label}: ${(error as Error).message}` }); }
    }
    try { splitName(record, result.warnings, rowNumber); }
    catch (error) { result.errors.push({ row: rowNumber, message: (error as Error).message }); }
    if (!record.learnerId) result.errors.push({ row: rowNumber, message: 'A valid 12-digit LRN is required.' });
    if (!record.firstName || !record.lastName) result.errors.push({ row: rowNumber, message: 'First name and Last name are required.' });
    GUARDIAN_CONTACT_FIELDS.forEach(field => { record[field] ||= 'N/A'; });
    record.gradeLevel = normalizeGrade(target.gradeLevel);
    record.section = target.section;
    record.schoolYear = options.schoolYear;
    if (record.birthDate) {
      const birth = String(record.birthDate);
      const age = +today.slice(0, 4) - +birth.slice(0, 4) - (today.slice(5) < birth.slice(5) ? 1 : 0);
      if (birth > today || age > 120) result.errors.push({ row: rowNumber, message: 'Birthdate is in the future or over 120 years ago.' });
      else {
        if (record.age != null && Number(record.age) !== age) result.warnings.push({ row: rowNumber, message: 'Age recalculated from birthdate using today, matching the learner form.' });
        record.age = age;
      }
    }
    const lrn = String(record.learnerId || '');
    if (seen.has(lrn)) result.errors.push({ row: rowNumber, message: `Duplicate LRN ${lrn} in this file.` });
    if (lrn) seen.add(lrn);
    if (result.errors.length === before) {
      if (record.name) record.name = [record.firstName, record.middleName, record.lastName, record.suffix].filter(Boolean).join(' ');
      result.students.push(record);
      result.sourceRows.push(rowNumber);
    }
  }
  if (!result.students.length && !result.errors.length) result.errors.push({ row: end + 1, message: 'No student records found below the header.' });
  if (result.students.some(record => record.guardian === 'N/A' || record.contact === 'N/A')) result.warnings.push({ row: 0, message: 'Unavailable guardian/contact details use N/A. You can enter these later by editing the student in the Masterlist. Existing saved details are preserved in update mode.' });
  return result;
}
