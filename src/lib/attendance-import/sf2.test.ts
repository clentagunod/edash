import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { matchSf2Rows, readSf2Workbook, scanSf2Sheet, type AttendanceTarget, type Sf2Sheet, type Sf2ScanOptions } from './sf2';

const options: Sf2ScanOptions = { month: 'auto', schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'MELON' };
function fixture(): Sf2Sheet {
  const rows: unknown[][] = Array.from({ length: 120 }, () => []);
  rows[1][0] = 'School Form 2 (SF2) Daily Attendance Report of Learners';
  rows[5][1] = 'School ID'; rows[5][6] = 123456;
  rows[5][12] = 'School Year'; rows[5][13] = '2026-2027';
  rows[5][19] = 'Report for the  Month of'; rows[5][26] = 'OCTOBER';
  rows[6][22] = 'Grade Level'; rows[6][26] = 2;
  rows[6][28] = 'Section'; rows[6][31] = 'MELON';
  rows[8][0] = "LEARNER'S NAME (Last Name, First Name, Middle Name)";
  rows[8][6] = '(1st row for date, 2nd row for Day: M,T,W,TH,F)';
  rows[8][40] = 'No of School Days:'; rows[8][42] = 22;
  rows[10][31] = 'ABSENT'; rows[10][32] = 'PRESENT';
  rows[12][0] = 1; rows[12][1] = 'CRUZ, ANA MARIA'; rows[12][31] = 0.5; rows[12][32] = 21.5;
  rows[13][0] = 2; rows[13][1] = 'SANTOS, BEN JR. REYES'; rows[13][31] = 0; rows[13][32] = 22;
  rows[14][0] = 3; rows[14][31] = ''; rows[14][32] = '';
  rows[15][0] = 2; rows[15][1] = 'MALE | TOTAL Per Day'; rows[15][31] = 0.5; rows[15][32] = 43.5;
  rows[16][0] = 1; rows[16][1] = 'GARCIA, CARA'; rows[16][31] = 22; rows[16][32] = 0;
  rows[17][0] = 1; rows[17][1] = 'FEMALE | TOTAL Per Day'; rows[17][31] = 22; rows[17][32] = 0;
  rows[18][0] = 3; rows[18][1] = 'Combined TOTAL PER DAY'; rows[18][31] = 22.5; rows[18][32] = 43.5;
  rows[19][0] = 'GUIDELINES:';
  rows[20][1] = 'Average daily attendance';
  return { name: 'OCTOBER', rows };
}
const learners: AttendanceTarget[] = [
  { learnerId: '000000000001', firstName: 'Ana', middleName: 'Maria', lastName: 'Cruz', gradeLevel: 'Grade 2', section: 'MELON', attendance: { daysPresent: { Sep: '21' } }, expectedIdentity: { firstName: 'Ana', lastName: 'Cruz', gradeLevel: 'Grade 2', section: 'MELON' } },
  { learnerId: '000000000002', firstName: 'Ben', middleName: 'Reyes', lastName: 'Santos', suffix: 'Jr.', gradeLevel: 'Grade 2', section: 'MELON' },
  { learnerId: '000000000003', firstName: 'Cara', lastName: 'Garcia', gradeLevel: 'Grade 2', section: 'MELON' },
];
function workbook(sheet = fixture(), mutate?: (worksheet: XLSX.WorkSheet, book: XLSX.WorkBook) => void): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
  XLSX.utils.book_append_sheet(book, worksheet, sheet.name);
  mutate?.(worksheet, book);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('SF2 Excel reading and validation', () => {
  it('reads the sample layout with merged-style headers, skips template/subtotal rows, and preserves half days and zero', () => {
    const parsed = readSf2Workbook(workbook());
    const report = scanSf2Sheet(parsed.sheets[0], options);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report).toMatchObject({ month: 'Oct', detectedSchoolYear: '2026-2027', detectedGrade: 'Grade 2', detectedSection: 'MELON' });
    expect(report.rows).toHaveLength(3);
    expect(report.rows[0]).toMatchObject({ rowNumber: 13, daysAbsent: '0.5', daysPresent: '21.5', classDays: '22' });
    expect(report.rows[1]).toMatchObject({ daysAbsent: '0', daysPresent: '22' });
    expect(report.rows[2]).toMatchObject({ daysPresent: '0', daysAbsent: '22' });
  });

  it('detects a month below its label and falls back to a labelled worksheet when needed', () => {
    const sheet = fixture();
    sheet.name = 'Attendance'; sheet.rows[5][26] = ''; sheet.rows[7][19] = 'July';
    expect(scanSf2Sheet(sheet, options).month).toBe('Jul');
    sheet.rows[5][19] = ''; sheet.rows[7][19] = ''; sheet.name = 'SF2 AUGUST';
    expect(scanSf2Sheet(sheet, options).month).toBe('Aug');
    sheet.name = 'Attendance';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('month could not be detected');
    expect(scanSf2Sheet(sheet, { ...options, month: 'Jul' }).month).toBe('Jul');
  });

  it('makes an explicit month override visible and rejects conflicting report metadata', () => {
    const sheet = fixture();
    expect(scanSf2Sheet(sheet, { ...options, month: 'Aug' }).warnings.join(' ')).toContain('saved to Aug');
    sheet.rows[3][0] = 'Report for the Month of'; sheet.rows[3][1] = 'July';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('conflicting month');
    expect(scanSf2Sheet(fixture(), { ...options, schoolYear: '2025-2026', gradeLevel: 'Grade 3', section: 'APPLE', schoolId: '654321' }).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('school year'), expect.stringContaining('grade'), expect.stringContaining('section'), expect.stringContaining('School ID'),
    ]));
  });

  it.each(['', -1, 'N/A', true, Infinity, '1e2'])('rejects missing or invalid monthly counts (%s)', value => {
    const sheet = fixture(); sheet.rows[12][31] = value;
    const report = scanSf2Sheet(sheet, options);
    expect(report.errors.join(' ')).toContain('non-negative saved numbers');
    expect(report.rows).toHaveLength(2);
  });

  it('calculates decimal totals exactly, bounds class days and checks the declared school-day count', () => {
    const sheet = fixture(); sheet.rows[12][31] = '0.1'; sheet.rows[12][32] = '0.2';
    expect(scanSf2Sheet(sheet, options).rows[0].classDays).toBe('0.3');
    expect(scanSf2Sheet(sheet, options).warnings.join(' ')).toContain('totals 0.3 days');
    sheet.rows[12][31] = 1; sheet.rows[12][32] = 31;
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('exceeds 31 days');
    sheet.rows[12][32] = 22;
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain("report's 22 school days");
  });

  it('rejects wrong formats, duplicate learners, and rows with totals but no name', () => {
    const sheet = fixture(); sheet.rows[13][1] = sheet.rows[12][1]; sheet.rows[16][1] = '';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('duplicate learner');
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('no learner name');
    sheet.rows[1][0] = 'School Form 1';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('not a School Form 2');
    sheet.rows[10][31] = '';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('total columns could not be found');
  });

  it('blocks Excel errors and formulas without saved values in attendance columns', () => {
    const parsed = readSf2Workbook(workbook(fixture(), worksheet => {
      worksheet.AF13 = { t: 'n', f: 'SUM(A1:A2)' };
      worksheet.AG14 = { t: 'e', v: 7 };
    }));
    const report = scanSf2Sheet(parsed.sheets[0], options);
    expect(report.errors.join(' ')).toContain('Recalculate');
    expect(report.errors.join(' ')).toContain('Spreadsheet error');
  });

  it('rejects non-Excel files and bounds bytes, worksheet dimensions and worksheet count', () => {
    expect(() => readSf2Workbook(new ArrayBuffer(0))).toThrow('empty');
    expect(() => readSf2Workbook(new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow('10 MB');
    expect(() => readSf2Workbook(new TextEncoder().encode('name,absent,present').buffer)).toThrow('Excel');
    expect(() => readSf2Workbook(workbook(fixture(), sheet => { sheet['!ref'] = 'A1:A20001'; }))).toThrow('20,000');
    expect(() => readSf2Workbook(workbook(fixture(), (_sheet, book) => {
      for (let i = 1; i <= 30; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['empty']]), `Sheet ${i}`);
    }))).toThrow('1–30');
  });
});

describe('SF2 masterlist identity matching', () => {
  it('matches surname-first names and suffix placements and carries snapshots without modifying attendance', () => {
    const report = scanSf2Sheet(fixture(), options);
    const review = matchSf2Rows(report, learners);
    expect(review.errors).toEqual([]);
    expect(review.entries.map(entry => entry.learnerId)).toEqual(learners.map(learner => learner.learnerId));
    expect(review.entries[0].expectedAttendance).toBe(learners[0].attendance);
    expect(review.entries[0].expectedIdentity).toEqual(learners[0].expectedIdentity);
    expect(review.unmatchedMasterlist).toEqual([]);
  });

  it('normalizes case, punctuation, diacritics and middle initials without fuzzy spelling matches', () => {
    const sheet = fixture(); sheet.rows[12][1] = 'crúz, Ana M.';
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors).toEqual([]);
    sheet.rows[12][1] = 'CRUZ, ANNA M.';
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors.join(' ')).toContain('no matching learner');
    sheet.rows[12][1] = 'CRUZ, ANA';
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors.join(' ')).toContain('no matching learner');
  });

  it('blocks duplicate and ambiguous matches and lists omitted masterlist learners as untouched', () => {
    const sheet = fixture(); sheet.rows[12][1] = 'CRUZ, ANA M.';
    const duplicate = { ...learners[0], learnerId: '000000000004', middleName: 'Mae' };
    const review = matchSf2Rows(scanSf2Sheet(sheet, options), [...learners, duplicate]);
    expect(review.errors.join(' ')).toContain('ambiguous match');
    expect(review.unmatchedMasterlist).toHaveLength(2);
    expect(review.warnings.join(' ')).toContain('remain unchanged');
    sheet.rows[13][1] = 'ANA MARIA CRUZ';
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors.join(' ')).toContain('occurs more than once');
  });

  it('uses an explicit LRN only when the identity agrees and reports invalid LRNs', () => {
    const sheet = fixture(); sheet.rows[8][3] = 'LRN'; sheet.rows[12][3] = learners[0].learnerId;
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors).toEqual([]);
    sheet.rows[12][3] = learners[1].learnerId;
    expect(matchSf2Rows(scanSf2Sheet(sheet, options), learners).errors.join(' ')).toContain('name does not match');
    sheet.rows[12][3] = '123';
    expect(scanSf2Sheet(sheet, options).errors.join(' ')).toContain('exactly 12 digits');
  });
});
