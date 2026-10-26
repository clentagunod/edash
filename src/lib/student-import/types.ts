export type Cell = string | number | boolean | null;
export type StudentRecord = Record<string, string | number | boolean>;
export interface Table {
  name: string;
  rows: Cell[][];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  errors: { row: number; column: number; message: string }[];
  date1904: boolean;
}
export type FileKind = 'auto' | 'json' | 'text' | 'spreadsheet';
export interface ParsedFile { tables: Table[]; schoolId?: string; schoolYear?: string }
export interface ImportOptions {
  schoolYear: string;
  gradeLevel: string;
  section: string;
  dateOrder: 'mdy' | 'dmy';
  headerRows: number; // 0 detects the header depth from merged ranges.
  sections: { gradeLevel: string; section: string }[];
  today?: string;
}
export interface Mapping { column: number; label: string; field: string }
export interface ImportIssue { row: number; message: string }
export interface ScanResult {
  headerRow: number;
  headerEnd: number;
  mappings: Mapping[];
  ignored: string[];
  students: StudentRecord[];
  sourceRows: number[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  skippedRows: number;
}
export const IMPORT_LIMITS = { bytes: 10 * 1024 * 1024, rows: 20000, columns: 256, sheets: 30, milliseconds: 45000 };
