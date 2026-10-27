import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { scanStudentTable } from './normalize';
import { parseStudentFile } from './parser';
import { matchHeader } from './schema';
import type { Cell, ImportOptions, Table } from './types';

const options: ImportOptions = {
  schoolYear: '2026-2027', gradeLevel: 'Grade 6', section: 'POMELO', dateOrder: 'mdy', headerRows: 0,
  sections: [{ gradeLevel: 'Grade 6', section: 'POMELO' }],
};
const table = (rows: Cell[][]): Table => ({ name: 'Students', rows, merges: [], errors: [], date1904: false });
const scanName = (name: string) => scanStudentTable(table([['LRN', 'Name'], ['123456789012', name]]), options);

describe('student import name suffixes', () => {
  it.each([
    ['DELA CRUZ JR., JUAN, SANTOS', 'Jr.'],
    ['DELA CRUZ, JUAN JR., SANTOS', 'Jr.'],
    ['DELA CRUZ, JUAN, SANTOS Jr', 'Jr.'],
    ['DELA CRUZ, JUAN, SANTOS, JR.', 'Jr.'],
    ['DELA CRUZ, JUAN, SANTOS, Junior', 'Jr.'],
    ['DELA CRUZ, JUAN, SANTOS (j.r.)', 'Jr.'],
    ['DELA CRUZ III, JUAN, SANTOS', 'III'],
    ['DELA CRUZ, JUAN iii, SANTOS', 'III'],
    ['DELA CRUZ, JUAN, SANTOS III', 'III'],
    ['DELA CRUZ, JUAN, SANTOS, i.v.', 'IV'],
    ['DELA CRUZ, JUAN, SANTOS XII', 'XII'],
    ['DELA CRUZ, JUAN, SANTOS, V', 'V'],
    ['DELA CRUZ, JUAN, SANTOS, X', 'X'],
    ['DELA CRUZ, JUAN, SANTOS senior', 'Sr.'],
  ])('extracts the suffix from %s', (name, suffix) => {
    const scan = scanName(name);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz', suffix, name: `Juan Santos Dela Cruz ${suffix}` });
  });

  it.each([
    ['CAPAPAS,JORRY,JR., BALAGA', 'Jr.'],
    ['CAPAPAS, JORRY, jr, BALAGA', 'Jr.'],
    ['CAPAPAS, JORRY, (J.R.), BALAGA', 'Jr.'],
    ['CAPAPAS, JORRY, III, BALAGA', 'III'],
    ['CAPAPAS, JORRY, Senior, BALAGA', 'Sr.'],
    ['CAPAPAS, JORRY, BALAGA, JR.', 'Jr.'],
    ['CAPAPAS, JORRY, JR., BALAGA, Junior', 'Jr.'],
  ])('finds a standalone suffix independently of its comma position: %s', (name, suffix) => {
    const scan = scanName(name);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Jorry', middleName: 'Balaga', lastName: 'Capapas', suffix, name: `Jorry Balaga Capapas ${suffix}` });
  });

  it('keeps compound given names and middle names when a suffix appears between them', () => {
    const scan = scanName('DELA CRUZ, JUAN MIGUEL, III, DE LOS SANTOS');
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan Miguel', middleName: 'De Los Santos', lastName: 'Dela Cruz', suffix: 'III' });
  });

  it('checks suffixes between comma components even when separate name fields already exist', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'Name', 'First name', 'Middle name', 'Last name'],
      ['123456789012', 'Cruz, Juan, Jr., Santos', 'Juan', 'Santos', 'Cruz'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'Santos', lastName: 'Cruz', suffix: 'Jr.', name: 'Juan Santos Cruz Jr.' });
  });

  it('preserves a middle initial after a recognized suffix and tolerates a trailing comma', () => {
    const scan = scanName('Cruz, Juan, Jr., V.,');
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'V.', lastName: 'Cruz', suffix: 'Jr.' });
  });

  it('does not discard extra unrecognized name components after extracting a suffix', () => {
    const scan = scanName('Cruz, Juan, Jr., Santos, Garcia');
    expect(scan.students).toEqual([]);
    expect(scan.errors).toContainEqual(expect.objectContaining({ row: 2, message: expect.stringContaining('Full name needs') }));
  });

  it('reconciles a reordered name with the explicit suffix column', () => {
    const input = table([
      ['LRN', 'Name', 'Suffix'], ['123456789012', 'Cruz, Juan, III, Santos', 'iii'],
    ]);
    const scan = scanStudentTable(input, options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'Santos', lastName: 'Cruz', suffix: 'III' });
    input.rows[1][2] = 'Jr.';
    expect(scanStudentTable(input, options).errors[0].message).toContain('Conflicting name suffixes');
  });

  it.each(['Jr.', 'III', 'Sr.'])('handles a suffix-only third name component (%s)', suffix => {
    const scan = scanName(`Cruz, Juan, ${suffix}`);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', lastName: 'Cruz', suffix });
    expect(scan.students[0]).not.toHaveProperty('middleName');
  });

  it('keeps two-part given names together while extracting their suffix', () => {
    const scan = scanName('Dela Cruz, Juan Miguel III');
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan Miguel', lastName: 'Dela Cruz', suffix: 'III' });
    expect(scan.warnings.some(issue => issue.message.includes('verify Middle name'))).toBe(true);
  });

  it.each(['Suffix', 'Name suffix', 'Name Extension (Jr., III)', 'Name Ext.', 'Name Extn.', 'Ext. Name', 'Student suffix', 'Name extension / suffix'])('matches the %s header', header => {
    expect(matchHeader(header)).toBe('suffix');
  });

  it('extracts embedded suffixes from separate name fields and deduplicates a matching column', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'First name', 'Middle name', 'Last name', 'Name extension'],
      ['123456789012', 'JUAN j.r.', 'SANTOS', 'DELA CRUZ JR', 'junior'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz', suffix: 'Jr.' });
  });

  it('retains custom suffixes in an explicit column or fourth name component', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'First name', 'Last name', 'Suffix'], ['123456789012', 'Juan', 'Cruz', 'Ph.D.'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0].suffix).toBe('Ph.D.');
    expect(scanName('Cruz, Juan, Santos, Ph.D.').students[0].suffix).toBe('Ph.D.');
  });

  it('does not treat initials, given names, or substrings as embedded suffixes', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'First name', 'Middle name', 'Last name'],
      ['123456789012', 'Junior', 'V.', 'Del Villar'],
      ['111111111111', 'Juan J.', 'I.', 'Dela Cruzado'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Junior', middleName: 'V.', lastName: 'Del Villar' });
    expect(scan.students[1]).toMatchObject({ firstName: 'Juan J.', middleName: 'I.', lastName: 'Dela Cruzado' });
    scan.students.forEach(student => expect(student).not.toHaveProperty('suffix'));
  });

  it.each(['N/A', 'none', '', '—'])('omits an unavailable suffix (%s)', value => {
    const scan = scanStudentTable(table([
      ['LRN', 'First name', 'Last name', 'Suffix'], ['123456789012', 'Juan', 'Cruz', value],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).not.toHaveProperty('suffix');
  });

  it('blocks conflicting suffixes with the source row instead of choosing one', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'Name', 'Suffix'], ['123456789012', 'Cruz, Juan, Santos III', 'Jr.'],
    ]), options);
    expect(scan.students).toEqual([]);
    expect(scan.errors).toContainEqual(expect.objectContaining({ row: 2, message: expect.stringContaining('Conflicting name suffixes') }));
    expect(scanName('Cruz Jr., Juan, Santos III').errors[0].message).toContain('Conflicting name suffixes');
    expect(scanName('Cruz, Juan, Jr., Santos, III').errors[0].message).toContain('Conflicting name suffixes');
  });

  it('normalizes the composed name when separate name fields already exist', () => {
    const scan = scanStudentTable(table([
      ['LRN', 'Name', 'First name', 'Last name'], ['123456789012', 'Juan Dela Cruz III', 'Juan', 'Dela Cruz'],
    ]), options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ name: 'Juan Dela Cruz III', suffix: 'III' });
  });

  it.each(['xls', 'xlsx', 'csv'])('detects suffixes through %s parsing and normalized JSON reimport', bookType => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['LRN', 'Name'], ['123456789012', 'Dela Cruz, Juan, III, Santos'],
    ]), 'Students');
    const parsed = parseStudentFile(XLSX.write(workbook, { type: 'array', bookType: bookType as XLSX.BookType }));
    const scan = scanStudentTable(parsed.tables[0], options);
    expect(scan.errors).toEqual([]);
    expect(scan.students[0]).toMatchObject({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz', suffix: 'III' });
    const json = new TextEncoder().encode(JSON.stringify(scan.students)).buffer;
    const reimported = scanStudentTable(parseStudentFile(json).tables[0], options);
    expect(reimported.errors).toEqual([]);
    expect(reimported.students).toEqual(scan.students);
  });
});
