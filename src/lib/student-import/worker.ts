import { parseStudentFile } from './parser';
import { scanStudentTable } from './normalize';
import type { FileKind, ImportOptions, ParsedFile } from './types';

let parsed: ParsedFile | null = null;
self.onmessage = (event: MessageEvent<{ id: number; action: 'parse' | 'scan'; buffer?: ArrayBuffer; kind?: FileKind; sheet?: number; options?: ImportOptions }>) => {
  const { id, action } = event.data;
  try {
    if (action === 'parse') {
      parsed = null;
      parsed = parseStudentFile(event.data.buffer!, event.data.kind);
      self.postMessage({ id, value: { sheets: parsed.tables.map(table => table.name), schoolId: parsed.schoolId, schoolYear: parsed.schoolYear } });
    } else {
      const table = parsed?.tables[event.data.sheet ?? 0];
      if (!table) throw new Error('Choose a dataset first.');
      self.postMessage({ id, value: scanStudentTable(table, event.data.options!) });
    }
  } catch (error) { self.postMessage({ id, error: (error as Error).message }); }
};
