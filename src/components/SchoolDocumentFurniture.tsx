import { appBrandAssetUrl } from '../lib/app-config';
import type { CertificateFields } from '../lib/printables';

export function SchoolDocumentLetterhead({ fields }: { fields: CertificateFields }) {
  const region = /^region\b/i.test(fields.region) ? fields.region : fields.region ? `Region ${fields.region}` : '\u00a0';
  const division = fields.division.replace(/^schools division office(?: of)?\s*/i, 'Schools Division of ');
  const district = fields.district.trim();
  return <header className="certificate-letterhead">
    <img className="certificate-deped-seal" src="/assets/edash/deped-seal.png" alt="Republic of the Philippines Department of Education seal" />
    <img className="certificate-deped-heading" src="/assets/edash/certificate-deped-heading.png" alt="Republic of the Philippines — Department of Education" />
    <p className="certificate-region">{region}</p>
    <p className="certificate-division">{division || '\u00a0'}</p>
    <p className="certificate-district">{district && !/\bdistrict\b/i.test(district) ? `${district} District` : district || '\u00a0'}</p>
  </header>;
}

export function SchoolDocumentFooterContents({ fields }: { fields: CertificateFields }) {
  const motto = fields.motto.replace(/^[“”"]|[“”"]$/g, '').trim();
  const logos = [
    ['/assets/edash/deped-logo.png', 'Department of Education'],
    ['/assets/edash/bagong-pilipinas.png', 'Bagong Pilipinas'],
    [fields.divisionLogo, 'Division logo'], [fields.districtLogo, 'District logo'], [fields.schoolLogo, 'School logo'],
  ];
  return <>
    <div className="certificate-footer-logos">{logos.map(([src, alt]) => src
      ? <img key={alt} src={appBrandAssetUrl(src)} alt={alt} /> : <span key={alt} className="certificate-logo-space" />)}</div>
    <div className="certificate-contact">
      <p>School facebook Page: {fields.fbPage}</p>
      <p>Email address: {fields.email}</p>
      <p>Contact Number: {fields.contactNumber}</p>
      {motto && <p className="certificate-motto">{motto === 'Cabin of Potential Talents'
        ? <img src="/assets/edash/certificate-mes-motto.png" alt="Cabin of Potential Talents" /> : `“${motto}”`}</p>}
    </div>
  </>;
}
