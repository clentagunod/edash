import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: () => '2026-2027', initYearSwitcher: vi.fn() }));
vi.mock('./app-config', () => ({ APP_CONFIG: { branding: { schoolName: 'Example School' } }, appSchoolFilePrefix: () => 'example-school', isTeacher: () => false }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  formatAppDate: () => '', renderShell: vi.fn(), showToast: vi.fn(),
}));
import { buildCsv, buildExcel, exportColumns, exportValue } from './data';

describe('Data exports', () => {
  const records = [
    { learnerId: '001234567890', firstName: 'Alex', schoolYear: '2026-2027', anecdotalRecords: 'No recorded violations.' },
    { learnerId: '001234567891', firstName: 'Taylor', extra: { localNote: 'Example', schoolYear: '' } },
    { learnerId: '001234567892', schoolYear: '   ' },
    { learnerId: '001234567893', schoolYear: null },
  ];

  it('fills every Excel school-year cell, keeps it last, and leaves source records untouched', () => {
    const before = JSON.stringify(records);
    const doc = new DOMParser().parseFromString(buildExcel(records, '2026-2027'), 'text/html');
    const headers = [...doc.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headers.at(-1)).toBe('School Year');
    expect(headers.filter((header) => header === 'School Year')).toHaveLength(1);
    expect([...doc.querySelectorAll('tbody tr')].map((row) => row.lastElementChild?.textContent)).toEqual(records.map(() => '2026-2027'));
    expect(doc.body.textContent).toContain('No recorded violations.');
    expect(JSON.stringify(records)).toBe(before);
  });

  it('uses the same fallback for CSV and archives without replacing a stored year', () => {
    const csv = buildCsv(records, '2026-2027');
    const workbook = XLSX.read(csv, { type: 'string', raw: true });
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(rows[0].at(-1)).toBe('School Year');
    expect(rows.slice(1).map((row) => row.at(-1))).toEqual(records.map(() => '2026-2027'));
    expect(exportValue({ schoolYear: '2025-2026' }, 'schoolYear', '2026-2027')).toBe('2025-2026');
    expect(exportValue({ extra: { schoolYear: '2025-2026' } }, 'schoolYear', '2026-2027')).toBe('2025-2026');
    expect(exportColumns(records).filter(([key]) => key === 'anecdotalRecords')).toHaveLength(1);
  });

  it('preserves structured teacher comments and attendance in CSV and Excel exports', () => {
    const record = { learnerId: '001234567890', teacherComments: ['Progress, with support', 'Reads\nevery day', '<Ready>'], attendance: { daysPresent: { Aug: '20.25' }, daysAbsent: { Aug: '0.75' }, classDays: { Aug: '21' } }, documentStatus: 'Transmitted', documentStatusDates: { Transmitted: '2026-10-30' }, sf10Email: { messageId: 'confirmed-id', sentAt: '2026-10-31T17:05:00.000Z', to: ['records@example.edu'], cc: [], bcc: [] } };
    const workbook = XLSX.read(buildCsv([record], '2026-2027'), { type: 'string', raw: true });
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(JSON.parse(rows[1][rows[0].indexOf('Teacher Comments')])).toEqual(record.teacherComments);
    expect(JSON.parse(rows[1][rows[0].indexOf('Attendance')])).toEqual(record.attendance);
    expect(JSON.parse(rows[1][rows[0].indexOf('Document Status Dates')])).toEqual(record.documentStatusDates);
    expect(JSON.parse(rows[1][rows[0].indexOf('SF10 Email')])).toEqual(record.sf10Email);
    const doc = new DOMParser().parseFromString(buildExcel([record], '2026-2027'), 'text/html');
    const headers = [...doc.querySelectorAll('th')].map((cell) => cell.textContent);
    const cells = [...doc.querySelectorAll('tbody td')];
    expect(JSON.parse(cells[headers.indexOf('Teacher Comments')].textContent!)).toEqual(record.teacherComments);
    expect(JSON.parse(cells[headers.indexOf('Attendance')].textContent!)).toEqual(record.attendance);
    expect(JSON.parse(cells[headers.indexOf('Document Status Dates')].textContent!)).toEqual(record.documentStatusDates);
    expect(JSON.parse(cells[headers.indexOf('SF10 Email')].textContent!)).toEqual(record.sf10Email);
    expect(doc.querySelector('ready')).toBeNull();
  });
});
