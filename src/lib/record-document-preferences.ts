import { PAPER_SIZES, type PaperSizeId, type PaperOrientation } from './student-card-layout';
import type { RecordDocumentKind } from './printables';

export const RECORD_DOCUMENT_KINDS: RecordDocumentKind[] = ['sf10-request', 'outgoing-envelope'];
export const DOCUMENT_PAPER_SIZES = {
  ...PAPER_SIZES,
  envelope: { label: 'Envelope — 241 × 105 mm', width: 241, height: 105 },
  'envelope-source': { label: 'Original Word envelope — 241.3 × 104.775 mm', width: 241.3, height: 104.775 },
};
export type DocumentPaperSizeId = PaperSizeId | 'envelope' | 'envelope-source';
export interface RecordDocumentPreference {
  version: 1;
  template: 'default';
  defaultPaperSize: DocumentPaperSizeId;
  defaultOrientation: PaperOrientation;
  defaultMargin: number;
  defaultScale: number;
  defaultTextSize: number;
  allowSchoolDetailsOverride: boolean;
}
export type RecordDocumentPreferences = Record<RecordDocumentKind, RecordDocumentPreference>;
export const RECORD_TEMPLATE_DIMENSIONS = {
  'sf10-request': { width: 210, height: 297 },
  'outgoing-envelope': { width: 241.3, height: 104.775 },
};

export function documentPaperDimensions(id: DocumentPaperSizeId, orientation: PaperOrientation) {
  const size = DOCUMENT_PAPER_SIZES[id];
  const short = Math.min(size.width, size.height), long = Math.max(size.width, size.height);
  return orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short };
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numeric(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
export function normalizeRecordDocumentPreference(kind: RecordDocumentKind, input?: unknown): RecordDocumentPreference {
  const value = object(input);
  return {
    version: 1, template: 'default',
    defaultPaperSize: Object.prototype.hasOwnProperty.call(DOCUMENT_PAPER_SIZES, String(value.defaultPaperSize)) ? value.defaultPaperSize as DocumentPaperSizeId : kind === 'sf10-request' ? 'a4' : 'envelope',
    defaultOrientation: value.defaultOrientation === 'portrait' || value.defaultOrientation === 'landscape' ? value.defaultOrientation : kind === 'sf10-request' ? 'portrait' : 'landscape',
    defaultMargin: numeric(value.defaultMargin, 0, 0, 30),
    defaultScale: numeric(value.defaultScale, 100, 50, 100),
    defaultTextSize: numeric(value.defaultTextSize, 100, 70, 130),
    allowSchoolDetailsOverride: typeof value.allowSchoolDetailsOverride === 'boolean' ? value.allowSchoolDetailsOverride : true,
  };
}
export function normalizeRecordDocumentPreferences(input?: unknown): RecordDocumentPreferences {
  const value = object(input);
  return Object.fromEntries(RECORD_DOCUMENT_KINDS.map((kind) => [kind, normalizeRecordDocumentPreference(kind, value[kind])])) as RecordDocumentPreferences;
}
export function validateRecordDocumentPreference(kind: RecordDocumentKind, input: unknown): RecordDocumentPreference {
  if (!RECORD_DOCUMENT_KINDS.includes(kind)) throw new Error('Unknown record document.');
  const value = object(input);
  const result = normalizeRecordDocumentPreference(kind, value);
  if (value.template !== 'default' || !Object.prototype.hasOwnProperty.call(DOCUMENT_PAPER_SIZES, String(value.defaultPaperSize)) ||
    !['portrait', 'landscape'].includes(String(value.defaultOrientation)) || typeof value.allowSchoolDetailsOverride !== 'boolean' ||
    value.defaultMargin !== result.defaultMargin || value.defaultScale !== result.defaultScale || value.defaultTextSize !== result.defaultTextSize) {
    throw new Error('Choose valid paper, orientation, margin, size, and editing preferences.');
  }
  return result;
}
