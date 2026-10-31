import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCloudinarySignature, isCloudinarySignatureReference, signatureCloudinaryConfig, uploadSignatureToCloudinary } from './cloudinary-signatures';

const reference = { storage: 'cloudinary' as const, cloudName: 'school-cloud', publicId: 'signatures/head', format: 'png' as const, url: 'https://res.cloudinary.com/school-cloud/image/upload/v123/signatures/head.png' };
const prepared = { dataUrl: 'data:image/png;base64,YQ==', width: 300, height: 100 };
const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function configure() { vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'school-cloud'); vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'existing-preset'); vi.stubEnv('VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET', ''); }
function uploadResponse(changes = {}) { return { ok: true, json: async () => ({ secure_url: reference.url, public_id: reference.publicId, format: 'png', resource_type: 'image', width: 300, height: 100, ...changes }) }; }
function imageResponse() { return { ok: true, headers: new Headers({ 'content-type': 'image/png', 'content-length': '8' }), arrayBuffer: async () => pngHeader.buffer }; }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Cloudinary signature storage', () => {
  it('reuses the existing cloud name and upload preset, with an optional signature-specific preset', () => {
    configure(); expect(signatureCloudinaryConfig()).toEqual({ cloudName: 'school-cloud', uploadPreset: 'existing-preset' });
    vi.stubEnv('VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET', 'signatures-only');
    expect(signatureCloudinaryConfig().uploadPreset).toBe('signatures-only');
  });
  it('rejects non-Cloudinary, mismatched-cloud, and non-PNG delivery references', () => {
    expect(isCloudinarySignatureReference(reference)).toBe(true);
    for (const url of ['https://example.com/head.png', 'https://res.cloudinary.com/other/image/upload/head.png', reference.url.replace('.png', '.jpg'), reference.url + '?changed=1']) expect(isCloudinarySignatureReference({ ...reference, url })).toBe(false);
  });
  it('sends the prepared transparent PNG to the configured unsigned preset and verifies delivery', async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(imageResponse()); vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('Image', class { naturalWidth = 300; naturalHeight = 100; src = ''; decode() { return Promise.resolve(); } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) }) } as never);
    const value = await uploadSignatureToCloudinary(prepared);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/school-cloud/image/upload');
    const body = fetcher.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBe(prepared.dataUrl); expect(body.get('upload_preset')).toBe('existing-preset'); expect(body.get('api_secret')).toBeNull();
    expect(value.reference).toEqual(reference); expect(value.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
  it('refuses presets that change the PNG format, dimensions, or transparent background', async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValueOnce(uploadResponse({ format: 'jpg' })).mockResolvedValueOnce(uploadResponse({ width: 512 })); vi.stubGlobal('fetch', fetcher);
    await expect(uploadSignatureToCloudinary(prepared)).rejects.toThrow('original PNG');
    await expect(uploadSignatureToCloudinary(prepared)).rejects.toThrow('resized or cropped');
    fetcher.mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('Image', class { naturalWidth = 300; naturalHeight = 100; src = ''; decode() { return Promise.resolve(); } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }) } as never);
    await expect(uploadSignatureToCloudinary(prepared)).rejects.toThrow('background');
  });
  it('reports absent configuration, rejected uploads, and unreadable delivery without saving a reference', async () => {
    configure(); vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(uploadSignatureToCloudinary(prepared)).rejects.toThrow('environment variables'); expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'existing-preset'); fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'Preset not found' } }) });
    await expect(uploadSignatureToCloudinary(prepared)).rejects.toThrow('Preset not found');
    fetcher.mockResolvedValueOnce({ ...imageResponse(), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    await expect(downloadCloudinarySignature(reference)).rejects.toThrow('invalid PNG');
  });
});
