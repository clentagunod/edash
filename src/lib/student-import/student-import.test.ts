import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseStudentFile } from './parser';
import { normalizeBirthDate, scanStudentTable } from './normalize';
import { matchHeader } from './schema';
import { studentTemplate } from './download';
import { type Cell, type ImportOptions, type Table } from './types';

const options: ImportOptions = {
  schoolYear: '2026-2027', gradeLevel: 'Grade 6', section: 'POMELO', dateOrder: 'mdy', headerRows: 0,
  sections: [{ gradeLevel: 'Grade 6', section: 'POMELO' }], today: '2026-10-26',
};
const table = (rows: Cell[][]): Table => ({ name: 'Students', rows, merges: [], errors: [], date1904: false });
const textBuffer = (text: string) => new TextEncoder().encode(text).buffer;
const simpleRows: Cell[][] = [['LRN', 'Name', 'Sex (M/F)', 'Birth date'], ['123456789012', 'DELA CRUZ, JUAN, SANTOS', 'M', '06/15/2014']];

describe('student import label detection and normalization', () => {
  it('finds the header after a title and flattens SF1 merged parent/child headers', () => {
    const input = table([
      ['School Form 1'], [], [], [],
      ['LRN', null, 'NAME (Last Name, First Name, Middle Name)', null, 'Sex (M/F)', 'BIRTH DATE (mm/dd/yyyy)', 'ADDRESS', null, 'GUARDIAN (if Not Parent)', null, 'Contact Number of Parent or Guardian'],
      [null, null, null, null, null, null, 'Street', 'Barangay', 'Name', 'Relationship', null],
      ['123456789012', null, 'DELA CRUZ, JUAN, SANTOS', null, 'M', '06/15/2014', 'Ignored street', 'Ignored village', 'MARIA DELA CRUZ', 'Mother', '9123456789'],
      [null, null, 'TOTAL MALE'],
    ]);
    input.merges = [
      { s: { r: 4, c: 0 }, e: { r: 5, c: 1 } },
      { s: { r: 4, c: 2 }, e: { r: 5, c: 3 } },
      { s: { r: 4, c: 4 }, e: { r: 5, c: 4 } },
      { s: { r: 4, c: 5 }, e: { r: 5, c: 5 } },
      { s: { r: 4, c: 6 }, e: { r: 4, c: 7 } },
      { s: { r: 4, c: 8 }, e: { r: 4, c: 9 } },
      { s: { r: 4, c: 10 }, e: { r: 5, c: 10 } },
    ];
    const scan = scanStudentTable(input, options);
    expect(scan.errors).toEqual([]);
    expect(scan.headerRow).toBe(5);
    expect(scan.headerEnd).toBe(6);
    expect(scan.students[0]).toMatchObject({
      learnerId: '123456789012', firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz',
      gender: 'Male', birthDate: '2014-06-15', age: 12, guardian: 'Maria Dela Cruz', contact: '09123456789',
      gradeLevel: 'Grade 6', section: 'POMELO',
    });
    expect(scan.ignored).toContain('ADDRESS / Barangay');
    expect(scan.skippedRows).toBe(1);
  });

  it('does not confuse parent names, religion, or mother tongue language with student fields', () => {
    expect(matchHeader("Father's Name (Last Name, First Name, Middle Name)")).toBeUndefined();
    expect(matchHeader('Religion')).toBeUndefined();
    expect(matchHeader('MOTHER TONGUE (Grade 1 to 3 Only)')).toBeUndefined();
    expect(matchHeader('Student LRN')).toBe('learnerId');
  });

  it('excludes SF1 totals, the remarks legend, and signatures after the student table', () => {
    const scan = scanStudentTable(table([
      ...simpleRows,
      [1, '<=== TOTAL MALE'],
      [1, '<=== COMBINED'],
      ['List and Code of Indicators under REMARKS column'],
      ['Indicator', 'Required Information'],
      ['Transferred out', 'Signature from a separate table'],
      ['Generated on: Monday, October 26, 2026'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students).toHaveLength(1);
    expect(scan.skippedRows).toBe(6);
  });

  it('normalizes program booleans, age, enums and contacts without keeping unknown fields', () => {
    const scan = scanStudentTable(table([
      ['Learner ID', 'First name', 'Last name', 'DOB', 'age', '4Ps', 'IP (Ethnic Group)', 'BOSY RMA', 'Phone', 'Unknown'],
      ['012345678901', '  JUAN  ', 'DELA CRUZ', '2014-06-15', 10, 'Yes', 'Named group', 'nearly proficient', '+63 912-345-6789', 'Discard me'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ learnerId: '012345678901', age: 12, is4Ps: true, isIP: true, bosyRMA: 'Nearly-Proficient', contact: '09123456789' });
    expect(scan.students[0]).not.toHaveProperty('Unknown');
    expect(scan.warnings.some(issue => issue.message.includes('Age recalculated'))).toBe(true);
  });

  it('blocks duplicate labels rather than silently choosing one', () => {
    const scan = scanStudentTable(table([['LRN', 'Student ID', 'First name', 'Last name'], ['123456789012', '123456789012', 'Juan', 'Cruz']]), options);
    expect(scan.errors[0].message).toContain('More than one column');
  });

  it('reports invalid and missing LRNs, names, dates and duplicate LRNs by source row', () => {
    const scan = scanStudentTable(table([
      ...simpleRows,
      ['123456789012', 'Cruz, Juan', 'F', '02/31/2014'],
      ['', 'Cruz, Maria', 'F', '06/15/2014'],
      ['111111111111', 'Ambiguous Name', 'M', '06/15/2014'],
    ]), options);
    expect(scan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, message: expect.stringContaining('Invalid calendar date') }),
      expect.objectContaining({ row: 3, message: expect.stringContaining('Duplicate LRN') }),
      expect.objectContaining({ row: 4, message: expect.stringContaining('12-digit LRN') }),
      expect.objectContaining({ row: 5, message: expect.stringContaining('Full name needs') }),
    ]));
  });

  it('omits blank optional values and requires a configured grade/section', () => {
    expect(() => scanStudentTable(table(simpleRows), { ...options, section: '' })).toThrow('Select a grade and section');
    expect(() => scanStudentTable(table(simpleRows), { ...options, gradeLevel: 'Grade 5' })).toThrow('Select a grade and section');
    const valid = scanStudentTable(table(simpleRows), options);
    expect(valid.students[0]).toMatchObject({ guardian: 'N/A', contact: 'N/A' });
    expect(valid.students[0]).not.toHaveProperty('is4Ps');
  });

  it.each([
    ['', null], ['  ', '\t'], ['n / a', 'n/a'], ['NA', 'None'], ['not available', '—'],
  ])('normalizes unavailable guardian/contact values %s / %s to N/A', (guardian, contact) => {
    const scan = scanStudentTable(table([
      ['LRN', 'Name', 'Guardian', 'Contact number'],
      ['123456789012', 'Cruz, Juan', guardian, contact],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ guardian: 'N/A', contact: 'N/A' });
  });

  it('fills each missing contact detail independently and retains provided values', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'Name', 'Guardian', 'Contact number'],
      ['123456789012', 'Cruz, Juan', 'MARIA CRUZ', ''],
      ['111111111111', 'Cruz, Ana', null, '09123456789'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ guardian: 'Maria Cruz', contact: 'N/A' });
    expect(scan.students[1]).toMatchObject({ guardian: 'N/A', contact: '09123456789' });
  });

  it('round-trips generated N/A placeholders through JSON without validation errors', () => {
    const scan = scanStudentTable(table(simpleRows), options);
    const parsed = parseStudentFile(textBuffer(JSON.stringify(scan.students)));
    const reimport = scanStudentTable(parsed.tables[0], options);
    expect(reimport.errors).toEqual([]);
    expect(reimport.students[0]).toMatchObject({ guardian: 'N/A', contact: 'N/A' });
  });

  it('still rejects invalid nonempty contact numbers', () => {
    const scan = scanStudentTable(table([['LRN', 'Name', 'Contact'], ['123456789012', 'Cruz, Juan', 'invalid phone']]), options);
    expect(scan.errors.some(issue => issue.message.includes('phone number'))).toBe(true);
  });

  it('rejects a mismatched school year and future birthdate', () => {
    const scan = scanStudentTable(table([['LRN', 'Name', 'School year', 'DOB'], ['123456789012', 'Cruz, Juan', '2025-2026', '2030-01-01']]), options);
    expect(scan.errors.some(issue => issue.message.includes('differs from selected target'))).toBe(true);
    expect(scan.errors.some(issue => issue.message.includes('future'))).toBe(true);
  });

  it('blocks mapped spreadsheet errors, but ignores errors in discarded columns', () => {
    const input = table([...simpleRows.map(row => [...row, 'ignored'])]);
    input.errors = [{ row: 2, column: 4, message: 'Ignored Excel error' }];
    expect(scanStudentTable(input, options).errors).toEqual([]);
    input.errors.push({ row: 2, column: 3, message: 'Formula has no saved value' });
    expect(scanStudentTable(input, options).errors[0].message).toContain('Formula has no saved value');
  });

  it('rejects datasets with no labels or no learner identity labels', () => {
    expect(() => scanStudentTable(table(simpleRows.slice(1)), options)).toThrow('No LRN');
    expect(() => scanStudentTable(table([['LRN', 'Unrelated'], ['123456789012', 'value']]), options)).toThrow('learner name labels');
  });

  it('skips an isolated LRN label in introductory notes', () => {
    expect(scanStudentTable(table([['LRN'], [], ...simpleRows]), options).headerRow).toBe(3);
  });

  it('assigns the selected school-structure placement instead of the file grade and section', () => {
    const scan = scanStudentTable(table([['LRN', 'First name', 'Last name', 'Grade', 'Section'], ['123456789012', 'Juan', 'Cruz', '5', 'mango']]), {
      ...options, sections: [...options.sections, { gradeLevel: 'Grade 5', section: 'MANGO' }],
    });
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ gradeLevel: 'Grade 6', section: 'POMELO' });
    expect(scan.ignored).toEqual(expect.arrayContaining(['Grade', 'Section']));
    expect(scan.mappings.some(mapping => ['gradeLevel', 'section'].includes(mapping.field))).toBe(false);
  });

  it('ignores invalid or duplicate placement columns and their spreadsheet errors', () => {
    const input = table([
      ['LRN', 'Name', 'Grade', 'Grade level', 'Section'],
      ['123456789012', 'Cruz, Juan', 'Unconfigured grade', 'invalid', 'Unknown section'],
    ]);
    input.errors = [{ row: 2, column: 2, message: 'Spreadsheet placement error' }];
    const scan = scanStudentTable(input, options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ gradeLevel: 'Grade 6', section: 'POMELO' });
  });
});

describe('date formats', () => {
  it.each([
    ['06/15/2014', 'mdy', '2014-06-15'], ['15/06/2014', 'dmy', '2014-06-15'],
    ['2014-06-15', 'mdy', '2014-06-15'], ['15 Jun 2014', 'mdy', '2014-06-15'],
    ['June 15, 2014', 'mdy', '2014-06-15'], [41805, 'mdy', '2014-06-15'],
    ['2024-02-29', 'mdy', '2024-02-29'],
  ])('normalizes %s', (value, order, expected) => {
    expect(normalizeBirthDate(value, order as 'mdy' | 'dmy')).toBe(expected);
  });
  it('respects the Excel 1904 epoch', () => expect(normalizeBirthDate(41805 - 1462, 'mdy', true)).toBe('2014-06-15'));
  it.each(['02/29/2023', '31/06/2014', '06/15/14', 'not a date', 'Junk 15, 2014', 60])('rejects invalid date %s', value => {
    expect(() => normalizeBirthDate(value, 'mdy')).toThrow();
  });
});

describe('file content parsing', () => {
  it.each([',', ';', '\t', '|'])('reads delimited data using %s separators', delimiter => {
    const parsed = parseStudentFile(textBuffer(`LRN${delimiter}First name${delimiter}Last name\n012345678901${delimiter}Juan${delimiter}Cruz`));
    expect(scanStudentTable(parsed.tables[0], options).students[0]).toMatchObject({ learnerId: '012345678901', firstName: 'Juan' });
  });

  it('round-trips the downloadable JSON template', () => {
    const students = studentTemplate(options.schoolYear, options.gradeLevel, options.section);
    const parsed = parseStudentFile(textBuffer(JSON.stringify({ schoolId: 'school-a', students })));
    expect(parsed.schoolId).toBe('school-a');
    const scan = scanStudentTable(parsed.tables[0], options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject(students[0]);
  });

  it('accepts JSON Lines and header/data matrices', () => {
    expect(parseStudentFile(textBuffer('{"LRN":"123456789012","Name":"Cruz, Juan"}\n{"LRN":"111111111111","Name":"Cruz, Maria"}')).tables[0].rows.length).toBe(3);
    expect(scanStudentTable(parseStudentFile(textBuffer(JSON.stringify(simpleRows))).tables[0], options).errors).toEqual([]);
  });

  it.each(['xls', 'xlsx', 'ods', 'xml', 'html'])('reads %s by content without a filename', bookType => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(simpleRows), 'Students');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: bookType as XLSX.BookType });
    expect(scanStudentTable(parseStudentFile(buffer).tables[0], options).errors).toEqual([]);
  });

  it('keeps worksheets separate', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(simpleRows), 'First');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(simpleRows), 'Second');
    expect(parseStudentFile(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })).tables.map(sheet => sheet.name)).toEqual(['First', 'Second']);
  });

  it('rejects malformed JSON, nested student values, full tenant backups, and empty files', () => {
    expect(() => parseStudentFile(textBuffer('{bad}'))).toThrow('Invalid JSON');
    expect(() => parseStudentFile(textBuffer('{"format":"edash-tenant-firestore-backup"}'))).toThrow('tenant backup');
    expect(() => parseStudentFile(new ArrayBuffer(0))).toThrow('empty');
    const parsed = parseStudentFile(textBuffer('[{"LRN":"123456789012","First name":{"nested":"Juan"},"Last name":"Cruz"}]'));
    expect(scanStudentTable(parsed.tables[0], options).errors.some(error => error.message.includes('scalar value'))).toBe(true);
  });
});
