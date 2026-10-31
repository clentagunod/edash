import type { CertificateExportFormat } from './certificate-export';
import { parseEmailAddresses } from './gmail-send';

export interface Sf10EmailReceipt {
  messageId: string;
  sentAt: string;
  to: string[];
  cc: string[];
  bcc: string[];
}

/** Validate saved receipts without breaking older learner records that have none. */
export function sf10EmailRecord(value: unknown): Sf10EmailReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<Sf10EmailReceipt>;
  if (typeof record.messageId !== 'string' || !record.messageId.trim() || record.messageId.length > 256 ||
      typeof record.sentAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.sentAt) || !Number.isFinite(Date.parse(record.sentAt))) return null;
  if (![record.to, record.cc, record.bcc].every((list) => Array.isArray(list) && list.every((email) => typeof email === 'string'))) return null;
  try {
    const to = parseEmailAddresses(record.to!.join(','), true);
    const cc = parseEmailAddresses(record.cc!.join(','));
    const bcc = parseEmailAddresses(record.bcc!.join(','));
    if (to.length + cc.length + bcc.length > 50) return null;
    return { messageId: record.messageId.trim(), sentAt: new Date(record.sentAt).toISOString(), to, cc, bcc };
  } catch { return null; }
}

export function sf10EmailDetails(value: unknown): string[] {
  const record = sf10EmailRecord(value);
  if (!record) return [];
  const timestamp = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(record.sentAt));
  return [
    `To: ${record.to.join(', ')}`,
    ...(record.cc.length ? [`CC: ${record.cc.join(', ')}`] : []),
    ...(record.bcc.length ? [`BCC: ${record.bcc.join(', ')}`] : []),
    `Sent: ${timestamp} (PHT)`,
  ];
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
