import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ migrate: vi.fn(), remove: vi.fn() }));
vi.mock('../lib/printable-signature-api', () => ({
  subscribeSignatureLibrary(next: (value: unknown) => void) {
    next({ version: 1, slots: { 'signature-1': { label: 'Existing head', revision: 'legacy', width: 300, height: 100 }, 'signature-2': { label: 'Cloud head', revision: 'cloud', width: 300, height: 100 } }, assignments: { 'student-card': ['signature-1'], 'good-moral': [], enrollment: [], 'sf10-request': ['signature-2'], 'outgoing-envelope': [] } }); return () => {};
  },
  getSignatureAsset: async (slot: string, revision: string) => ({ label: slot, revision, width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==', storage: slot === 'signature-1' ? 'firestore' : 'cloudinary' }),
  migrateSignatureAsset: mocks.migrate, removeSignatureAsset: mocks.remove, saveSignatureAsset: vi.fn(), setSignatureAssignments: vi.fn(),
}));
import SignatureLibraryPanel from './SignatureLibraryPanel';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'sample'); vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'existing'); vi.stubEnv('VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET', ''); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('Cloudinary signature administration', () => {
  it('offers migration only for legacy signatures and keeps existing printable assignments', async () => {
    await act(async () => root.render(<SignatureLibraryPanel />));
    const migration = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'Move to Cloudinary');
    expect(migration).toHaveLength(1);
    expect(container.querySelectorAll('.signature-library-slot')).toHaveLength(3);
    const cardAssignment = container.querySelector<HTMLInputElement>('.signature-assignment-list input')!;
    expect(cardAssignment.checked).toBe(true);
    await act(async () => migration[0].click());
    expect(mocks.migrate).toHaveBeenCalledWith('signature-1', 'legacy');
    expect(cardAssignment.checked).toBe(true);
    expect(container.textContent).toContain('Signature moved to Cloudinary');
  });
  it('reports missing Cloudinary configuration without blocking library removal', async () => {
    vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', '');
    await act(async () => root.render(<SignatureLibraryPanel />));
    expect(container.textContent).toContain('Cloudinary signature uploads are not configured');
    const migration = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Move to Cloudinary')!;
    expect(migration.disabled).toBe(true);
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Remove signature 1')!;
    expect(remove.disabled).toBe(false);
    await act(async () => remove.click()); expect(mocks.remove).toHaveBeenCalledWith('signature-1');
  });
});
