import { describe, expect, it } from 'vitest';
import { sf10EmailDetails, sf10EmailLearnerIds, sf10EmailRecord } from './sf10-email';

describe('confirmed SF10 email receipt', () => {
  const receipt = { messageId: 'confirmed-id', sentAt: '2026-10-31T17:05:00.000Z', to: ['records@example.edu'], cc: ['registrar@example.edu'], bcc: ['archive@example.edu'] };
  it('normalizes the actual recipients and displays the date/time in Philippine time', () => {
    expect(sf10EmailRecord({ ...receipt, to: [' records@example.edu ', 'records@example.edu'] })).toEqual(receipt);
    const details = sf10EmailDetails(receipt);
    expect(details.slice(0, 3)).toEqual(['To: records@example.edu', 'CC: registrar@example.edu', 'BCC: archive@example.edu']);
    expect(details[3]).toContain('Nov 1, 2026');
    expect(details[3]).toContain('1:05 AM');
    expect(details[3]).toContain('(PHT)');
  });
  it('handles older learners without details and rejects incomplete or invalid receipts', () => {
    expect(sf10EmailDetails(undefined)).toEqual([]);
    expect(sf10EmailRecord({ messageId: 'id', sentAt: receipt.sentAt })).toBeNull();
    expect(sf10EmailRecord({ ...receipt, sentAt: 'invalid' })).toBeNull();
    expect(sf10EmailRecord({ ...receipt, to: ['recipient@example.edu\r\nBcc: injected@example.edu'] })).toBeNull();
    expect(sf10EmailRecord({ ...receipt, to: [] })).toBeNull();
  });
});

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
