import type { CSSProperties, ReactNode } from 'react';
import { appBrandAssetUrl } from '../lib/app-config';
import { certificateDate, type CertificateFields, type CertificateKind } from '../lib/printables';
import type { CertificateTemplateId } from '../lib/certificate-preferences';
import '../styles/components/certificate-template.css';

function Fill({ children, width }: { children: ReactNode; width?: string }) {
  return <strong className="certificate-fill" style={width ? { minWidth: width } : undefined}>{children || '\u00a0'}</strong>;
}

/** The supplied MES certificates share this letterhead, signature, and footer. */
export default function CertificateTemplate({ kind, fields, style, templateId = 'default', showSealNotice = true }: {
  kind: CertificateKind;
  fields: CertificateFields;
  style?: CSSProperties;
  templateId?: CertificateTemplateId;
  showSealNotice?: boolean;
}) {
  const sres = kind === 'enrollment' && templateId === 'sres';
  const date = certificateDate(fields.issuedDate);
  const gradeSection = [fields.gradeLevel, fields.section].filter(Boolean).join('-');
  const location = [fields.schoolName, fields.address].filter(Boolean).join(', ');
  const region = /^region\b/i.test(fields.region) ? fields.region : fields.region ? `Region ${fields.region}` : '\u00a0';
  const division = fields.division.replace(/^schools division office(?: of)?\s*/i, 'Schools Division of ');
  const district = fields.district.trim();
  const districtLabel = district && !/\bdistrict\b/i.test(district) ? `${district} District` : district;
  const motto = fields.motto.replace(/^[“”"]|[“”"]$/g, '').trim();
  const logos = [
    ['/assets/edash/deped-logo.png', 'Department of Education'],
    ['/assets/edash/bagong-pilipinas.png', 'Bagong Pilipinas'],
    [fields.divisionLogo, 'Division logo'],
    [fields.districtLogo, 'District logo'],
    [fields.schoolLogo, 'School logo'],
  ];

  return <article className={`certificate-document certificate-document--${kind}${sres ? ' certificate-document--sres' : ''}`} data-template={sres ? 'sres' : 'default'} style={style} aria-label={kind === 'good-moral' ? 'Certificate of Good Moral' : 'Certificate of Enrollment'}>
    <header className="certificate-letterhead">
      <img className="certificate-deped-seal" src="/assets/edash/deped-seal.png" alt="Republic of the Philippines Department of Education seal" />
      {/* Rendered from the supplied template so Office-only fonts stay consistent on every device. */}
      <img className="certificate-deped-heading" src="/assets/edash/certificate-deped-heading.png" alt="Republic of the Philippines — Department of Education" />
      <p className="certificate-region">{region}</p>
      <p className="certificate-division">{division || '\u00a0'}</p>
      <p className="certificate-district">{districtLabel || '\u00a0'}</p>
    </header>
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
      </> : <><div className="certificate-footer-logos">{logos.map(([src, alt]) => src
        ? <img key={alt} src={appBrandAssetUrl(src)} alt={alt} />
        : <span key={alt} className="certificate-logo-space" />)}</div>
      <div className="certificate-contact">
        <p>School facebook Page: {fields.fbPage}</p>
        <p>Email address: {fields.email}</p>
        <p>Contact Number: {fields.contactNumber}</p>
        {motto && <p className="certificate-motto">{motto === 'Cabin of Potential Talents'
          ? <img src="/assets/edash/certificate-mes-motto.png" alt="Cabin of Potential Talents" />
          : `“${motto}”`}</p>}
      </div></>}
    </footer>
  </article>;
}
