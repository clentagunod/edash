import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utils } from 'xlsx';
import { buildParentList } from './parent-list';

const mocks = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock('./app-config', () => ({ appSchoolFilePrefix: () => 'school' }));
vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: mocks.writeFile }));
import { downloadParentList } from './parent-list-export';

describe('parent list downloads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a real Excel workbook with text LRNs and contacts and no executable formulas', async () => {
    const parents = buildParentList([
      { learnerId: '001234567890', guardian: '=SUM(1,2)', firstName: 'Ella', lastName: 'Cruz', contact: '09123456789', gradeLevel: 'Grade 1', section: 'Ruby' },
    ]);
    await downloadParentList(parents, '2026-2027', 'xlsx');
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    const [workbook, filename] = mocks.writeFile.mock.calls[0];
    expect(filename).toBe('school-parents-2026-2027.xlsx');
    const sheet = workbook.Sheets['Parents and Learners'];
    expect(sheet.A2).toMatchObject({ t: 's', v: '=SUM(1,2)' });
    expect(sheet.A2.f).toBeUndefined();
    expect(sheet.C2).toMatchObject({ t: 's', v: '001234567890' });
    expect(sheet.F2).toMatchObject({ t: 's', v: '09123456789' });
    expect(utils.sheet_to_json(sheet)).toEqual([expect.objectContaining({ 'Parent / Guardian': '=SUM(1,2)', 'Learner ID': '001234567890' })]);
  });
});
