import { auth, db } from './firebase';
import { isSchoolAdmin } from './app-config';
import { isSignatureSlot, MAX_SIGNATURE_DATA_URL_LENGTH, normalizeSignatureLibrary, PRINTABLE_KINDS, type SignatureAsset, type SignatureLibrary, type SignatureSlot, type StoredCloudinarySignature } from './printable-signatures';
import { downloadCloudinarySignature, isCloudinarySignatureReference, uploadSignatureToCloudinary } from './cloudinary-signatures';
import type { PrintableKind } from './printables';

const LIBRARY = 'printableSignatures';
const cache = new Map<string, Promise<SignatureAsset>>();
export function subscribeSignatureLibrary(next: (value: SignatureLibrary) => void, error: (failure: Error) => void): () => void {
  return db.collection('settings').doc(LIBRARY).onSnapshot((snapshot: { exists: boolean; data(): unknown }) => next(normalizeSignatureLibrary(snapshot.exists ? snapshot.data() : undefined)), error);
}
export function getSignatureAsset(slot: SignatureSlot, revision: string): Promise<SignatureAsset> {
  const key = `${db.app?.options?.projectId || 'tenant'}:${slot}:${revision}`;
  if (!cache.has(key)) {
    const request = db.collection('settings').doc(`printable-${slot}`).get().then(async (snapshot: { data(): SignatureAsset | StoredCloudinarySignature | undefined }) => {
      const value = snapshot.data();
      if (!value || value.revision !== revision || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width < 1 || value.height < 1 || value.width > 1208 || value.height > 608) throw new Error('This signature is no longer available. Refresh the library.');
      const metadata = { label: value.label, revision: value.revision, width: value.width, height: value.height };
      if (value.storage === 'cloudinary') {
        if (!isCloudinarySignatureReference(value)) throw new Error('The saved Cloudinary signature reference is invalid.');
        return { ...metadata, storage: 'cloudinary' as const, dataUrl: await downloadCloudinarySignature(value) };
      }
      // Existing tenant images remain usable until an admin moves them to Cloudinary.
      if (!('dataUrl' in value) || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.dataUrl) || value.dataUrl.length > 220_000) throw new Error('This signature is no longer available. Refresh the library.');
      return { ...metadata, storage: 'firestore' as const, dataUrl: value.dataUrl };
    }).catch((error: unknown) => { cache.delete(key); throw error; });
    cache.set(key, request);
    // Keep only the current small school library in memory.
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return cache.get(key)!;
}
function admin() { if (!isSchoolAdmin()) throw new Error('Only a School Admin can manage school signatures.'); }
export async function saveSignatureAsset(slot: SignatureSlot, asset: SignatureAsset): Promise<void> {
  admin();
  if (!isSignatureSlot(slot) || !asset.label.trim() || asset.label.length > 80 || !asset.revision || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(asset.dataUrl) || asset.dataUrl.length > MAX_SIGNATURE_DATA_URL_LENGTH || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 1208 || asset.height > 608) throw new Error('Choose a valid prepared signature and a label up to 80 characters.');
  const metadata = { label: asset.label.trim(), revision: asset.revision, width: asset.width, height: asset.height };
  const ref = db.collection('settings').doc(LIBRARY);
  const current = normalizeSignatureLibrary((await ref.get()).data());
  if (current.slots[slot]) throw new Error('This signature slot is occupied. Remove its current signature before uploading another.');
  // Network uploads stay outside retryable Firestore transactions.
  const uploaded = await uploadSignatureToCloudinary(asset);
  await db.runTransaction(async (transaction: { get(ref: unknown): Promise<{ data(): unknown }>; set(ref: unknown, data: unknown, options?: unknown): void }) => {
    const library = normalizeSignatureLibrary((await transaction.get(ref)).data());
    if (library.slots[slot]) throw new Error('This signature slot is occupied. Remove its current signature before uploading another.');
    transaction.set(db.collection('settings').doc(`printable-${slot}`), { ...metadata, ...uploaded.reference, updatedBy: auth.currentUser?.uid || '' });
    transaction.set(ref, { version: 1, slots: { ...library.slots, [slot]: metadata } }, { mergeFields: ['version', 'slots'] });
  });
  cache.set(`${db.app?.options?.projectId || 'tenant'}:${slot}:${asset.revision}`, Promise.resolve({ ...metadata, dataUrl: uploaded.dataUrl, storage: 'cloudinary' }));
}

/** Move one legacy image without changing its printable assignments or overwriting concurrent edits. */
export async function migrateSignatureAsset(slot: SignatureSlot, revision: string): Promise<void> {
  admin();
  if (!isSignatureSlot(slot)) throw new Error('Unknown signature slot.');
  const asset = await getSignatureAsset(slot, revision);
  if (asset.storage === 'cloudinary') return;
  const uploaded = await uploadSignatureToCloudinary(asset);
  const metadata = { label: asset.label, width: asset.width, height: asset.height, revision: crypto.randomUUID() };
  const ref = db.collection('settings').doc(LIBRARY);
  const assetRef = db.collection('settings').doc(`printable-${slot}`);
  await db.runTransaction(async (transaction: { get(ref: unknown): Promise<{ data(): unknown }>; set(ref: unknown, data: unknown, options?: unknown): void }) => {
    const library = normalizeSignatureLibrary((await transaction.get(ref)).data());
    const stored = (await transaction.get(assetRef)).data() as SignatureAsset | undefined;
    if (library.slots[slot]?.revision !== revision || stored?.revision !== revision || stored.storage === 'cloudinary') throw new Error('This signature changed while it was being moved. Reload the library and try again.');
    transaction.set(assetRef, { ...metadata, ...uploaded.reference, updatedBy: auth.currentUser?.uid || '' });
    transaction.set(ref, { slots: { ...library.slots, [slot]: metadata } }, { mergeFields: ['slots'] });
  });
  cache.clear();
}
export async function removeSignatureAsset(slot: SignatureSlot): Promise<void> {
  admin();
  if (!isSignatureSlot(slot)) throw new Error('Unknown signature slot.');
  const ref = db.collection('settings').doc(LIBRARY);
  await db.runTransaction(async (transaction: { get(ref: unknown): Promise<{ data(): unknown }>; set(ref: unknown, data: unknown, options?: unknown): void; delete(ref: unknown): void }) => {
    const library = normalizeSignatureLibrary((await transaction.get(ref)).data());
    delete library.slots[slot];
    for (const kind of PRINTABLE_KINDS) library.assignments[kind] = library.assignments[kind].filter((id) => id !== slot);
    transaction.set(ref, library, { mergeFields: ['version', 'slots', 'assignments'] });
    transaction.delete(db.collection('settings').doc(`printable-${slot}`));
  });
  cache.clear();
}
export async function setSignatureAssignments(assignments: Record<PrintableKind, SignatureSlot[]>): Promise<void> {
  admin();
  const ref = db.collection('settings').doc(LIBRARY);
  await db.runTransaction(async (transaction: { get(ref: unknown): Promise<{ data(): unknown }>; set(ref: unknown, data: unknown, options?: unknown): void }) => {
    const library = normalizeSignatureLibrary((await transaction.get(ref)).data());
    for (const kind of PRINTABLE_KINDS) {
      if (!Array.isArray(assignments[kind]) || assignments[kind].some((slot) => !isSignatureSlot(slot) || !library.slots[slot])) throw new Error('A selected signature was removed. Refresh the library and try again.');
      library.assignments[kind] = [...new Set(assignments[kind])];
    }
    transaction.set(ref, library, { mergeFields: ['assignments'] });
  });
}
