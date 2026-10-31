import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ requireAuth: vi.fn().mockResolvedValue({ uid: 'user' }), loginPageUrl: vi.fn() }));
vi.mock('../lib/firebase', () => ({ auth: { currentUser: { uid: 'user' }, onAuthStateChanged: vi.fn(() => vi.fn()) } }));
vi.mock('../lib/shell', () => ({ applySavedTheme: vi.fn() }));
vi.mock('../lib/app-config', () => ({ APP_CONFIG: { schoolId: 'school-a' }, isSchoolAdmin: () => false, appDocumentTitle: (value: string) => value, appBrandAssetUrl: (value: string) => value }));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => null, getRegisteredSchools: vi.fn() }));
vi.mock('../lib/firestore-api', () => ({ fsGetSchoolYears: vi.fn(), fsGetLearners: vi.fn(), fsGetArchiveRecords: vi.fn(), fsSubscribeCertificatePreferences: vi.fn(), fsSubscribeRecordDocumentPreferences: vi.fn(), fsMarkSf10RequestEmailed: vi.fn() }));
vi.mock('../lib/certificate-export', () => ({ exportCertificateSheets: vi.fn().mockResolvedValue(undefined), prepareCertificateSheets: vi.fn().mockResolvedValue(undefined), createCertificateFile: vi.fn() }));
vi.mock('../lib/gmail-send', async (original) => ({ ...await original<typeof import('../lib/gmail-send')>(), gmailClientId: () => 'client-id', loadGoogleIdentity: async () => {}, connectGmail: vi.fn(), sendGmailMessage: vi.fn() }));

import PrintCertificatePage from './PrintCertificatePage';
import CertificateTemplate from '../components/CertificateTemplate';
import { fsGetLearners, fsGetArchiveRecords, fsGetSchoolYears, fsSubscribeCertificatePreferences, fsSubscribeRecordDocumentPreferences, fsMarkSf10RequestEmailed } from '../lib/firestore-api';
import { normalizeRecordDocumentPreferences } from '../lib/record-document-preferences';
import { normalizeCertificatePreferences, type CertificatePreferences } from '../lib/certificate-preferences';
import { getRegisteredSchools, type RegisteredSchool } from '../lib/school-registry';
import { makeCertificateFields, missingCertificateFields, certificateDate, printableWorkspaceHref } from '../lib/printables';
import { createCertificateFile, exportCertificateSheets } from '../lib/certificate-export';
import { connectGmail, sendGmailMessage } from '../lib/gmail-send';

const school = {
  id: 'school-a', name: 'Example Elementary School', logoUrl: '/assets/edash/edash.png',
  schoolInfo: { id: '123456', region: 'XI', divisionOffice: 'Schools Division Office of Example', district: 'Example District', schoolAddr: 'Example Town', zipCode: '8804', address: 'Legacy address', contactNumber: '09123456789', email: 'school@example.test', fbPage: 'Example School', motto: 'Learn together' },
  schoolHead: { name: 'Jordan Reyes', position: 'Principal' },
} as RegisteredSchool;
const students = [
  { learnerId: '123', firstName: 'Alex', lastName: 'Cruz', gradeLevel: 'Grade 4', section: 'Diamond', transferType: 'Transfer In', transferIn: true },
  { learnerId: '456', firstName: 'Taylor', lastName: 'Santos', gradeLevel: 'Grade 5', section: 'Pearl' },
];
let root: Root;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.mocked(connectGmail).mockResolvedValue({ token: 'token', email: 'sender@gmail.com', expiresAt: Date.now() + 10000 });
  vi.mocked(sendGmailMessage).mockResolvedValue('confirmed-id');
  vi.mocked(createCertificateFile).mockResolvedValue(new File(['document'], 'sf10.pdf', { type: 'application/pdf' }));
  vi.mocked(fsMarkSf10RequestEmailed).mockResolvedValue(undefined);
  vi.mocked(fsGetSchoolYears).mockResolvedValue([{ schoolYear: '2026-2027', isCurrent: true }, { schoolYear: '2025-2026' }] as never);
  vi.mocked(fsGetLearners).mockResolvedValue(students);
  vi.mocked(fsGetArchiveRecords).mockResolvedValue([]);
  vi.mocked(fsSubscribeRecordDocumentPreferences).mockImplementation((next) => { next(normalizeRecordDocumentPreferences()); return vi.fn(); });
  vi.mocked(getRegisteredSchools).mockResolvedValue([school]);
  vi.mocked(fsSubscribeCertificatePreferences).mockImplementation((next) => { next(normalizeCertificatePreferences()); return vi.fn(); });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.removeAttribute('data-theme');
  vi.clearAllMocks();
  vi.mocked(fsGetLearners).mockReset();
});

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent?.includes(label));
  if (!result) throw new Error(`Button missing: ${label}`);
  return result;
}
function input(label: string) {
  const result = [...container.querySelectorAll('label')].filter((entry) => entry.querySelector('span')?.textContent === label).map((entry) => entry.querySelector<HTMLInputElement>('input')).find(Boolean);
  if (!result) throw new Error(`Input missing: ${label}`);
  return result;
}
function changeInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('certificate student information and output', () => {
  it.each(['pdf', 'png'] as const)('tracks exactly the learners in a successfully emailed %s attachment', async (format) => {
    vi.mocked(fsGetLearners).mockResolvedValue(students.map((student) => ({ ...student,
      transferType: 'Transfer In', transferIn: true, transferSchool: 'Previous School', transferSchoolAddress: 'Previous Town',
      previousGradeLevel: '3', previousSchoolYear: '2025-2026', previousAdviser: 'Previous Teacher',
    })));
    await act(async () => root.render(<PrintCertificatePage kind="sf10-request" />));
    act(() => button('Select filtered').click());
    act(() => button('Cruz, Alex').click());
    await act(async () => button('Send with Gmail').click());
    await act(async () => button('Connect Gmail').click());
    const recipient = container.querySelector<HTMLInputElement>('.sf10-email-dialog label input')!;
    changeInput(recipient, 'records@example.edu');
    const type = container.querySelector<HTMLSelectElement>('.sf10-email-dialog select')!;
    act(() => { type.value = format; type.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(fsMarkSf10RequestEmailed).not.toHaveBeenCalled();
    await act(async () => container.querySelector('.sf10-email-dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fsMarkSf10RequestEmailed).toHaveBeenCalledWith('2026-2027', format === 'png' ? ['123'] : ['123', '456'], { messageId: 'confirmed-id', sentAt: expect.any(String), to: ['records@example.edu'], cc: [], bcc: [] }, 'user');
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
  });
  it('autofills SF10 recipient information from the persisted Transfer In school', async () => {
    vi.mocked(fsGetLearners).mockResolvedValue([{ ...students[0], transferSchoolId: '001234', transferSchool: 'Previous School', transferSchoolAddress: 'Previous Town', transferSchoolZipCode: '0010', previousGradeLevel: '3', previousSchoolYear: '2025-2026', previousAdviser: 'Previous Teacher' }, students[1]]);
    await act(async () => root.render(<PrintCertificatePage kind="sf10-request" />));
    act(() => button('Cruz, Alex').click());
    expect(input('Recipient school ID').value).toBe('001234');
    expect(input('Recipient school name').value).toBe('Previous School');
    expect(input('Recipient school address').value).toBe('Previous Town');
    expect(input('Recipient ZIP code').value).toBe('0010');
    expect(container.querySelector('.certificate-student-list')?.textContent).not.toContain('Santos, Taylor');
  });

  it('uses the envelope preset, school ZIP code, and transferred-out learner records', async () => {
    vi.mocked(fsGetArchiveRecords).mockResolvedValue([{ learnerId: '789', firstName: 'Sam', middleName: 'Miguel', lastName: 'Reyes', transferSchool: 'Recipient School', transferSchoolAddress: 'Recipient Town' }]);
    await act(async () => root.render(<PrintCertificatePage kind="outgoing-envelope" />));
    act(() => button('Reyes, Sam').click());
    expect(fsGetArchiveRecords).toHaveBeenCalledWith('transferredOut', '2026-2027');
    expect(input('Student name').value).toBe('Sam M. Reyes');
    expect(container.querySelector<HTMLSelectElement>('.certificate-toolbar select')?.value).toBe('envelope');
    expect(container.querySelector('.record-envelope-sender')?.textContent).toContain('8804');
    expect(button('Print document').disabled).toBe(false);
    expect(container.querySelector('.certificate-student-list')?.textContent).not.toContain('Cruz, Alex');
    expect(container.querySelector('.certificate-student-list')?.textContent).not.toContain('Santos, Taylor');
  });

  it('fills the SF10 current and previous enrollment columns and keeps A4 as default', async () => {
    await act(async () => root.render(<PrintCertificatePage kind="sf10-request" />));
    act(() => button('Cruz, Alex').click());
    expect(button('Print document').disabled).toBe(true);
    changeInput(input('Recipient school name'), 'Recipient School');
    changeInput(input('Recipient school address'), 'Recipient Town');
    changeInput(input('Previous grade'), '3');
    changeInput(input('Previous school year'), '2025-2026');
    changeInput(input('Previous teacher adviser'), 'Taylor Reyes');
    expect([...container.querySelectorAll('.certificate-preview-stage tbody td')].map((cell) => cell.textContent)).toEqual(['Cruz, Alex', '4', '2026-2027', '3', '2025-2026', 'Taylor Reyes']);
    expect(container.querySelector<HTMLSelectElement>('.certificate-toolbar select')?.value).toBe('a4');
    expect(button('Print document').disabled).toBe(false);
    expect(container.querySelector('.certificate-student-list')?.textContent).not.toContain('Santos, Taylor');
  });

  it('keeps a running export on one template when the admin changes preferences', async () => {
    let receive: (value: CertificatePreferences) => void;
    let finish: () => void;
    vi.mocked(fsSubscribeCertificatePreferences).mockImplementation((next) => { receive = next; next(normalizeCertificatePreferences()); return vi.fn(); });
    vi.mocked(exportCertificateSheets).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    act(() => button('Cruz, Alex').click());
    await act(async () => button('Download PDF').click());
    act(() => receive!(normalizeCertificatePreferences({ templates: { enrollment: { defaultTemplate: 'sres', allowTeacherTemplateChoice: false } } })));
    expect(container.querySelector('.certificate-print-source .certificate-document')?.getAttribute('data-template')).toBe('default');
    await act(async () => finish!());
    expect(container.querySelector('.certificate-print-source .certificate-document')?.getAttribute('data-template')).toBe('sres');
  });

  it('applies saved defaults, template changes, and school-detail restrictions to preview and every output sheet', async () => {
    let receive: (value: CertificatePreferences) => void;
    const unsubscribe = vi.fn();
    vi.mocked(fsSubscribeCertificatePreferences).mockImplementation((next) => {
      receive = next;
      next(normalizeCertificatePreferences({ defaultPaperSize: 'letter', defaultOrientation: 'landscape' }));
      return unsubscribe;
    });
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    act(() => button('Cruz, Alex').click());
    const templateSelect = [...container.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === 'Certificate template')!.querySelector('select')!;
    expect(templateSelect.options).toHaveLength(2);
    act(() => { templateSelect.value = 'sres'; templateSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    expect([...container.querySelectorAll('.certificate-document')].every((element) => element.getAttribute('data-template') === 'sres')).toBe(true);
    expect(container.querySelector('.certificate-sres-school')?.textContent).toBe('EXAMPLE ELEMENTARY SCHOOL');
    await act(async () => button('Download PDF').click());
    expect(exportCertificateSheets).toHaveBeenCalledWith(expect.objectContaining({ width: 279.4, height: 215.9, orientation: 'landscape' }));
    changeInput(input('School address'), 'Temporary address');
    act(() => receive!(normalizeCertificatePreferences({ allowSchoolDetailsOverride: false, showSealNotice: false, templates: { enrollment: { enabledTemplates: ['default'], defaultTemplate: 'default', allowTeacherTemplateChoice: false } } })));
    expect(templateSelect.value).toBe('default');
    expect(templateSelect.disabled).toBe(true);
    expect(input('School address').readOnly).toBe(true);
    expect(input('School address').value).toBe('Example Town');
    expect(container.textContent).not.toContain('Not valid without school seal');
    expect(container.querySelector('.certificate-document')?.getAttribute('data-template')).toBe('default');
    act(() => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('blocks output when preferences fail and recovers using the retry action', async () => {
    vi.mocked(fsSubscribeCertificatePreferences).mockImplementationOnce((_next, failure) => { failure(new Error('Permission denied')); return vi.fn(); });
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    expect(container.textContent).toContain('Certificate preferences could not be loaded');
    expect(button('Download current PNG').disabled).toBe(true);
    expect(button('Print certificate').disabled).toBe(true);
    await act(async () => button('Retry certificate preferences').click());
    act(() => button('Cruz, Alex').click());
    expect(button('Print certificate').disabled).toBe(false);
  });

  it('autofills school contacts and keeps student overrides separate while switching students', async () => {
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    act(() => button('Cruz, Alex').click());
    expect(input('Student name').value).toBe('Cruz, Alex');
    expect(input('Grade level').value).toBe('4');
    expect(input('Email address').value).toBe('school@example.test');
    expect(input('School address').value).toBe('Example Town');
    changeInput(input('Student name'), 'Cruz, Alexandra');
    changeInput(input('School address'), 'Updated Town');
    act(() => button('Santos, Taylor').click());
    expect(input('Student name').value).toBe('Santos, Taylor');
    expect(input('School address').value).toBe('Updated Town');
    act(() => button('Cruz, Alex').click());
    expect(input('Student name').value).toBe('Cruz, Alexandra');
    act(() => button("Reset this student's").click());
    expect(input('Student name').value).toBe('Cruz, Alex');
  });

  it('requires a verified conduct entry and does not copy it to another student', async () => {
    await act(async () => root.render(<PrintCertificatePage kind="good-moral" />));
    act(() => button('Cruz, Alex').click());
    expect(button('Print certificate').disabled).toBe(true);
    changeInput(container.querySelector('textarea')!, 'no recorded disciplinary violations');
    expect(button('Print certificate').disabled).toBe(false);
    act(() => button('Santos, Taylor').click());
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(button('Print certificate').disabled).toBe(true);
  });

  it('loads saved Anecdotal Records for Good Moral without carrying them to another learner', async () => {
    vi.mocked(fsGetLearners).mockResolvedValue([{ ...students[0], anecdotalRecords: 'no recorded disciplinary violations' }, students[1]]);
    await act(async () => root.render(<PrintCertificatePage kind="good-moral" />));
    act(() => button('Cruz, Alex').click());
    expect(container.querySelector('textarea')?.value).toBe('no recorded disciplinary violations');
    expect(button('Print certificate').disabled).toBe(false);
    act(() => button('Santos, Taylor').click());
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(button('Print certificate').disabled).toBe(true);
  });

  it('exports selected students as separate sheets while PNG uses the active student', async () => {
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    const checkboxes = container.querySelectorAll<HTMLInputElement>('.certificate-student input');
    act(() => { checkboxes[0].click(); checkboxes[1].click(); });
    expect(container.querySelectorAll('.certificate-print-source .certificate-sheet')).toHaveLength(2);
    await act(async () => button('Download PDF').click());
    expect(exportCertificateSheets).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'pdf', width: 210, height: 297, sheets: expect.any(Array) }));
    expect(vi.mocked(exportCertificateSheets).mock.calls[0][0].sheets).toHaveLength(2);
    await act(async () => button('Download current PNG').click());
    const png = vi.mocked(exportCertificateSheets).mock.calls[1][0];
    expect(png.sheets).toHaveLength(1);
    expect(png.sheets[0].textContent).toContain('Santos, Taylor');
  });

  it('never reuses a different year draft', async () => {
    let resolveOld: (value: typeof students) => void;
    vi.mocked(fsGetLearners).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    const select = container.querySelector<HTMLSelectElement>('.certificate-editor .certificate-field select')!;
    await act(async () => resolveOld!(students));
    act(() => button('Cruz, Alex').click());
    changeInput(input('Student name'), 'Current-year correction');
    vi.mocked(fsGetLearners).mockResolvedValueOnce([{ ...students[0], firstName: 'Earlier Alex' }]);
    await act(async () => { select.value = '2025-2026'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => button('Cruz, Earlier Alex').click());
    expect(input('Student name').value).toBe('Cruz, Earlier Alex');
    expect(input('School year on certificate').value).toBe('2025-2026');
  });

  it('reports load errors and supports retry without offering stale certificates', async () => {
    vi.mocked(fsGetLearners).mockRejectedValueOnce(new Error('Records unavailable'));
    await act(async () => root.render(<PrintCertificatePage kind="enrollment" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Records unavailable');
    expect(button('Print certificate').disabled).toBe(true);
    vi.mocked(fsGetLearners).mockResolvedValueOnce(students);
    await act(async () => button('Retry loading students').click());
    expect(container.querySelectorAll('.certificate-student')).toHaveLength(2);
  });
});

describe('certificate template and tenant defaults', () => {
  it('prefers schoolInfo.id for the official school ID, including numeric values', () => {
    expect(makeCertificateFields({ ...school, schoolInfo: { ...school.schoolInfo!, id: 128528, schoolId: 'legacy-id' } }, '').schoolId).toBe('128528');
    expect(makeCertificateFields({ ...school, schoolInfo: { ...school.schoolInfo!, id: '001234' } }, '').schoolId).toBe('001234');
    expect(makeCertificateFields({ ...school, schoolInfo: { ...school.schoolInfo!, id: undefined, schoolId: 'legacy-id' } }, '').schoolId).toBe('legacy-id');
  });
  it('renders the supplied SRES layout with dynamic school identity and template-specific requirements', () => {
    const fields = makeCertificateFields(school, '2026-2027', students[0]);
    container.innerHTML = renderToStaticMarkup(<CertificateTemplate kind="enrollment" fields={fields} templateId="sres" showSealNotice={false} />);
    expect(container.querySelector('.certificate-footer')?.textContent).toContain('ID: 123456');
    expect(container.querySelector('.certificate-footer')?.textContent).toContain('Email Address: school@example.test');
    expect(container.querySelector('.certificate-footer-logos')).toBeNull();
    expect(container.textContent).not.toMatch(/SIENES|JENNIE|128528|Not valid without school seal/);
    expect(missingCertificateFields('enrollment', { ...fields, schoolId: '', email: '' }, 'sres')).toEqual(['School ID', 'School email']);
  });
  it('uses tenant identity and the requested footer logo order without sample student data', () => {
    const fields = makeCertificateFields(school, '2026-2027', students[0]);
    const html = renderToStaticMarkup(<CertificateTemplate kind="enrollment" fields={fields} />);
    container.innerHTML = html;
    expect(container.textContent).toContain('is officially enrolled in this School, Example Elementary School, Example Town');
    expect(container.textContent).toContain('Contact Number: 09123456789');
    expect(container.querySelector('.certificate-district')?.textContent).toBe('Example District');
    expect([...container.querySelectorAll('.certificate-footer-logos img')].map((img) => img.getAttribute('src'))).toEqual(['/assets/edash/deped-logo.png', '/assets/edash/bagong-pilipinas.png', '/assets/edash/division-ddo.png', '/assets/edash/nb-district.png', '/assets/edash/edash.png']);
    expect(html).not.toContain('128278200038');
    expect(html).not.toContain('LEOFIL');
    for (const kind of ['good-moral', 'enrollment'] as const) {
      const districtHtml = renderToStaticMarkup(<CertificateTemplate kind={kind} fields={{ ...fields, district: 'New Bataan' }} />);
      container.innerHTML = districtHtml;
      expect(container.querySelector('.certificate-district')?.textContent).toBe('New Bataan District');
    }
  });

  it('leaves missing information blank, validates real dates, and accepts manual certificate fields', () => {
    const fields = makeCertificateFields(null, '');
    expect(fields.conduct).toBe('');
    expect(missingCertificateFields('good-moral', fields)).toContain('Verified anecdotal record');
    expect(missingCertificateFields('enrollment', fields)).toContain('LRN');
    expect(certificateDate('2026-02-30')).toBeNull();
    expect(certificateDate('2026-08-11')?.suffix).toBe('th');
    expect(certificateDate('2026-08-21')?.suffix).toBe('st');
    expect(printableWorkspaceHref('student-card', '2026-2027')).toBe('/pages/print-card.html?schoolYear=2026-2027');
  });
});
