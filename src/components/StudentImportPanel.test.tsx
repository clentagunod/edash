import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../lib/student-import/types';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(), scan: vi.fn(), dispose: vi.fn(), inspect: vi.fn(), upload: vi.fn(), download: vi.fn(),
  years: vi.fn(), sections: vi.fn(), allowedSections: vi.fn(),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../lib/app-config', () => ({ APP_CONFIG: { schoolId: 'school-a', branding: { schoolName: 'School A' } } }));
vi.mock('../lib/firestore-api', () => ({
  fsGetSchoolYears: mocks.years,
  fsGetSections: mocks.sections,
}));
vi.mock('../lib/student-import/access', () => ({ studentImportSections: mocks.allowedSections }));
vi.mock('../lib/student-import/firestore-store', () => ({ studentImportStore: {} }));
vi.mock('../lib/student-import/worker-client', () => ({ StudentImportReader: class {
  parse = mocks.parse; scan = mocks.scan; dispose = mocks.dispose;
} }));
vi.mock('../lib/student-import/upload', () => ({ inspectStudentTargets: mocks.inspect, uploadStudents: mocks.upload }));
vi.mock('../lib/student-import/download', () => ({ downloadStudentJson: mocks.download, studentTemplate: () => [] }));

import StudentImportPanel from './StudentImportPanel';

const validScan: ScanResult = {
  headerRow: 5, headerEnd: 6, mappings: [{ column: 0, field: 'learnerId', label: 'LRN' }], ignored: ['Address'],
  students: [{ learnerId: '123456789012', firstName: 'Juan', lastName: 'Cruz', schoolYear: '2026-2027', gradeLevel: 'Grade 6', section: 'POMELO' }],
  sourceRows: [7], errors: [], warnings: [], skippedRows: 0,
};

describe('Import students review workflow', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.parse.mockResolvedValue({ sheets: ['Students'] });
    mocks.scan.mockResolvedValue(validScan);
    mocks.inspect.mockResolvedValue({ existing: 0, conflicts: [] });
    mocks.upload.mockResolvedValue({ created: 1, updated: 0, skipped: 0, processed: 1 });
    mocks.years.mockResolvedValue([{ schoolYear: '2026-2027', isCurrent: true }]);
    mocks.sections.mockResolvedValue([{ gradeLevel: 'Grade 6', section: 'POMELO' }, { gradeLevel: 'Grade 5', section: 'MANGO' }]);
    mocks.allowedSections.mockImplementation((_year, values) => values);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<StudentImportPanel authorized />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.includes(label))!;
  }
  async function selectFile() {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'dataset.data', size: 100, arrayBuffer: async () => new ArrayBuffer(10) }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  }
  async function scanFile() {
    await selectOption('Grade level', 'Grade 6');
    await selectOption('Section', 'POMELO');
    await selectFile();
    await act(async () => button('Scan and validate').click());
  }

  function select(label: string) {
    return [...container.querySelectorAll<HTMLSelectElement>('select')].find(element => element.parentElement?.textContent?.startsWith(label))!;
  }
  async function selectOption(label: string, value: string) {
    await act(async () => { const input = select(label); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  it('requires a configured grade/section and filters sections by the selected grade', async () => {
    await selectFile();
    expect(button('Scan and validate').disabled).toBe(true);
    expect(select('Section').disabled).toBe(true);
    await selectOption('Grade level', 'Grade 6');
    expect([...select('Section').options].map(option => option.value)).toEqual(['', 'POMELO']);
    await selectOption('Section', 'POMELO');
    await act(async () => button('Scan and validate').click());
    expect(mocks.scan).toHaveBeenCalledWith(0, expect.objectContaining({ gradeLevel: 'Grade 6', section: 'POMELO' }));
    await selectOption('Grade level', 'Grade 5');
    expect(select('Section').value).toBe('');
    expect([...select('Section').options].map(option => option.value)).toEqual(['', 'MANGO']);
    expect(button('Scan and validate').disabled).toBe(true);
    expect(container.textContent).not.toContain('Student preview');
  });

  it('keeps the reviewed data while navigating sections and collapsing advanced settings', async () => {
    const advanced = container.querySelector<HTMLDetailsElement>('.student-import-advanced')!;
    await scanFile();
    await act(async () => { advanced.open = true; advanced.dispatchEvent(new Event('toggle')); });
    await act(async () => { advanced.open = false; advanced.dispatchEvent(new Event('toggle')); });
    await act(async () => button('File & placement').click());
    expect(select('Grade level').value).toBe('Grade 6');
    expect(select('Section').value).toBe('POMELO');
    expect(document.activeElement?.id || document.activeElement?.getAttribute('aria-labelledby')).toBe('studentImportPlacementTitle');
    await act(async () => button('Confirm import').click());
    expect(container.textContent).toContain('Student preview');
    expect(button('Review and upload').disabled).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('requires final confirmation, supports cancel, then shows Done and JSON download', async () => {
    await scanFile();
    expect(container.textContent).toContain('rows 5–6');
    expect(mocks.upload).not.toHaveBeenCalled();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => button('Review and upload').click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('Grade 6 / POMELO');
    expect(mocks.upload).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => button('Review and upload').click());
    expect(mocks.upload).toHaveBeenCalledWith({}, '2026-2027', validScan.students, 'skip', expect.any(Function));
    expect(container.textContent).toContain('Done. 1 added');
    await act(async () => button('Download normalized JSON').click());
    expect(mocks.download).toHaveBeenCalledWith(validScan.students, 'school-a', '2026-2027');
  });

  it('blocks upload and JSON export when any row has validation errors', async () => {
    mocks.scan.mockResolvedValue({ ...validScan, errors: [{ row: 8, message: 'Invalid LRN' }] });
    await scanFile();
    expect(button('Review and upload').disabled).toBe(true);
    expect(button('Download normalized JSON').disabled).toBe(true);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Row 8: Invalid LRN');
  });

  it('blocks archived conflicts and invalidates the preview after option changes', async () => {
    mocks.inspect.mockResolvedValue({ existing: 0, conflicts: ['123456789012'] });
    await scanFile();
    expect(button('Review and upload').disabled).toBe(true);
    const select = [...container.querySelectorAll<HTMLSelectElement>('select')].find(element => element.parentElement?.textContent?.startsWith('Date order'))!;
    await act(async () => { select.value = 'dmy'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).not.toContain('Student preview');
    expect(container.textContent).toContain('Scan and validate again');
  });

  it('keeps upload and JSON download blocked when duplicate inspection fails', async () => {
    mocks.inspect.mockRejectedValue(new Error('Import access changed. Please try again.'));
    await scanFile();
    expect(button('Review and upload').disabled).toBe(true);
    expect(button('Download normalized JSON').disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Import access changed');
  });

  it('rejects school-bound JSON from another tenant', async () => {
    mocks.parse.mockResolvedValue({ sheets: ['Students'], schoolId: 'other-school' });
    await selectFile();
    expect(container.textContent).toContain('different school');
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('keeps dataset labels as text in the preview', async () => {
    mocks.scan.mockResolvedValue({ ...validScan, ignored: ['<img src=x onerror=alert(1)>'], mappings: [{ column: 0, field: 'learnerId', label: '<script>evil()</script>' }] });
    await scanFile();
    expect(container.querySelector('script,img')).toBeNull();
    expect(container.textContent).toContain('<script>evil()</script>');
  });

  it('rejects JSON year metadata that differs from the selected year', async () => {
    mocks.parse.mockResolvedValue({ sheets: ['Students'], schoolId: 'school-a', schoolYear: '2025-2026' });
    await scanFile();
    expect(container.textContent).toContain('This JSON specifies school year 2025-2026');
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('does not read setup or expose data without import permission', async () => {
    await act(async () => root.unmount());
    mocks.years.mockClear(); mocks.sections.mockClear();
    root = createRoot(container);
    await act(async () => root.render(<StudentImportPanel authorized={false} />));
    expect(mocks.years).not.toHaveBeenCalled(); expect(mocks.sections).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('access is unavailable');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('removes the prepared preview when import permission is revoked', async () => {
    await scanFile();
    expect(button('Review and upload').disabled).toBe(false);
    await act(async () => root.render(<StudentImportPanel authorized={false} />));
    expect(container.textContent).not.toContain('Student preview');
    expect(container.querySelector('button')).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it('uses the masterlist year and only exposes available teacher sections', async () => {
    await act(async () => root.unmount());
    mocks.years.mockResolvedValue([{ schoolYear: '2026-2027', isCurrent: true }, { schoolYear: '2025-2026' }]);
    mocks.allowedSections.mockImplementation((_year, values) => values.filter(value => value.gradeLevel === 'Grade 6'));
    root = createRoot(container);
    await act(async () => root.render(<StudentImportPanel authorized initialYear="2025-2026" />));
    expect(select('School year').value).toBe('2025-2026');
    expect([...select('Grade level').options].map(option => option.value)).toEqual(['', 'Grade 6']);
    await selectOption('Grade level', 'Grade 6');
    expect([...select('Section').options].map(option => option.value)).toEqual(['', 'POMELO']);
  });

  it('explains when no assigned or configured sections are available', async () => {
    mocks.allowedSections.mockReturnValue([]);
    await act(async () => select('School year').dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => root.render(<StudentImportPanel authorized={false} />));
    await act(async () => root.render(<StudentImportPanel authorized />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No available sections');
    expect(button('Choose file').disabled).toBe(true);
  });

  it('notifies the dialog while busy and refreshes the masterlist after successful upload', async () => {
    const onBusyChange = vi.fn(), onComplete = vi.fn();
    await act(async () => root.render(<StudentImportPanel authorized onBusyChange={onBusyChange} onComplete={onComplete} />));
    await scanFile();
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onComplete).not.toHaveBeenCalled();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Review and upload').click());
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the dialog busy after access revocation until the active upload settles', async () => {
    const onBusyChange = vi.fn(), onComplete = vi.fn();
    let finish: (summary: { created: number; updated: number; skipped: number; processed: number }) => void;
    mocks.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<StudentImportPanel authorized onBusyChange={onBusyChange} onComplete={onComplete} />));
    await scanFile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Review and upload').click());
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(<StudentImportPanel authorized={false} onBusyChange={onBusyChange} onComplete={onComplete} />));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain('Finishing the active upload');
    await act(async () => finish!({ created: 1, updated: 0, skipped: 0, processed: 1 }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Finishing the active upload');
  });

  it('ignores a stale parse result after access is revoked and restored', async () => {
    let finish: (value: { sheets: string[] }) => void;
    mocks.parse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await selectFile();
    await act(async () => root.render(<StudentImportPanel authorized={false} />));
    await act(async () => root.render(<StudentImportPanel authorized />));
    await act(async () => finish!({ sheets: ['Stale worksheet'] }));
    expect(container.textContent).not.toContain('Stale worksheet');
    expect(container.querySelector('select[aria-label="Worksheet"]')).toBeNull();
  });

  it('releases the dialog busy state if an active upload fails after revocation', async () => {
    const onBusyChange = vi.fn(), onComplete = vi.fn();
    let fail: (error: Error) => void;
    mocks.upload.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    await act(async () => root.render(<StudentImportPanel authorized onBusyChange={onBusyChange} onComplete={onComplete} />));
    await scanFile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Review and upload').click());
    await act(async () => root.render(<StudentImportPanel authorized={false} onBusyChange={onBusyChange} onComplete={onComplete} />));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => fail!(new Error('Import permission revoked.')));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
