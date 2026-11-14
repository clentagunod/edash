import { describe, expect, it } from 'vitest';
import { normalizeAssetReference } from '../../shared/asset-reference.mjs';
import cases from '../../shared/asset-reference-cases.json';

describe('website asset references', () => {
  it.each(cases.accepted)('normalizes $input', ({ input, expected }) => {
    expect(normalizeAssetReference(input)).toBe(expected);
  });
  it.each(cases.rejected)('rejects an unusable asset reference: %s', input => {
    expect(normalizeAssetReference(input)).toBeNull();
  });
  it('rejects missing, non-string, and oversized values', () => {
    for (const input of [null, undefined, 7, {}, 'x'.repeat(2049)]) {
      expect(normalizeAssetReference(input)).toBeNull();
    }
  });
});
