import type { StudentRecord } from './types';
import { GUARDIAN_CONTACT_FIELDS, isUnavailableContact } from './schema';

export type DuplicateMode = 'skip' | 'merge';
export interface ImportProgress { created: number; updated: number; skipped: number; processed: number }
export interface StudentSnapshot { exists: boolean; data(): Record<string, unknown> | undefined }
export interface StudentImportStore {
  authorize(): Promise<void>;
  read(year: string, collection: string, id: string): Promise<StudentSnapshot>;
  transaction<T>(callback: (transaction: {
    read(collection: string, id: string): Promise<StudentSnapshot>;
    write(id: string, data: StudentRecord, merge: boolean): void;
  }) => Promise<T>, year: string): Promise<T>;
  refresh(year: string): void;
}

function archived(data: Record<string, unknown> | undefined) {
  return data?.transferOut === true || ['TRANSFERRED_OUT', 'DROPPED_OUT'].includes(String(data?.enrollmentStatus || '')) || data?.eosyStatus === 'Dropped Out';
}

export async function inspectStudentTargets(store: StudentImportStore, year: string, students: StudentRecord[], onProgress: (count: number) => void = () => {}) {
  await store.authorize();
  let existing = 0;
  const conflicts: string[] = [];
  // Bound concurrent Firestore requests for larger files.
  for (let offset = 0; offset < students.length; offset += 20) {
    await Promise.all(students.slice(offset, offset + 20).map(async student => {
      const id = String(student.learnerId);
      const snapshots = await Promise.all(['learners', 'dropouts', 'transferredOut'].map(collection => store.read(year, collection, id)));
      if (snapshots[0].exists) existing++;
      if (snapshots[1].exists || snapshots[2].exists || archived(snapshots[0].data())) conflicts.push(id);
    }));
    onProgress(Math.min(offset + 20, students.length));
  }
  return { existing, conflicts };
}

export class StudentUploadError extends Error {
  constructor(message: string, public progress: ImportProgress) { super(message); this.name = 'StudentUploadError'; }
}

/** Transactions protect against a matching LRN being created after the preview. */
export async function uploadStudents(
  store: StudentImportStore, year: string, students: StudentRecord[], mode: DuplicateMode,
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<ImportProgress> {
  const progress: ImportProgress = { created: 0, updated: 0, skipped: 0, processed: 0 };
  if (!students.length) throw new Error('There are no validated students to upload.');
  if (!/^\d{4}-\d{4}$/.test(year) || students.some(student => !/^\d{12}$/.test(String(student.learnerId)) || student.schoolYear !== year)) {
    throw new Error('Student identifiers or school years are invalid. Scan the file again.');
  }
  await store.authorize();
  try {
    for (let offset = 0; offset < students.length; offset += 25) {
      const chunk = students.slice(offset, offset + 25);
      const committed = await store.transaction(async transaction => {
        const decisions = await Promise.all(chunk.map(async student => {
          const id = String(student.learnerId);
          const [current, dropout, transferred] = await Promise.all(['learners', 'dropouts', 'transferredOut'].map(collection => transaction.read(collection, id)));
          if (dropout.exists || transferred.exists || archived(current.data())) {
            throw new Error(`LRN ${id} has an archived/transfer record. Resolve it in the Masterlist before importing.`);
          }
          return { student, current };
        }));
        const counts = { created: 0, updated: 0, skipped: 0 };
        // All reads precede writes, as required by Firestore transactions.
        for (const { student, current } of decisions) {
          if (current.exists && mode === 'skip') { counts.skipped++; continue; }
          const data: StudentRecord = current.exists ? { ...student } : { enrollmentStatus: 'ACTIVE', ...student };
          for (const field of GUARDIAN_CONTACT_FIELDS) {
            if (!isUnavailableContact(data[field])) continue;
            // A placeholder fills missing details without erasing known values.
            if (current.exists && !isUnavailableContact(current.data()?.[field])) delete data[field];
            else data[field] = 'N/A';
          }
          transaction.write(String(student.learnerId), data, current.exists);
          counts[current.exists ? 'updated' : 'created']++;
        }
        return counts;
      }, year);
      progress.created += committed.created;
      progress.updated += committed.updated;
      progress.skipped += committed.skipped;
      progress.processed += chunk.length;
      onProgress({ ...progress });
    }
    return progress;
  } catch (error) {
    throw new StudentUploadError(
      `${(error as Error).message} ${progress.created + progress.updated} records saved before the interruption; ${students.length - progress.processed} rows remain. Scan again before retrying.`,
      { ...progress },
    );
  } finally {
    if (progress.created || progress.updated) store.refresh(year);
  }
}
