import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampSignaturePlacement, signatureBoxMetrics, normalizeSignatureLibrary, prepareSignatureImage } from './printable-signatures';
afterEach(() => vi.restoreAllMocks());
describe('school signature preparation and layout', () => {
  it('offers only existing signature slots explicitly enabled for each printable', () => {
    const value = normalizeSignatureLibrary({ slots: { 'signature-1': { label: 'Current head', revision: 'a', width: 300, height: 100 } }, assignments: { 'student-card': ['signature-1', 'signature-1', 'signature-2', 'unknown'], 'good-moral': [] } });
    expect(value.assignments['student-card']).toEqual(['signature-1']);
    expect(value.assignments.enrollment).toEqual([]);
    expect(Object.keys(value.slots)).toEqual(['signature-1']);
  });
  it('keeps signatures inside both letter pages and landscape envelopes while preserving their aspect ratio', () => {
    for (const surfaceAspect of [210 / 297, 241.3 / 104.775, 470 / 884]) {
      const placement = clampSignaturePlacement({ x: 2, y: 2, width: .4 }, 2, surfaceAspect);
      expect(placement.x + placement.width).toBeLessThanOrEqual(1);
      expect(placement.y + placement.width * surfaceAspect / 2).toBeLessThanOrEqual(1);
      expect(clampSignaturePlacement({ x: -2, y: -2, width: .2 }, 2, surfaceAspect).x).toBe(0);
    }
  });
  it('removes the white scan background and preserves dark signature pixels', async () => {
    const pixels = { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) };
    const context = { drawImage: vi.fn(), getImageData: () => pixels, putImageData: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,YQ==');
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:signature'); URL.revokeObjectURL = vi.fn();
    const original = globalThis.Image;
    globalThis.Image = class { naturalWidth = 2; naturalHeight = 1; src = ''; decode() { return Promise.resolve(); } } as unknown as typeof Image;
    try {
      const value = await prepareSignatureImage(new File(['image'], 'scan.png', { type: 'image/png' }), true);
      expect(pixels.data[3]).toBe(0); expect(pixels.data[7]).toBe(255);
      expect(value).toMatchObject({ width: 9, height: 9, dataUrl: 'data:image/png;base64,YQ==' });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:signature');
    } finally { globalThis.Image = original; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });
  it('rejects active image formats and oversized input before decoding', async () => {
    await expect(prepareSignatureImage(new File(['<svg/>'], 'signature.svg', { type: 'image/svg+xml' }), true)).rejects.toThrow('PNG');
    const file = new File(['image'], 'signature.png', { type: 'image/png' }); Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    await expect(prepareSignatureImage(file, true)).rejects.toThrow('5 MB');
  });
  it('keeps rotated and vertical signatures inside page bounds at every paper aspect ratio', () => {
    for (const surface of [210 / 297, 241.3 / 104.775, 470 / 884]) for (const rotation of [-180, -45, 0, 45, 90, 180]) {
      const placement = clampSignaturePlacement({ x: .99, y: .99, width: .7, orientation: 'vertical', rotation }, 3, surface);
      const metrics = signatureBoxMetrics(placement, 3, surface);
      expect(placement.x + metrics.width).toBeLessThanOrEqual(1.00001);
      expect(placement.y + metrics.height).toBeLessThanOrEqual(1.00001);
    }
  });
});
