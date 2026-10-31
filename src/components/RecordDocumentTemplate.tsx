import type { CSSProperties, ReactNode } from 'react';
import { certificateDate, type CertificateFields, type RecordDocumentKind } from '../lib/printables';
import { SchoolDocumentFooterContents, SchoolDocumentLetterhead } from './SchoolDocumentFurniture';
import '../styles/components/certificate-template.css';
import '../styles/components/record-document-template.css';

export function addressWithZip(address: string, zip: string): string {
  const clean = address.trim(), code = zip.trim();
  return code && !clean.endsWith(code) ? [clean, code].filter(Boolean).join(', ') : clean;
}

export default function RecordDocumentTemplate({ kind, fields, style, textSize = 100, children }: {
  kind: RecordDocumentKind; fields: CertificateFields; style?: CSSProperties; textSize?: number; children?: ReactNode;
}) {
  const date = certificateDate(fields.issuedDate);
  const dateText = date ? `${date.month} ${date.day}, ${date.year}` : '';
  const destinationSchool = [fields.destinationSchoolId, fields.destinationSchoolName].filter(Boolean).join(' - ');
  const destinationAddress = addressWithZip(fields.destinationSchoolAddress, fields.destinationZipCode);
  const envelope = kind === 'outgoing-envelope';
  const senderSchool = [fields.schoolId, fields.schoolName].filter(Boolean).join(' - ');
  const region = /^region\b/i.test(fields.region) ? fields.region : fields.region ? `Region ${fields.region}` : '';
  const zip = fields.zipCode.trim();
  const senderStreet = zip && fields.address.trim().endsWith(zip)
    ? fields.address.trim().slice(0, -zip.length).replace(/[,\s]+$/, '') : fields.address.trim();
  const senderAddress = addressWithZip([senderStreet, region && !senderStreet.toLowerCase().includes(region.toLowerCase()) ? region : ''].filter(Boolean).join(', '), zip);
  const recordStyle = { ...style, '--document-text-scale': textSize / 100 } as CSSProperties;

  return <article className={`certificate-document record-document record-document--${kind}`} data-document-layout={envelope ? 'envelope' : 'letter'} style={recordStyle} aria-label={envelope ? 'Envelope template for Outgoing Records' : 'Request for Permanent Records (SF10)'}>
    {children}
    {!envelope && <SchoolDocumentLetterhead fields={fields} />}
    {envelope ? <div className="certificate-body record-envelope-body">
      <p className="record-envelope-date" data-record-block><strong>Date:</strong> {dateText}</p>
      <section className="record-envelope-sender" data-record-block>
        <p>From:</p><div><strong>{fields.schoolHead.toUpperCase() || '\u00a0'}</strong><p>{fields.schoolHeadPosition}</p><p className="record-envelope-school">{senderSchool}</p><p>{senderAddress}</p></div>
      </section>
      <section className="record-envelope-recipient" data-record-block>
        <p>To:</p><div><strong>{fields.destinationSchoolHead.toUpperCase() || 'SCHOOL HEAD'}</strong><p className="record-envelope-school">{destinationSchool}</p><p>{destinationAddress}</p></div>
      </section>
      <section className="record-envelope-student" data-record-block><strong>{fields.studentName.toUpperCase() || '\u00a0'}</strong><p>{fields.learnerId}</p></section>
    </div> : <div className="certificate-body record-sf10-body">
      <p className="record-sf10-date">{dateText || '\u00a0'}</p>
      <section className="record-sf10-recipient"><strong>{fields.destinationSchoolHead.toUpperCase() || 'SCHOOL HEAD'}</strong><p>{destinationSchool || '\u00a0'}</p><p>{destinationAddress || '\u00a0'}</p></section>
      <p className="record-sf10-salutation">Sir/Madam:</p>
      <p className="record-sf10-paragraph">May I have the honor to respectfully request from your good office an original copy/copies of <strong>DepEd Form 137-E or School Form 10 Learners Permanent Record, ECCD, Progress Report Card, Birth Certificate, and other attachments</strong> of the following learner who have been temporarily enrolled in this school upon presentation of his/her credentials for the admission to the grade as indicated:</p>
      <table className="record-sf10-table">
        <colgroup><col style={{ width: '35%' }} /><col style={{ width: '9.5%' }} /><col style={{ width: '17%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14.5%' }} /></colgroup>
        <thead><tr><th rowSpan={2}>NAMES</th><th colSpan={2}>IN OUR SCHOOL</th><th colSpan={3}>IN YOUR SCHOOL</th></tr><tr><th>Grade</th><th>School Year</th><th>Grade</th><th>School Year</th><th>Teacher Adviser</th></tr></thead>
        <tbody><tr><td>{fields.studentName}</td><td>{fields.gradeLevel}</td><td>{fields.schoolYear}</td><td>{fields.previousGradeLevel}</td><td>{fields.previousSchoolYear}</td><td>{fields.previousAdviser}</td></tr></tbody>
      </table>
      <p className="record-sf10-paragraph record-sf10-return">Kindly return this request together with the accomplished Form 137-E or School Form 10 (Pupil’s Permanent Record).</p>
      <p className="record-sf10-thanks">Thank you.</p>
      <div className="record-sf10-priority">
        {(['first', 'second', 'third'] as const).map((stage, index) => <p key={stage}>(&nbsp; {fields.requestStage === stage ? '✓' : '\u00a0'} &nbsp;) &nbsp;{index + 1}<sup>{index === 0 ? 'st' : index === 1 ? 'nd' : 'rd'}</sup> Request</p>)}
        <p>(&nbsp; {fields.urgent === 'yes' ? '✓' : '\u00a0'} &nbsp;) &nbsp;Urgent</p>
      </div>
      <div className="record-sf10-signature"><p>Very truly yours,</p><strong>{fields.schoolHead.toUpperCase() || '\u00a0'}</strong><p>{fields.schoolHeadPosition || 'School Head'}</p></div>
    </div>}
    <footer className="certificate-footer"><SchoolDocumentFooterContents fields={fields} /></footer>
  </article>;
}
