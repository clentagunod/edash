import type { CertificateExportFormat } from './certificate-export';

export interface Sf10EmailReceipt {
  messageId: string;
  sentAt: string;
}

/** Captures the attachment's original learners and school year before sending. */
export interface PreparedSf10Email {
  file: File;
  recordSent(receipt: Sf10EmailReceipt): Promise<void>;
}

export function sf10EmailLearnerIds(format: CertificateExportFormat, activeLearnerId: string, selectedLearnerIds: string[]): string[] {
  const ids = format === 'png' || !selectedLearnerIds.length ? [activeLearnerId] : selectedLearnerIds;
  return [...new Set(ids.filter(Boolean))];
}
