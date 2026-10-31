import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ admin: true, records: new Map<string, unknown>(), writes: [] as Array<{ path: string; data?: unknown; remove?: boolean }>, commit: vi.fn(), upload: vi.fn(), download: vi.fn() }));
vi.mock('./cloudinary-signatures', async (original) => ({ ...await original<typeof import('./cloudinary-signatures')>(), uploadSignatureToCloudinary: mocks.upload, downloadCloudinarySignature: mocks.download }));
vi.mock('./app-config', () => ({ isSchoolAdmin: () => mocks.admin }));
vi.mock('./firebase', () => ({ auth: { currentUser: { uid: 'school-admin' } }, db: {
  app: { options: { projectId: 'test-school' } },
  collection: () => ({ doc: (path: string) => ({ path, get: async () => ({ data: () => mocks.records.get(path) }) }) }),
  batch: () => ({ set: (ref: { path: string }, data: unknown) => mocks.writes.push({ path: ref.path, data }), commit: mocks.commit }),
  runTransaction: async (action: (transaction: unknown) => Promise<void>) => action({ get: async (ref: { path: string }) => ({ data: () => mocks.records.get(ref.path) }), set: (ref: { path: string }, data: unknown) => mocks.writes.push({ path: ref.path, data }), delete: (ref: { path: string }) => mocks.writes.push({ path: ref.path, remove: true }) }),
} }));
import { getSignatureAsset, migrateSignatureAsset, removeSignatureAsset, saveSignatureAsset, setSignatureAssignments } from './printable-signature-api';
import { normalizeSignatureLibrary } from './printable-signatures';
const reference = { storage: 'cloudinary', cloudName: 'sample-cloud', publicId: 'signatures/head', format: 'png', url: 'https://res.cloudinary.com/sample-cloud/image/upload/v1/signatures/head.png' };
beforeEach(() => {
  mocks.admin = true; mocks.records.clear(); mocks.writes.length = 0; vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ reference, dataUrl: 'data:image/png;base64,YQ==' });
  mocks.download.mockResolvedValue('data:image/png;base64,YQ==');
});
describe('signature persistence', () => {
  it('uploads to Cloudinary and atomically saves only references and metadata in Firestore', async () => {
    await saveSignatureAsset('signature-1', { label: 'School head', revision: 'new', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' });
    expect(mocks.writes.map((write) => write.path)).toEqual(['printable-signature-1', 'printableSignatures']);
    expect(JSON.stringify(mocks.writes)).not.toContain('dataUrl');
    expect(mocks.writes[0].data).toMatchObject({ ...reference, updatedBy: 'school-admin' });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.writes).toHaveLength(2);
  });
  it('atomically removes a signature and every printable assignment while preserving other slots', async () => {
    mocks.records.set('printableSignatures', { slots: { 'signature-1': { label: 'One', revision: 'a', width: 2, height: 1 }, 'signature-2': { label: 'Two', revision: 'b', width: 2, height: 1 } }, assignments: { 'student-card': ['signature-1', 'signature-2'], enrollment: ['signature-1'] } });
    await removeSignatureAsset('signature-1');
    const library = normalizeSignatureLibrary(mocks.writes[0].data);
    expect(library.assignments['student-card']).toEqual(['signature-2']); expect(library.assignments.enrollment).toEqual([]);
    expect(library.slots['signature-1']).toBeUndefined(); expect(library.slots['signature-2']).toBeDefined();
    expect(mocks.writes[1]).toEqual({ path: 'printable-signature-1', remove: true });
  });
  it('prevents concurrent uploads from silently replacing an occupied signature slot', async () => {
    mocks.records.set('printableSignatures', { slots: { 'signature-1': { label: 'Existing head', revision: 'old', width: 300, height: 100 } } });
    await expect(saveSignatureAsset('signature-1', { label: 'New head', revision: 'new', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' })).rejects.toThrow('occupied');
    expect(mocks.writes).toEqual([]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects removed assignments and non-admin writes', async () => {
    const assignments = normalizeSignatureLibrary().assignments; assignments['sf10-request'] = ['signature-3'];
    await expect(setSignatureAssignments(assignments)).rejects.toThrow('removed'); expect(mocks.writes).toEqual([]);
    mocks.admin = false;
    await expect(removeSignatureAsset('signature-1')).rejects.toThrow('School Admin');
    await expect(setSignatureAssignments(normalizeSignatureLibrary().assignments)).rejects.toThrow('School Admin');
    await expect(saveSignatureAsset('signature-1', { label: 'Head', revision: 'denied', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' })).rejects.toThrow('School Admin');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });
  it('does not create a signature record if the Cloudinary upload fails', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('Upload preset rejected'));
    await expect(saveSignatureAsset('signature-2', { label: 'Head', revision: 'failure', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' })).rejects.toThrow('preset');
    expect(mocks.writes).toEqual([]);
  });
  it('downloads a Cloudinary reference and preserves legacy inline signatures for existing tenants', async () => {
    mocks.records.set('printable-signature-3', { ...reference, label: 'Cloud head', revision: 'cloud-read', width: 300, height: 100 });
    expect(await getSignatureAsset('signature-3', 'cloud-read')).toMatchObject({ storage: 'cloudinary', dataUrl: 'data:image/png;base64,YQ==' });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    await getSignatureAsset('signature-3', 'cloud-read');
    expect(mocks.download).toHaveBeenCalledTimes(1);
    mocks.records.set('printable-signature-2', { label: 'Legacy head', revision: 'legacy-read', width: 300, height: 100, dataUrl: 'data:image/png;base64,Yg==' });
    expect(await getSignatureAsset('signature-2', 'legacy-read')).toMatchObject({ storage: 'firestore', dataUrl: 'data:image/png;base64,Yg==' });
  });
  it('moves an old signature to Cloudinary without modifying its printable assignments', async () => {
    const legacy = { label: 'Existing head', revision: 'legacy-move', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' };
    mocks.records.set('printable-signature-1', legacy);
    mocks.records.set('printableSignatures', { slots: { 'signature-1': legacy }, assignments: { 'student-card': ['signature-1'] } });
    await migrateSignatureAsset('signature-1', 'legacy-move');
    expect(mocks.writes[0].data).toMatchObject(reference);
    expect(JSON.stringify(mocks.writes)).not.toContain('dataUrl');
    expect(mocks.writes[1].data).not.toHaveProperty('assignments');
  });
});
