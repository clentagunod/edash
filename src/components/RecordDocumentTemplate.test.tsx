import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/app-config', () => ({ appBrandAssetUrl: (value: string) => value }));
import RecordDocumentTemplate, { addressWithZip } from './RecordDocumentTemplate';
import { envelopeLearnerName, makeCertificateFields } from '../lib/printables';

const fields = {
  ...makeCertificateFields(null, '2026-2027'), studentName: 'Alex M. Cruz', learnerId: '123456789012',
  gradeLevel: '6', previousGradeLevel: '5', previousSchoolYear: '2025-2026', previousAdviser: 'Taylor Reyes',
  schoolName: 'Example Elementary School', schoolId: '123456', schoolHead: 'Jordan Cruz', schoolHeadPosition: 'School Head',
  address: 'Example Town', zipCode: '0123', region: 'XI', destinationSchoolName: 'Recipient School',
  destinationSchoolAddress: 'Recipient Town', destinationSchoolId: '654321',
};
describe('supplied records templates', () => {
  it('keeps the SF10 wording, grouped table headings, placement fields, and request indicators', () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<RecordDocumentTemplate kind="sf10-request" fields={fields} />), 'text/html');
    expect(doc.body.textContent).toContain('DepEd Form 137-E or School Form 10 Learners Permanent Record, ECCD, Progress Report Card, Birth Certificate, and other attachments');
    expect([...doc.querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual(['Alex M. Cruz', '6', '2026-2027', '5', '2025-2026', 'Taylor Reyes']);
    expect(doc.querySelector('.record-sf10-priority')?.textContent).toContain('1st Request');
    expect(doc.querySelectorAll('.certificate-footer-logos img')).toHaveLength(4);
  });
  it('uses given-name/middle-initial identity and ZIP codes without duplicating the address suffix', () => {
    expect(envelopeLearnerName({ learnerId: '123', firstName: 'Alex', middleName: 'Miguel', lastName: 'Cruz' })).toBe('Alex M. Cruz');
    expect(addressWithZip('Example Town, 0123', '0123')).toBe('Example Town, 0123');
    const html = renderToStaticMarkup(<RecordDocumentTemplate kind="outgoing-envelope" fields={fields} />);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('.record-envelope-student')?.textContent).toBe('ALEX M. CRUZ123456789012');
    expect(doc.querySelector('.record-envelope-sender')?.textContent).toContain('Example Town, Region XI, 0123');
    expect(doc.querySelector('.record-envelope-recipient')?.textContent).toContain('654321 - Recipient School');
    expect(html).not.toContain('JAREN');
    expect(doc.querySelector('.certificate-letterhead')).toBeNull();
  });
});
