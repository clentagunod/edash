import { describe, expect, it } from 'vitest';
import { sf10EmailLearnerIds } from './sf10-email';

describe('SF10 email attachment tracking targets', () => {
  it('tracks the selected batch for PDF and Word, including when another learner is in the preview', () => {
    expect(sf10EmailLearnerIds('pdf', 'preview-only', ['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(sf10EmailLearnerIds('docx', 'preview-only', ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('tracks only the previewed learner for PNG and uses the active learner without a batch', () => {
    expect(sf10EmailLearnerIds('png', 'preview-only', ['a', 'b'])).toEqual(['preview-only']);
    expect(sf10EmailLearnerIds('pdf', 'a', [])).toEqual(['a']);
  });
  it('never matches manual document details to a database learner', () => {
    expect(sf10EmailLearnerIds('pdf', '', [])).toEqual([]);
    expect(sf10EmailLearnerIds('png', '', ['a'])).toEqual([]);
  });
});
