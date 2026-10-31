import type { PrintableKind } from './printables';

export const SIGNATURE_SLOTS = ['signature-1', 'signature-2', 'signature-3'] as const;
export type SignatureSlot = typeof SIGNATURE_SLOTS[number];
export const PRINTABLE_KINDS: PrintableKind[] = ['student-card', 'good-moral', 'enrollment', 'sf10-request', 'outgoing-envelope'];
export interface SignatureMetadata { label: string; revision: string; width: number; height: number }
export interface SignatureLibrary {
  version: 1;
  slots: Partial<Record<SignatureSlot, SignatureMetadata>>;
  assignments: Record<PrintableKind, SignatureSlot[]>;
}
export interface PreparedSignatureImage { dataUrl: string; width: number; height: number }
/** Studio images are embedded in memory so print/export does not depend on cross-origin rendering. */
export interface SignatureAsset extends SignatureMetadata { dataUrl: string; storage?: 'cloudinary' | 'firestore' }
export interface CloudinarySignatureReference {
  storage: 'cloudinary';
  url: string;
  publicId: string;
  cloudName: string;
  format: 'png';
}
export type StoredCloudinarySignature = SignatureMetadata & CloudinarySignatureReference;
export const MAX_SIGNATURE_IMAGE_BYTES = 1024 * 1024;
export const MAX_SIGNATURE_DATA_URL_LENGTH = Math.ceil(MAX_SIGNATURE_IMAGE_BYTES / 3) * 4 + 22;
export interface SignaturePlacement { x: number; y: number; width: number }
export function isSignatureSlot(value: unknown): value is SignatureSlot { return SIGNATURE_SLOTS.includes(value as SignatureSlot); }
export function normalizeSignatureLibrary(input?: unknown): SignatureLibrary {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<SignatureLibrary>;
  const slots: SignatureLibrary['slots'] = {};
  for (const slot of SIGNATURE_SLOTS) {
    const entry = value.slots?.[slot];
    if (entry && typeof entry.label === 'string' && typeof entry.revision === 'string' && Number.isFinite(entry.width) && entry.width > 0 && Number.isFinite(entry.height) && entry.height > 0) slots[slot] = entry;
  }
  return { version: 1, slots, assignments: Object.fromEntries(PRINTABLE_KINDS.map((kind) => [kind,
    Array.isArray(value.assignments?.[kind]) ? [...new Set(value.assignments[kind].filter((slot) => isSignatureSlot(slot) && slots[slot]))] : [],
  ])) as SignatureLibrary['assignments'] };
}
/** Coordinates are relative to a document side, so preview zoom and paper scaling stay independent. */
export function clampSignaturePlacement(value: SignaturePlacement, aspect: number, surfaceAspect: number): SignaturePlacement {
  const width = Math.max(.05, Math.min(.7, value.width, .8 * aspect / surfaceAspect));
  const height = width * surfaceAspect / aspect;
  return { width, x: Math.max(0, Math.min(1 - width, value.x)), y: Math.max(0, Math.min(1 - height, value.y)) };
}

/** Re-encode raster inputs, remove a white scan background, and crop empty pixels before storage. */
export async function prepareSignatureImage(file: File, removeWhite: boolean, threshold = 235): Promise<PreparedSignatureImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP image smaller than 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('The signature image is too large. Use an image below 24 megapixels.');
    const scale = Math.min(1, 1200 / image.naturalWidth, 600 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot prepare signature images.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1, transparent = false;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (removeWhite) {
        const light = Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
        if (light >= threshold) pixels.data[i + 3] = 0;
        else if (light > threshold - 30) pixels.data[i + 3] = Math.round(pixels.data[i + 3] * (threshold - light) / 30);
      }
      if (pixels.data[i + 3] < 255) transparent = true;
      if (pixels.data[i + 3] > 20) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (right < left) throw new Error('No visible signature was found. Adjust the background cleanup or choose another image.');
    if (!transparent) throw new Error('Use a transparent image or enable Remove white background.');
    context.putImageData(pixels, 0, 0);
    const cropped = document.createElement('canvas'); cropped.width = right - left + 9; cropped.height = bottom - top + 9;
    cropped.getContext('2d')!.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, 4, 4, right - left + 1, bottom - top + 1);
    const dataUrl = cropped.toDataURL('image/png');
    if (dataUrl.length > MAX_SIGNATURE_DATA_URL_LENGTH) throw new Error('The prepared signature exceeds 1 MB. Use a smaller, cleaner signature image.');
    return { dataUrl, width: cropped.width, height: cropped.height };
  } finally { URL.revokeObjectURL(url); }
}
