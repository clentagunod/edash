import type { CSSProperties, ReactNode } from 'react';
import { appBrandAssetUrl } from '../lib/app-config';
import { certificateDate, type CertificateFields, type CertificateKind } from '../lib/printables';
import type { CertificateTemplateId } from '../lib/certificate-preferences';
import { SchoolDocumentLetterhead, SchoolDocumentFooterContents } from './SchoolDocumentFurniture';
import '../styles/components/certificate-template.css';

function Fill({ children, width }: { children: ReactNode; width?: string }) {
  return <strong className="certificate-fill" style={width ? { minWidth: width } : undefined}>{children || '\u00a0'}</strong>;
}

/** The supplied MES certificates share this letterhead, signature, and footer. */
export default function CertificateTemplate({ kind, fields, style, templateId = 'default', showSealNotice = true, children }: {
  kind: CertificateKind;
  fields: CertificateFields;
  style?: CSSProperties;
  templateId?: CertificateTemplateId;
  showSealNotice?: boolean;
  children?: ReactNode;
}) {
  const sres = kind === 'enrollment' && templateId === 'sres';
  const date = certificateDate(fields.issuedDate);
  const gradeSection = [fields.gradeLevel, fields.section].filter(Boolean).join('-');
  const location = [fields.schoolName, fields.address].filter(Boolean).join(', ');
  const motto = fields.motto.replace(/^[“”"]|[“”"]$/g, '').trim();


  return <article className={`certificate-document certificate-document--${kind}${sres ? ' certificate-document--sres' : ''}`} data-template={sres ? 'sres' : 'default'} style={style} aria-label={kind === 'good-moral' ? 'Certificate of Good Moral' : 'Certificate of Enrollment'}>
    {children}
    <SchoolDocumentLetterhead fields={fields} />
    <h1>CERTIFICATE OF {kind === 'good-moral' ? 'GOOD MORAL' : 'ENROLLMENT'}</h1>
    <div className="certificate-body">
      {kind === 'good-moral' ? <>
        <p className="certificate-salutation">TO WHOM IT MAY CONCERN:</p>
        <p>This is to certify that <Fill width="71mm">{fields.studentName}</Fill> is a bonafide Grade <Fill width="34mm">{gradeSection}</Fill> of this school, School Year <Fill width="31mm">{fields.schoolYear}</Fill>.</p>
        <p>This further certifies that he/she has <Fill width="61mm">{fields.conduct}</Fill> during his/her entire studies in this school.</p>
        <p>This certification is being issued upon his/her request for whatever legal purpose it may serve.</p>
      </> : <>
        <p>This is to certify that <Fill width="71mm">{fields.studentName}</Fill>, with LRN <Fill width="42mm">{fields.learnerId}</Fill>, a Grade <Fill width="36mm">{gradeSection}</Fill> student, is officially enrolled in this School, {location || '____________________'}, School Year <strong>{fields.schoolYear || '_____________'}</strong>.</p>
        <p>The student is in good standing and this certification is issued upon the request of the above-mentioned name for whatever legal purpose it may serve.</p>
      </>}
      <p>Issued this {date ? <>{date.day}<sup>{date.suffix}</sup> day of {date.month}{kind === 'good-moral' ? ', ' : ' '}{date.year}</> : '_______ day of _______________, _______'} at {location || '____________________'}.</p>
      <div className="certificate-signature"><strong>{fields.schoolHead.toUpperCase() || '\u00a0'}</strong><span>{fields.schoolHeadPosition}</span></div>
    </div>
    <p className="certificate-seal-note">{showSealNotice ? 'Not valid without school seal' : '\u00a0'}</p>
    <footer className="certificate-footer">
      {sres ? <>
        <div className="certificate-sres-logo">{fields.schoolLogo && <img src={appBrandAssetUrl(fields.schoolLogo)} alt="School logo" />}</div>
        <div className="certificate-sres-contact">
          <p className="certificate-sres-school">{fields.schoolName.toUpperCase()}</p>
          <p>ID: {fields.schoolId || '____________'}{fields.email && <> &nbsp; Email Address: {fields.email}</>}</p>
          {motto && <p className="certificate-motto">“{motto}”</p>}
        </div>
      </> : <SchoolDocumentFooterContents fields={fields} />}
    </footer>
  </article>;
}
