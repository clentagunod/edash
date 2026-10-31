import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSignatureLibrary, type SignatureLibrary } from '../lib/printable-signatures';
const mocks = vi.hoisted(() => ({ receive: undefined as undefined | ((value: unknown) => void), get: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../lib/printable-signature-api', () => ({ subscribeSignatureLibrary: (next: (value: unknown) => void) => { mocks.receive = next; return mocks.unsubscribe; }, getSignatureAsset: mocks.get }));
import { usePrintableSignature } from './PrintableSignature';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
function Harness() {
  const signature = usePrintableSignature('sf10-request', true);
  return <>{signature.controls}<div data-preview>{signature.controller.render('document', true)}</div><div data-print>{signature.controller.render()}</div><button data-output disabled={!signature.ready}>Print</button></>;
}
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); mocks.get.mockResolvedValue({ label: 'School head', revision: 'a', width: 300, height: 100, dataUrl: 'data:image/png;base64,YQ==' }); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
function library(): SignatureLibrary { return normalizeSignatureLibrary({ slots: { 'signature-1': { label: 'School head', revision: 'a', width: 300, height: 100 } }, assignments: { 'sf10-request': ['signature-1'] } }); }
describe('optional signature placement', () => {
  it('loads only an explicitly selected approved asset and shares placement with the print output', async () => {
    await act(async () => root.render(<Harness />));
    act(() => mocks.receive!(library()));
    expect(mocks.get).not.toHaveBeenCalled();
    const select = container.querySelector('select')!;
    await act(async () => { select.value = 'signature-1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('[data-preview] img')).toBeNull();
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Place signature')!.click());
    const preview = container.querySelector<HTMLElement>('[data-preview] .printable-signature')!;
    expect(container.querySelector('[data-print] img')?.getAttribute('src')).toBe('data:image/png;base64,YQ==');
    preview.setPointerCapture = vi.fn();
    vi.spyOn(preview.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 700 } as DOMRect);
    const beforeDrag = parseFloat(preview.style.left);
    act(() => {
      preview.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
      preview.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 170, bubbles: true }));
      preview.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(parseFloat(preview.style.left)).toBeCloseTo(beforeDrag + 10);
    const start = preview.style.left;
    act(() => preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(preview.style.left).not.toBe(start);
    expect(container.querySelector<HTMLElement>('[data-print] .printable-signature')!.style.left).toBe(preview.style.left);
    expect(container.querySelector('[data-print] .is-draggable')).toBeNull();
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Remove from document')!.click());
    expect(container.querySelector('[data-print] img')).toBeNull();
  });
  it('removes a revoked signature from preview and output immediately', async () => {
    await act(async () => root.render(<Harness />)); act(() => mocks.receive!(library()));
    const select = container.querySelector('select')!;
    await act(async () => { select.value = 'signature-1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Place signature')!.click());
    act(() => mocks.receive!(normalizeSignatureLibrary()));
    expect(container.querySelector('[data-print] img')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-output]')!.disabled).toBe(true);
    act(() => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector<HTMLButtonElement>('[data-output]')!.disabled).toBe(false);
  });
});
