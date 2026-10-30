import { describe, expect, it, vi } from 'vitest';
import { inspectStudentTargets, StudentUploadError, uploadStudents, type StudentImportStore } from './upload';
import type { StudentRecord } from './types';

const year = '2026-2027';
const student = (index = 0): StudentRecord => ({ learnerId: String(123456789012 + index), firstName: 'Juan', lastName: 'Cruz', schoolYear: year, gradeLevel: 'Grade 6', section: 'POMELO' });

function createStore() {
  const documents = new Map<string, Record<string, unknown>>();
  const snapshot = (collection: string, id: string) => ({ exists: documents.has(`${collection}/${id}`), data: () => documents.get(`${collection}/${id}`) });
  const state = { transactions: 0, failAt: 0, wroteBeforeAllReads: false };
  const store: StudentImportStore = {
    authorize: vi.fn(async () => {}),
    read: vi.fn(async (_year, collection, id) => snapshot(collection, id)),
    async transaction(callback) {
      state.transactions++;
      if (state.transactions === state.failAt) throw new Error('Connection lost');
      const writes: { id: string; data: StudentRecord; merge: boolean }[] = [];
      const result = await callback({
        async read(collection, id) {
          if (writes.length) state.wroteBeforeAllReads = true;
          return snapshot(collection, id);
        },
        write(id, data, merge) { writes.push({ id, data, merge }); },
      });
      for (const write of writes) documents.set(`learners/${write.id}`, { ...(write.merge ? documents.get(`learners/${write.id}`) : {}), ...write.data });
      return result;
    },
    refresh: vi.fn(),
  };
  return { store, state, documents };
}

describe('student upload', () => {
  it('checks existing and archived LRNs before review', async () => {
    const { store, documents } = createStore();
    documents.set('learners/123456789012', student());
    documents.set('transferredOut/123456789013', student(1));
    expect(await inspectStudentTargets(store, year, [student(), student(1)])).toEqual({ existing: 1, conflicts: ['123456789013'] });
    expect(store.authorize).toHaveBeenCalledOnce();
  });

  it('creates students and skips existing LRNs by default', async () => {
    const { store, documents } = createStore();
    documents.set('learners/123456789012', { ...student(), guardian: 'Keep Me' });
    const result = await uploadStudents(store, year, [student(), student(1)], 'skip');
    expect(result).toEqual({ created: 1, updated: 0, skipped: 1, processed: 2 });
    expect(documents.get('learners/123456789012')?.guardian).toBe('Keep Me');
    expect(documents.get('learners/123456789013')?.enrollmentStatus).toBe('ACTIVE');
    expect(documents.get('learners/123456789013')?.anecdotalRecords).toBe('');
    expect(documents.get('learners/123456789013')).toMatchObject({ guardian: 'N/A', contact: 'N/A' });
    expect(store.refresh).toHaveBeenCalledWith(year);
  });

  it('merges only supplied fields, preserving existing grades and contact', async () => {
    const { store, documents } = createStore();
    documents.set('learners/123456789012', { ...student(), firstName: 'Old', math: 92, contact: '09123456789', guardian: 'Keep Me', anecdotalRecords: 'Verified saved records' });
    expect(await uploadStudents(store, year, [{ ...student(), firstName: 'New' }], 'merge')).toMatchObject({ updated: 1 });
    expect(documents.get('learners/123456789012')).toMatchObject({ firstName: 'New', math: 92, contact: '09123456789', guardian: 'Keep Me' });
    expect(documents.get('learners/123456789012')?.anecdotalRecords).toBe('Verified saved records');
  });

  it('fills missing saved contact details but never overwrites known details with N/A', async () => {
    const { store, documents } = createStore();
    documents.set('learners/123456789012', { ...student(), guardian: 'Maria Cruz', contact: '' });
    documents.set('learners/123456789013', { ...student(1), contact: '09123456789' });
    await uploadStudents(store, year, [
      { ...student(), guardian: 'N/A', contact: 'N/A' },
      { ...student(1), guardian: 'N/A', contact: 'N/A' },
    ], 'merge');
    expect(documents.get('learners/123456789012')).toMatchObject({ guardian: 'Maria Cruz', contact: 'N/A' });
    expect(documents.get('learners/123456789013')).toMatchObject({ guardian: 'N/A', contact: '09123456789' });
  });

  it('replaces placeholders with provided contact details on a future import', async () => {
    const { store, documents } = createStore();
    documents.set('learners/123456789012', { ...student(), guardian: 'N/A', contact: 'N/A' });
    await uploadStudents(store, year, [{ ...student(), guardian: 'Maria Cruz', contact: '09123456789' }], 'merge');
    expect(documents.get('learners/123456789012')).toMatchObject({ guardian: 'Maria Cruz', contact: '09123456789' });
  });

  it('rechecks duplicates inside transactions to handle records created after preview', async () => {
    const { store, documents } = createStore();
    expect((await inspectStudentTargets(store, year, [student()])).existing).toBe(0);
    documents.set('learners/123456789012', { ...student(), firstName: 'Created Elsewhere' });
    expect(await uploadStudents(store, year, [student()], 'skip')).toMatchObject({ skipped: 1, created: 0 });
    expect(documents.get('learners/123456789012')?.firstName).toBe('Created Elsewhere');
  });

  it('blocks archive conflicts even when they appear after preview', async () => {
    const { store, documents } = createStore();
    await inspectStudentTargets(store, year, [student()]);
    documents.set('dropouts/123456789012', student());
    await expect(uploadStudents(store, year, [student()], 'merge')).rejects.toThrow('archived/transfer record');
    expect(documents.has('learners/123456789012')).toBe(false);
  });

  it('chunks uploads, reads before writing, and reports progress', async () => {
    const { store, state } = createStore();
    const progress = vi.fn();
    expect(await uploadStudents(store, year, Array.from({ length: 51 }, (_, index) => student(index)), 'skip', progress)).toMatchObject({ created: 51, processed: 51 });
    expect(state.transactions).toBe(3);
    expect(state.wroteBeforeAllReads).toBe(false);
    expect(progress.mock.calls.map(([value]) => value.processed)).toEqual([25, 50, 51]);
  });

  it('reports committed progress on interruption and can safely resume by skipping saved records', async () => {
    const { store, state, documents } = createStore();
    const students = Array.from({ length: 30 }, (_, index) => student(index));
    state.failAt = 2;
    const error = await uploadStudents(store, year, students, 'skip').catch(error => error);
    expect(error).toBeInstanceOf(StudentUploadError);
    expect(error.progress).toMatchObject({ created: 25, processed: 25 });
    expect(error.message).toContain('5 rows remain');
    expect(documents.size).toBe(25);
    expect(store.refresh).toHaveBeenCalledWith(year);
    expect(await uploadStudents(store, year, students, 'skip')).toMatchObject({ created: 5, skipped: 25 });
  });

  it('stops before writes when authorization fails or a row targets another year', async () => {
    const { store, state } = createStore();
    await expect(uploadStudents(store, year, [{ ...student(), schoolYear: '2025-2026' }], 'skip')).rejects.toThrow('school years');
    vi.mocked(store.authorize).mockRejectedValue(new Error('School Admin required'));
    await expect(uploadStudents(store, year, [student()], 'skip')).rejects.toThrow('School Admin required');
    expect(state.transactions).toBe(0);
  });
});
