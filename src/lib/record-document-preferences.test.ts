import { describe, expect, it } from 'vitest';
import { documentPaperDimensions, normalizeRecordDocumentPreferences, validateRecordDocumentPreference } from './record-document-preferences';

describe('record document preferences', () => {
  it('defaults to A4 for requests and 241 by 105 mm for envelopes', () => {
    const value = normalizeRecordDocumentPreferences();
    expect(value['sf10-request']).toMatchObject({ defaultPaperSize: 'a4', defaultOrientation: 'portrait' });
    expect(value['outgoing-envelope']).toMatchObject({ defaultPaperSize: 'envelope', defaultOrientation: 'landscape' });
    expect(documentPaperDimensions('envelope', 'landscape')).toEqual({ width: 241, height: 105 });
    expect(documentPaperDimensions('envelope-source', 'landscape')).toEqual({ width: 241.3, height: 104.775 });
    expect(documentPaperDimensions('envelope', 'portrait')).toEqual({ width: 105, height: 241 });
  });
  it('recovers malformed stored values and rejects invalid writes', () => {
    const defaults = normalizeRecordDocumentPreferences();
    const malformed = normalizeRecordDocumentPreferences({ 'outgoing-envelope': { defaultPaperSize: '__proto__', defaultScale: NaN } });
    expect(malformed['outgoing-envelope']).toEqual(defaults['outgoing-envelope']);
    for (const patch of [{ defaultScale: 200 }, { defaultMargin: -1 }, { defaultTextSize: '100' }, { defaultPaperSize: 'unknown' }, { allowSchoolDetailsOverride: 'yes' }, { template: 'sres' }]) {
      expect(() => validateRecordDocumentPreference('sf10-request', { ...defaults['sf10-request'], ...patch })).toThrow();
    }
    expect(validateRecordDocumentPreference('sf10-request', defaults['sf10-request'])).toEqual(defaults['sf10-request']);
  });
});
