import * as XLSX from 'xlsx';
import { IMPORT_LIMITS, type Cell, type FileKind, type ParsedFile, type Table } from './types';

function jsonTable(text: string): ParsedFile {
  let input: unknown;
  try { input = JSON.parse(text); }
  catch {
    try { input = text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch { throw new Error('Invalid JSON. Supply a labelled array of student objects or an array of header/data rows.'); }
  }
  const envelope = input && !Array.isArray(input) && typeof input === 'object' ? input as Record<string, unknown> : null;
  if (envelope?.format === 'edash-tenant-firestore-backup') {
    throw new Error('This is a tenant backup. Use Import JSON in Tenant database backup to restore it.');
  }
  const records = envelope ? (envelope.students ?? envelope.learners ?? envelope.records ?? envelope.data) : input;
  if (!Array.isArray(records) || !records.length) throw new Error('No student rows found in JSON. Use the JSON template as a guide.');
  if (records.length > IMPORT_LIMITS.rows) throw new Error('Too many rows. Split the dataset into files of at most 20,000 rows.');
  let rows: Cell[][];
  if (records.every(Array.isArray)) rows = records as Cell[][];
  else {
    if (!records.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
      throw new Error('Every JSON row must be a labelled object, or every row must be an array.');
    }
    const labels = [...new Set(records.flatMap(row => Object.keys(row)))];
    if (labels.length > IMPORT_LIMITS.columns) throw new Error('Too many columns (maximum 256).');
    rows = [labels, ...records.map(row => labels.map(label => row[label] ?? null))];
  }
  if (rows.some(row => row.length > IMPORT_LIMITS.columns)) throw new Error('Too many columns (maximum 256).');
  return {
    schoolId: typeof envelope?.schoolId === 'string' ? envelope.schoolId : undefined,
    schoolYear: typeof envelope?.schoolYear === 'string' ? envelope.schoolYear : undefined,
    tables: [{ name: 'Students', rows, merges: [], errors: [], date1904: false }],
  };
}

/** Parse file content rather than trusting its extension. No macros or formulas execute. */
export function parseStudentFile(buffer: ArrayBuffer, kind: FileKind = 'auto'): ParsedFile {
  if (!buffer.byteLength) throw new Error('The selected file is empty.');
  if (buffer.byteLength > IMPORT_LIMITS.bytes) throw new Error('Maximum file size is 10 MB. Split larger datasets before importing.');
  const bytes = new Uint8Array(buffer);
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  if (kind === 'json' || (kind === 'auto' && /^[\[{]/.test(prefix))) {
    return jsonTable(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''));
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array', cellDates: false, cellFormula: true, raw: true,
      sheetRows: IMPORT_LIMITS.rows + 1, cellHTML: false, bookVBA: false,
    });
  } catch {
    throw new Error('Unable to read this dataset. Use an unencrypted Excel/ODS workbook, JSON, CSV, TSV, HTML table, or Spreadsheet XML file.');
  }
  if (workbook.SheetNames.length > IMPORT_LIMITS.sheets) throw new Error('Too many worksheets (maximum 30). Export only the sheets you need.');
  const tables = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r >= IMPORT_LIMITS.rows || range.e.c >= IMPORT_LIMITS.columns) {
      throw new Error(`Worksheet "${name}" exceeds 20,000 rows or 256 columns. Remove unused formatted rows/columns or split it.`);
    }
    // Preserve absolute row/column numbers, including empty rows before the header.
    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: null, raw: true, range: 0 });
    const errors: Table['errors'] = [];
    Object.keys(sheet).filter(key => !key.startsWith('!')).forEach(address => {
      const cell = sheet[address];
      if (cell.t === 'e' || (cell.f && cell.v == null)) {
        const { r, c } = XLSX.utils.decode_cell(address);
        errors.push({ row: r + 1, column: c, message: cell.t === 'e' ? `Spreadsheet error at ${address}.` : `Formula at ${address} has no saved value. Recalculate and save the workbook.` });
      }
    });
    return { name, rows, merges: sheet['!merges'] || [], errors, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
  });
  if (!tables.length) throw new Error('No tables found.');
  return { tables };
}
