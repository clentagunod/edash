import { appSchoolFilePrefix } from './app-config';
import { parentDelimitedFile, parentExportRows, type ParentEntry, type ParentExportFormat } from './parent-list';

export async function downloadParentList(parents: ParentEntry[], schoolYear: string, format: ParentExportFormat): Promise<void> {
  const rows = parentExportRows(parents, schoolYear);
  const filename = `${appSchoolFilePrefix()}-parents-${schoolYear || 'current'}.${format}`;
  if (format === 'xlsx') {
    const { utils, writeFile } = await import('xlsx');
    // aoa_to_sheet stores string cells as text, preserving LRNs and leading zeroes.
    const sheet = utils.aoa_to_sheet(rows);
    sheet['!cols'] = [30, 38, 20, 16, 20, 22, 18].map(wch => ({ wch }));
    sheet['!autofilter'] = { ref: sheet['!ref']! };
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, 'Parents and Learners');
    writeFile(workbook, filename);
    return;
  }
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  const url = URL.createObjectURL(new Blob([parentDelimitedFile(rows, format === 'csv' ? ',' : '\t')], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
