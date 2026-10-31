import { formatLearnerNameSurnameFirst } from './learner-sorting';
import type { RegisteredSchool } from './school-registry';
import type { CertificateTemplateId } from './certificate-preferences';

export type CertificateKind = 'good-moral' | 'enrollment';
export type RecordDocumentKind = 'sf10-request' | 'outgoing-envelope';
export type PrintableDocumentKind = CertificateKind | RecordDocumentKind;
export type PrintableKind = 'student-card' | PrintableDocumentKind;
export type CertificateLearner = Record<string, unknown> & { learnerId: string };
export const PRINTABLE_ICONS: Record<PrintableKind, string> = {
  'student-card': 'learnerCard', 'good-moral': 'moralCertificate', enrollment: 'enrollmentCertificate',
  'sf10-request': 'recordsRequest', 'outgoing-envelope': 'outgoingEnvelope',
};

export const PRINTABLES = {
  'student-card': {
    title: 'Learner Card (SF9)',
    navKey: 'student-card',
    page: 'student-card.html',
    workspace: 'print-card.html',
    button: 'Go to another page to Print Card',
    description: 'Prepare and print learner report cards with grades, attendance, and school details. Select students and adjust the card layout in the print studio.',
  },
  'good-moral': {
    title: 'Good Moral Certificate',
    navKey: 'good-moral',
    page: 'good-moral.html',
    workspace: 'print-good-moral.html',
    button: 'Go to another page to Print Good Moral',
    description: 'Prepare a Certificate of Good Moral using the school template. Select a student, review their details, and enter the verified anecdotal record before printing.',
  },
  enrollment: {
    title: 'Certificate of Enrollment',
    navKey: 'certificate-of-enrollment',
    page: 'certificate-of-enrollment.html',
    workspace: 'print-enrollment.html',
    button: 'Go to another page to Print Certificate of Enrollment',
    description: 'Prepare a Certificate of Enrollment using the school template. Student and school information fill automatically, with editable fields for any missing details.',
  },
  'sf10-request': {
    title: 'Request for Permanent Records (SF10)', navKey: 'sf10-request',
    page: 'request-permanent-records.html', workspace: 'print-sf10-request.html',
    button: 'Go to another page to Print SF10 Request',
    description: 'Request a learner’s permanent records using the supplied school letter. Select a learner, enter the previous school and enrollment details, and review the request before printing.',
  },
  'outgoing-envelope': {
    title: 'Envelope template for Outgoing Records', navKey: 'outgoing-envelope',
    page: 'outgoing-records-envelope.html', workspace: 'print-outgoing-envelope.html',
    button: 'Go to another page to Print Outgoing Envelope',
    description: 'Prepare an outgoing-records envelope with the school’s return address, recipient school, learner name, and LRN. The default envelope size is 241 × 105 mm.',
  },
} satisfies Record<PrintableKind, { title: string; navKey: string; page: string; workspace: string; button: string; description: string }>;

export interface CertificateFields {
  studentName: string;
  learnerId: string;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  conduct: string;
  issuedDate: string;
  schoolName: string;
  schoolId: string;
  address: string;
  region: string;
  division: string;
  district: string;
  schoolHead: string;
  schoolHeadPosition: string;
  contactNumber: string;
  email: string;
  fbPage: string;
  motto: string;
  divisionLogo: string;
  districtLogo: string;
  schoolLogo: string;
  zipCode: string;
  destinationSchoolName: string;
  destinationSchoolId: string;
  destinationSchoolAddress: string;
  destinationZipCode: string;
  destinationSchoolHead: string;
  previousGradeLevel: string;
  previousSchoolYear: string;
  previousAdviser: string;
  requestStage: string;
  urgent: string;
}

export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function localDateValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function certificateDate(value: string): { day: string; suffix: string; month: string; year: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()) || localDateValue(date) !== value) return null;
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return { day: String(day), suffix, month: date.toLocaleString('en-PH', { month: 'long' }), year: String(date.getFullYear()) };
}

/** Shared defaults stay tenant-specific; conduct comes only from the saved learner record. */
export function makeCertificateFields(school: RegisteredSchool | null, year: string, learner?: CertificateLearner): CertificateFields {
  const info = school?.schoolInfo;
  return {
    studentName: learner ? formatLearnerNameSurnameFirst(learner) : '',
    learnerId: text(learner?.lrn || learner?.learnerId),
    gradeLevel: text(learner?.gradeLevel).replace(/^grade\s*/i, ''),
    section: text(learner?.section),
    schoolYear: year,
    conduct: text(learner?.anecdotalRecords),
    issuedDate: localDateValue(),
    schoolName: text(school?.name),
    schoolId: text(info?.id) || text(info?.schoolId || school?.schoolId) || (/^\d{6}$/.test(text(school?.id)) ? text(school?.id) : ''),
    address: text(info?.schoolAddr) || text(info?.address) || text(school?.address),
    region: text(info?.region),
    division: text(info?.divisionOffice),
    district: text(info?.district),
    schoolHead: text(school?.schoolHead?.name),
    schoolHeadPosition: text(school?.schoolHead?.position) || 'School Head',
    contactNumber: text(info?.contactNumber),
    email: text(info?.email),
    fbPage: text(info?.fbPage),
    motto: text(info?.motto || school?.tagline),
    divisionLogo: text(info?.divisionLogoUrl) || '/assets/edash/division-ddo.png',
    districtLogo: text(info?.districtLogoUrl) || '/assets/edash/nb-district.png',
    schoolLogo: text(school?.logoUrl),
    zipCode: text(info?.zipCode),
    destinationSchoolName: text(learner?.transferSchool),
    destinationSchoolId: text(learner?.transferSchoolId),
    destinationSchoolAddress: text(learner?.transferSchoolAddress),
    destinationZipCode: text(learner?.transferSchoolZipCode),
    destinationSchoolHead: 'SCHOOL HEAD',
    previousGradeLevel: text(learner?.previousGradeLevel),
    previousSchoolYear: text(learner?.previousSchoolYear),
    previousAdviser: text(learner?.previousAdviser),
    requestStage: 'first', urgent: 'no',
  };
}

export function isRecordDocumentKind(kind: PrintableKind): kind is RecordDocumentKind {
  return kind === 'sf10-request' || kind === 'outgoing-envelope';
}

/** Envelope identity follows the source: GIVEN NAME, middle initial, then surname. */
export function envelopeLearnerName(learner?: CertificateLearner): string {
  if (!learner) return '';
  if (!text(learner.firstName) && !text(learner.lastName)) return text(learner.name);
  const initials = text(learner.middleName).split(/\s+/).filter(Boolean).map((part) => `${part[0]}.`).join(' ');
  return [text(learner.firstName), initials, text(learner.lastName), text(learner.suffix)].filter(Boolean).join(' ')
    || text(learner.name);
}

export function missingRecordDocumentFields(kind: RecordDocumentKind, fields: CertificateFields): string[] {
  const required: Array<[keyof CertificateFields, string]> = [
    ['studentName', 'Student name'], ['schoolName', 'School name'],
    ['schoolHead', 'School head'], ['destinationSchoolName', 'Recipient school'],
    ['destinationSchoolAddress', 'Recipient school address'],
  ];
  if (kind === 'sf10-request') required.push(
    ['gradeLevel', 'Current grade'], ['schoolYear', 'Current school year'],
    ['previousGradeLevel', 'Previous grade'], ['previousSchoolYear', 'Previous school year'],
    ['previousAdviser', 'Previous teacher adviser'], ['region', 'Region'], ['division', 'Division'], ['district', 'District'],
  );
  else required.push(['learnerId', 'LRN'], ['schoolId', 'School ID'], ['address', 'School address'], ['zipCode', 'School ZIP code']);
  const missing = required.filter(([key]) => !fields[key].trim()).map(([, label]) => label);
  if (!certificateDate(fields.issuedDate)) missing.push('Valid issue date');
  return missing;
}

export function missingCertificateFields(kind: CertificateKind, fields: CertificateFields, templateId: CertificateTemplateId = 'default'): string[] {
  const required: Array<[keyof CertificateFields, string]> = [
    ['studentName', 'Student name'], ['gradeLevel', 'Grade level'], ['schoolYear', 'School year'],
    ['schoolName', 'School name'], ['address', 'School address'], ['schoolHead', 'School head'],
    ['region', 'Region'], ['division', 'Division'], ['district', 'District'],
  ];
  if (kind === 'enrollment') required.push(['learnerId', 'LRN']);
  if (kind === 'enrollment' && templateId === 'sres') required.push(['schoolId', 'School ID'], ['email', 'School email']);
  if (kind === 'good-moral') required.push(['conduct', 'Verified anecdotal record']);
  const missing = required.filter(([key]) => !fields[key].trim()).map(([, label]) => label);
  if (!certificateDate(fields.issuedDate)) missing.push('Valid issue date');
  return missing;
}

export function printableWorkspaceHref(kind: PrintableKind, year: string): string {
  return `/pages/${PRINTABLES[kind].workspace}${year ? `?schoolYear=${encodeURIComponent(year)}` : ''}`;
}
