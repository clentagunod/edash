import { cleanText, isUnavailableContact, nameCase } from './schema';
import type { StudentRecord } from './types';

/** Recognize generational suffixes without treating arbitrary name endings as suffixes. */
function knownSuffix(value: unknown, embedded = false): string | undefined {
  const text = cleanText(value).replace(/^\((.*)\)$/, '$1').trim();
  const key = text.replace(/[.\s]/g, '').toLowerCase();
  if (['jr', 'jnr', 'junior'].includes(key)) return 'Jr.';
  if (['sr', 'snr', 'senior'].includes(key)) return 'Sr.';
  const roman = text.replace(/\./g, '').toUpperCase();
  // Single letters in name components may be initials. A dedicated suffix column
  // or the fourth comma-separated part can explicitly supply I, V, X, etc.
  if (!roman || (embedded && roman.length === 1)) return;
  if (/^(?:X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman)) return roman;
}

export function normalizeNameSuffix(value: unknown): string {
  if (isUnavailableContact(value)) return '';
  const suffix = knownSuffix(value) || cleanText(value);
  if (suffix.length > 32) throw new Error('Name suffix exceeds 32 characters.');
  return suffix;
}

/** Strip only complete trailing tokens; never split compound surnames or given names. */
function takeTrailingSuffixes(value: string, accept: (suffix: string) => void): string {
  let name = value;
  for (;;) {
    const match = name.match(/^(.*?)(?:\s*,\s*|\s+)(\([^()]+\)|[^,\s]+)$/u);
    if (!match || !cleanText(match[1])) return name;
    const suffix = knownSuffix(match[2], true);
    if (!suffix) return name;
    accept(suffix);
    name = cleanText(match[1]);
  }
}

/** Keep surname/given-name anchors; recognize suffix components before placing the middle name. */
function readCommaName(value: string, accept: (suffix: string) => void) {
  const parts = value.split(',').map(cleanText);
  while (parts.length > 2 && !parts[parts.length - 1]) parts.pop();
  const formatError = () => new Error('Full name needs "Last Name, First Name, Middle Name[, Suffix]" or "Last Name, First Name, Suffix, Middle Name", or separate First name and Last name columns.');
  if (parts.length < 2) throw formatError();

  const remaining: string[] = [];
  let foundSuffix = false;
  for (const part of parts.slice(2)) {
    const detected = knownSuffix(part, true);
    if (detected) {
      accept(detected);
      foundSuffix = true;
    } else remaining.push(part);
  }
  // Retain the explicit fourth-slot convention for custom suffixes and single
  // Roman letters. A recognized suffix elsewhere takes precedence over position.
  if (!foundSuffix && parts.length === 4) {
    const explicit = normalizeNameSuffix(remaining.pop());
    if (explicit) accept(explicit);
  }
  if (remaining.length > 1) throw formatError();
  return {
    lastName: parts[0], firstName: parts[1], middleName: remaining[0] || '',
    needsMiddleNameReview: !remaining[0] && parts[1].includes(' '),
  };
}

/** Normalize both SF1 surname-first names and independently labelled name fields. */
export function normalizeStudentName(record: StudentRecord): { needsMiddleNameReview: boolean } {
  let suffix = normalizeNameSuffix(record.suffix);
  const accept = (detected: string) => {
    if (suffix && suffix.toLowerCase() !== detected.toLowerCase()) {
      throw new Error(`Conflicting name suffixes (${suffix} / ${detected}). Correct the name or suffix column before importing.`);
    }
    suffix = detected;
  };
  let needsMiddleNameReview = false;
  if (record.name && !(record.firstName && record.lastName)) {
    const name = readCommaName(String(record.name), accept);
    record.lastName ||= nameCase(name.lastName);
    record.firstName ||= nameCase(name.firstName);
    if (name.middleName) record.middleName ||= nameCase(name.middleName);
    needsMiddleNameReview = name.needsMiddleNameReview;
  } else if (record.name) {
    // Exported JSON can contain both separate fields and a composed display name.
    // Its suffix still participates in conflict detection and duplicate removal.
    if (String(record.name).includes(',')) readCommaName(String(record.name), accept);
    else takeTrailingSuffixes(String(record.name), accept);
  }
  for (const field of ['firstName', 'middleName', 'lastName'] as const) {
    if (!record[field]) continue;
    const name = cleanText(record[field]);
    // A standalone suffix in the middle-name slot is common in three-part SF1 names.
    const standalone = field === 'middleName' ? knownSuffix(name, true) : undefined;
    if (standalone) {
      accept(standalone);
      delete record[field];
    } else record[field] = nameCase(takeTrailingSuffixes(name, accept));
  }
  if (suffix) record.suffix = suffix;
  else delete record.suffix;
  return { needsMiddleNameReview };
}
