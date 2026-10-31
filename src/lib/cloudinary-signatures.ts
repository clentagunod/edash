import { MAX_SIGNATURE_IMAGE_BYTES, type CloudinarySignatureReference, type PreparedSignatureImage } from './printable-signatures';

export function signatureCloudinaryConfig() {
  return {
    cloudName: String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim(),
    uploadPreset: String(import.meta.env.VITE_CLOUDINARY_SIGNATURE_UPLOAD_PRESET || import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim(),
  };
}

export function isCloudinarySignatureReference(value: unknown): value is CloudinarySignatureReference {
  if (!value || typeof value !== 'object') return false;
  const ref = value as CloudinarySignatureReference;
  if (ref.storage !== 'cloudinary' || ref.format !== 'png' || typeof ref.cloudName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ref.cloudName) || typeof ref.publicId !== 'string' || !ref.publicId || ref.publicId.length > 1000 || /[\u0000-\u001f]/.test(ref.publicId) || typeof ref.url !== 'string' || ref.url.length > 2048) return false;
  try {
    const url = new URL(ref.url);
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.port && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.startsWith(`/${ref.cloudName}/image/upload/`) && url.pathname.endsWith('.png');
  } catch { return false; }
}

/** Fetch once and embed a small PNG for consistent browser printing and canvas-based exports. */
export async function downloadCloudinarySignature(ref: CloudinarySignatureReference): Promise<string> {
  if (!isCloudinarySignatureReference(ref)) throw new Error('The saved Cloudinary signature reference is invalid.');
  let response: Response;
  try {
    response = await fetch(ref.url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('Could not download the school signature from Cloudinary. Check the connection and try again.'); }
  if (!response.ok) throw new Error('The signature image is unavailable on Cloudinary. Ask a School Admin to review the image.');
  if (Number(response.headers.get('content-length')) > MAX_SIGNATURE_IMAGE_BYTES) throw new Error('The Cloudinary signature exceeds the 1 MB image limit.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SIGNATURE_IMAGE_BYTES || response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('Cloudinary must deliver a PNG signature smaller than 1 MB.');
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw new Error('Cloudinary returned an invalid PNG signature.');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not prepare the Cloudinary signature for printing.'));
    reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }));
  });
}

async function verifyTransparentImage(dataUrl: string, prepared: PreparedSignatureImage): Promise<void> {
  const image = new Image(); image.src = dataUrl;
  try { await image.decode(); } catch { throw new Error('The uploaded signature could not be decoded.'); }
  if (image.naturalWidth !== prepared.width || image.naturalHeight !== prepared.height) throw new Error('The Cloudinary upload preset resized or cropped the signature. Use a preset that preserves the original PNG.');
  const canvas = document.createElement('canvas'); canvas.width = prepared.width; canvas.height = prepared.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot verify signature transparency.');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false, visible = false;
  for (let index = 3; index < pixels.length; index += 4) { transparent ||= pixels[index] < 255; visible ||= pixels[index] > 20; }
  if (!transparent || !visible) throw new Error('The Cloudinary preset changed the signature background. Use a preset that preserves PNG transparency.');
}

export async function uploadSignatureToCloudinary(prepared: PreparedSignatureImage): Promise<{ reference: CloudinarySignatureReference; dataUrl: string }> {
  const { cloudName, uploadPreset } = signatureCloudinaryConfig();
  if (!/^[A-Za-z0-9_-]+$/.test(cloudName) || !uploadPreset) throw new Error('Signature uploads need the existing Cloudinary cloud name and unsigned upload preset environment variables.');
  const form = new FormData();
  // The prepared data URI is supported by Cloudinary unsigned uploads and remains a PNG.
  form.append('file', prepared.dataUrl);
  form.append('upload_preset', uploadPreset);
  form.append('tags', 'edash-school-signature');
  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  } catch { throw new Error('The Cloudinary upload could not be confirmed. Check the connection before trying again.'); }
  let result: { secure_url?: string; public_id?: string; format?: string; width?: number; height?: number; resource_type?: string; error?: { message?: string } };
  try { result = await response.json(); } catch { throw new Error('Cloudinary returned an unreadable upload response.'); }
  if (!response.ok) throw new Error(result.error?.message || 'Cloudinary rejected the signature. Check the unsigned upload preset.');
  const reference: CloudinarySignatureReference = { storage: 'cloudinary', url: result.secure_url || '', publicId: result.public_id || '', cloudName, format: 'png' };
  if (result.resource_type !== 'image' || result.format !== 'png' || !isCloudinarySignatureReference(reference)) throw new Error('The Cloudinary preset must store the signature as an original PNG image.');
  if (result.width !== prepared.width || result.height !== prepared.height) throw new Error('The Cloudinary preset resized or cropped the signature. Use a preset that preserves the original PNG.');
  const dataUrl = await downloadCloudinarySignature(reference);
  await verifyTransparentImage(dataUrl, prepared);
  return { reference, dataUrl };
}
