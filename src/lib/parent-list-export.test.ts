import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { read, utils } from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import { buildParentList } from './parent-list';

vi.mock('./app-config', () => ({ appSchoolFilePrefix: () => 'school' }));
import { createParentListWorkbook, downloadParentList } from './parent-list-export';

const parents = () => buildParentList([
  { learnerId: '001234567890', guardian: '=SUM(1,2)', firstName: 'Ella', lastName: 'Cruz', contact: '09123456789', gradeLevel: 'Grade 1', section: 'Ruby' },
  { learnerId: '001234567891', guardian: '=SUM(1,2)', firstName: 'Luis', lastName: 'Cruz', contact: '09987654321', gradeLevel: 'Grade 3', section: 'Crystal' },
  { learnerId: '001234567892', guardian: 'Maria Diaz', firstName: 'Ana', lastName: 'Diaz', gradeLevel: 'Kinder', section: 'Gold' },
]);

describe('parent list Excel export', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('round-trips numbered parent groups, learner details and text values without formulas', async () => {
    const bytes = await createParentListWorkbook(parents(), '2026-2027');
    const workbook = read(bytes, { type: 'array' });
    const sheet = workbook.Sheets['Parents and Learners'];
    expect(utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ['No.', 'Parent / Guardian', 'Learner Name', 'Learner ID', 'Grade Level', 'Section', 'Contact Number', 'School Year'],
      [1, '=SUM(1,2)', 'Cruz, Ella', '001234567890', 'Grade 1', 'Ruby', '09123456789', '2026-2027'],
      ['', '', 'Cruz, Luis', '001234567891', 'Grade 3', 'Crystal', '09987654321', '2026-2027'],
      [2, 'Maria Diaz', 'Diaz, Ana', '001234567892', 'Kinder', 'Gold', 'N/A', '2026-2027'],
    ]);
    expect(sheet['!merges']).toEqual([
      { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
      { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    ]);
    expect(sheet.B2).toMatchObject({ t: 's', v: '=SUM(1,2)' });
    expect(sheet.B2.f).toBeUndefined();
    expect(sheet.D2).toMatchObject({ t: 's', v: '001234567890' });
    expect(sheet.G2).toMatchObject({ t: 's', v: '09123456789' });
    expect(sheet['!autofilter']).toEqual({ ref: 'A1:H4' });
  });

  it('saves yellow headers, peach bordered rows, readable sizing and a frozen header in the file', async () => {
    const files = unzipSync(await createParentListWorkbook(parents(), '2026-2027'));
    const styles = new DOMParser().parseFromString(strFromU8(files['xl/styles.xml']), 'application/xml');
    const worksheet = new DOMParser().parseFromString(strFromU8(files['xl/worksheets/sheet1.xml']), 'application/xml');
    expect(styles.querySelector('parsererror')).toBeNull();
    expect(worksheet.querySelector('parsererror')).toBeNull();
    const formats = [...styles.querySelectorAll('cellXfs > xf')];
    const fills = [...styles.querySelectorAll('fills > fill')];
    const borders = [...styles.querySelectorAll('borders > border')];
    const savedStyle = (reference: string) => formats[Number(worksheet.querySelector(`c[r="${reference}"]`)!.getAttribute('s'))];
    const header = savedStyle('A1');
    const body = savedStyle('C3');
    expect(fills[Number(header.getAttribute('fillId'))].querySelector('fgColor')?.getAttribute('rgb')).toBe('FFFFFF00');
    expect(fills[Number(body.getAttribute('fillId'))].querySelector('fgColor')?.getAttribute('rgb')).toBe('FFFCE9D9');
    expect([...borders[Number(body.getAttribute('borderId'))].children].filter(side => side.tagName !== 'diagonal').every(side => side.getAttribute('style') === 'thin')).toBe(true);
    expect(body.querySelector('alignment')?.getAttribute('vertical')).toBe('center');
    expect(body.querySelector('alignment')?.getAttribute('wrapText')).toBe('1');
    expect(savedStyle('A2').querySelector('alignment')?.getAttribute('horizontal')).toBe('center');
    expect(worksheet.querySelector('pane')?.getAttribute('state')).toBe('frozen');
    expect(worksheet.querySelector('pane')?.getAttribute('ySplit')).toBe('1');
    expect(worksheet.querySelector('pane')?.getAttribute('topLeftCell')).toBe('A2');
    expect(worksheet.querySelectorAll('cols > col')).toHaveLength(8);
    expect(Number(worksheet.querySelector('row[r="1"]')?.getAttribute('ht'))).toBeGreaterThanOrEqual(24);
  });

  it('downloads only an .xlsx file and releases the temporary URL', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:parent-list');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('school-parents-2026-2027.xlsx');
      expect(this.href).toBe('blob:parent-list');
    });
    await downloadParentList(parents(), '2026-2027');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:parent-list');
  });
});
