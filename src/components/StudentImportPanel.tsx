import { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../lib/app-config';
import { fsGetSchoolYears, fsGetSections } from '../lib/firestore-api';
import { downloadStudentJson, studentTemplate } from '../lib/student-import/download';
import { studentImportStore } from '../lib/student-import/firestore-store';
import { normalizeGrade } from '../lib/student-import/schema';
import { IMPORT_LIMITS, type FileKind, type ScanResult } from '../lib/student-import/types';
import { inspectStudentTargets, uploadStudents, type DuplicateMode, type ImportProgress } from '../lib/student-import/upload';
import { StudentImportReader } from '../lib/student-import/worker-client';
import { studentImportSections } from '../lib/student-import/access';
import '../styles/components/student-import.css';

type Phase = 'idle' | 'reading' | 'ready' | 'scanning' | 'review' | 'uploading' | 'done' | 'error';
interface Section { gradeLevel: string; section: string }
interface Year { schoolYear: string; isCurrent?: boolean }

interface StudentImportPanelProps {
  authorized: boolean;
  initialYear?: string;
  onBusyChange?: (busy: boolean) => void;
  onComplete?: () => void;
}

export default function StudentImportPanel({ authorized, initialYear, onBusyChange, onComplete }: StudentImportPanelProps) {
  const [years, setYears] = useState<Year[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [year, setYear] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [kind, setKind] = useState<FileKind>('auto');
  const [dateOrder, setDateOrder] = useState<'mdy' | 'dmy'>('mdy');
  const [headerRows, setHeaderRows] = useState(0);
  const [mode, setMode] = useState<DuplicateMode>('skip');
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [filename, setFilename] = useState('');
  const [fileYear, setFileYear] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('Choose a file and placement, then scan to review the students.');
  const [setupError, setSetupError] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupVersion, setSetupVersion] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [existing, setExisting] = useState(0);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const reader = useRef<StudentImportReader | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const access = useRef(authorized);
  access.current = authorized;
  const sectionRequest = useRef(0);
  const yearRequest = useRef(0);
  const operationRequest = useRef(0);
  const placementStep = useRef<HTMLDivElement>(null);
  const reviewStep = useRef<HTMLDivElement>(null);
  const importStep = useRef<HTMLDivElement>(null);
  const busy = ['reading', 'scanning', 'uploading'].includes(phase);
  const hasTarget = sections.some(value => normalizeGrade(value.gradeLevel) === grade && value.section === section);
  const canUpload = authorized && phase === 'review' && hasTarget && !setupBusy && !setupError && result && !result.errors.length && !conflicts.length && result.students.length > 0;
  const validJson = authorized && ['review', 'done'].includes(phase) && hasTarget && result && !result.errors.length && !conflicts.length && result.students.length > 0;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reader.current?.dispose(); sectionRequest.current++; yearRequest.current++; operationRequest.current++; };
  }, []);

  useEffect(() => {
    if (authorized) void loadYears();
    else {
      reader.current?.dispose(); reader.current = null; sectionRequest.current++; yearRequest.current++; operationRequest.current++;
      setResult(null); setSheets([]); setSections([]); setFilename(''); setYear(''); setGrade(''); setSection('');
      setPhase(current => current === 'uploading' ? 'uploading' : 'idle');
    }
  }, [authorized]);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  async function loadYears() {
    if (!access.current) return;
    const request = ++yearRequest.current;
    setSetupBusy(true);
    setSetupError('');
    try {
      const values = await fsGetSchoolYears() as Year[];
      if (!mounted.current || !access.current || request !== yearRequest.current) return;
      setYears(values);
      if (!values.length) throw new Error('Create a school year and its sections in Academic setup first.');
      setYear(values.some(value => value.schoolYear === initialYear) ? initialYear! : values.find(value => value.isCurrent)?.schoolYear || values[0].schoolYear);
    } catch (error) { if (mounted.current && access.current && request === yearRequest.current) setSetupError((error as Error).message); }
    finally { if (mounted.current && access.current && request === yearRequest.current) setSetupBusy(false); }
  }

  useEffect(() => {
    if (!year || !authorized) return;
    const request = ++sectionRequest.current;
    setSetupBusy(true);
    setSetupError('');
    setSections([]);
    void fsGetSections(year).then((values: Section[]) => {
      if (!mounted.current || !access.current || request !== sectionRequest.current) return;
      const available = studentImportSections(year, values.filter(value => normalizeGrade(value.gradeLevel) && value.section));
      setSections(available);
      if (!available.length) setSetupError('No available sections for this year. Ask your school administrator to check academic setup and your section assignments.');
    }).catch((error: Error) => {
      if (mounted.current && request === sectionRequest.current) setSetupError(error.message);
    }).finally(() => { if (mounted.current && request === sectionRequest.current) setSetupBusy(false); });
  }, [year, setupVersion, authorized]);

  useEffect(() => {
    if (phase !== 'uploading') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  function invalidate() {
    operationRequest.current++;
    setResult(null); setExisting(0); setConflicts([]); setProgress(null);
    setPhase(sheets.length ? 'ready' : 'idle');
    setStatus(sheets.length ? 'Options changed. Scan and validate again before uploading.' : 'Choose a file to begin.');
  }

  async function readFile(file: File) {
    if (!access.current || busy) return;
    const request = ++operationRequest.current;
    reader.current?.dispose();
    reader.current = null;
    setResult(null); setSheets([]); setFileYear(''); setExisting(0); setConflicts([]); setProgress(null);
    setFilename(file.name); setPhase('reading');
    setStatus('Reading file content and finding worksheets…');
    try {
      if (file.size > IMPORT_LIMITS.bytes) throw new Error('Maximum file size is 10 MB. Split larger datasets before importing.');
      const nextReader = new StudentImportReader();
      reader.current = nextReader;
      const parsed = await nextReader.parse(await file.arrayBuffer(), kind);
      if (!mounted.current || !access.current || request !== operationRequest.current) return;
      if (parsed.schoolId && parsed.schoolId !== APP_CONFIG.schoolId) throw new Error('This JSON belongs to a different school. Choose a file for the current school.');
      setSheets(parsed.sheets); setFileYear(parsed.schoolYear || ''); setSheet(0); setPhase('ready');
      setStatus(`${file.name} read. Choose the worksheet and target options, then scan and validate.`);
    } catch (error) {
      if (!mounted.current || !access.current || request !== operationRequest.current) return;
      reader.current?.dispose(); reader.current = null;
      setPhase('error'); setStatus((error as Error).message);
    }
  }

  async function scan() {
    if (!access.current || busy || !reader.current || !year || !hasTarget || setupBusy || setupError) return;
    const request = ++operationRequest.current;
    setPhase('scanning'); setResult(null); setProgress(null); setConflicts([]);
    setStatus('Scanning labels, normalizing values, and validating every student…');
    try {
      if (fileYear && fileYear !== year) throw new Error(`This JSON specifies school year ${fileYear}. Select that target year, or correct the source file before importing.`);
      const scanResult = await reader.current.scan(sheet, { schoolYear: year, gradeLevel: grade, section, dateOrder, headerRows, sections });
      if (!mounted.current || !access.current || request !== operationRequest.current) return;
      setResult(scanResult);
      if (scanResult.errors.length) {
        setPhase('review'); setStatus(`${scanResult.errors.length} validation errors. Correct the source file and import it again. Nothing has been uploaded.`);
        return;
      }
      setStatus('Checking existing LRNs and archived records in the selected school year…');
      const targets = await inspectStudentTargets(studentImportStore, year, scanResult.students, count => {
        if (mounted.current && access.current && request === operationRequest.current) setStatus(`Checking existing LRNs: ${count} of ${scanResult.students.length} students…`);
      });
      if (!mounted.current || !access.current || request !== operationRequest.current) return;
      setExisting(targets.existing); setConflicts(targets.conflicts); setPhase('review');
      setStatus(targets.conflicts.length
        ? `${targets.conflicts.length} LRNs conflict with archived or transferred learners. Resolve these before uploading.`
        : `Ready for review. ${scanResult.students.length} students validated; normalized JSON prepared. Nothing has been uploaded.`);
    } catch (error) { if (mounted.current && access.current && request === operationRequest.current) { setPhase('error'); setStatus((error as Error).message); } }
  }

  async function upload() {
    if (!canUpload || !result) return;
    const newCount = result.students.length - existing;
    if (!window.confirm(
      `Import students into ${APP_CONFIG.branding.schoolName}, ${year}, ${grade} / ${section}?\n\n` +
      `All imported students will be assigned to ${grade} / ${section}. Grade and section columns in the file are ignored.\n` +
      `${newCount} new; ${existing} existing LRNs will be ${mode === 'skip' ? 'skipped' : 'updated using only nonempty matched fields'}.\n` +
      `${result.warnings.length} normalization/data warnings. Review the preview and column mappings first.\n\n` +
      'No students will be deleted. Upload uses several transactions; an interruption can leave some records saved. Proceed?',
    )) return;
    setPhase('uploading'); setStatus('Uploading validated students. Keep this page open…');
    try {
      const summary = await uploadStudents(studentImportStore, year, result.students, mode, value => {
        if (mounted.current) { setProgress(value); setStatus(`Uploading ${value.processed} of ${result.students.length} students…`); }
      });
      if (!mounted.current) return;
      setProgress(summary); setPhase('done');
      setStatus(`Done. ${summary.created} added, ${summary.updated} updated, ${summary.skipped} skipped. You can download the normalized JSON below.`);
      onComplete?.();
    } catch (error) {
      if (mounted.current) { setPhase('error'); setStatus((error as Error).message); }
    }
  }

  if (!authorized) return <div className="student-import-access-denied" role="alert"><p>Student import access is unavailable. Ask your school administrator for access.</p>{phase === 'uploading' && <p role="status">Finishing the active upload. Keep this page open until it stops.{progress ? ` ${progress.processed} students processed.` : ''}</p>}</div>;
  const gradeOptions = [...new Set(sections.map(value => normalizeGrade(value.gradeLevel)))];
  const sectionOptions = sections.filter(value => normalizeGrade(value.gradeLevel) === grade);
  const previewColumns = [...new Set(result?.students.slice(0, 10).flatMap(student => Object.keys(student)) || [])];
  const stepIndex = phase === 'done' || phase === 'uploading' ? 2 : result || phase === 'scanning' ? 1 : 0;
  const goToStep = (index: number) => {
    const element = [placementStep, reviewStep, importStep][index].current;
    element?.scrollIntoView?.({ block: 'start' });
    element?.focus({ preventScroll: true });
  };

  return (
    <section className="student-import-panel" aria-label="Student import workflow">
      <header className="student-import-heading">
        <div><span className="student-import-eyebrow">{APP_CONFIG.branding.schoolName}</span>
          <p>Choose a file, review its students, then confirm the import. Nothing is saved until you upload.</p></div>
        <button className="btn btn-secondary" type="button" disabled={busy || setupBusy || !year || !hasTarget} onClick={() => downloadStudentJson(studentTemplate(year, grade, section), APP_CONFIG.schoolId, year, 'edash-student-template.json')}>Export template</button>
      </header>

      <nav className="student-import-navigation" aria-label="Import workflow sections">
        <ol className="student-import-steps">{['File & placement', 'Validate & review', 'Confirm import'].map((label, index) => <li key={label} data-state={index < stepIndex || phase === 'done' ? 'complete' : index === stepIndex ? 'active' : 'pending'}>
          <button type="button" onClick={() => goToStep(index)} aria-current={index === stepIndex ? 'step' : undefined}><span aria-hidden="true">{index < stepIndex || phase === 'done' ? '✓' : index + 1}</span><strong>{label}</strong></button>
        </li>)}</ol>
      </nav>

      <div className="student-import-stage" ref={placementStep} tabIndex={-1} aria-labelledby="studentImportPlacementTitle">
        <div className="student-import-stage-heading"><h3 id="studentImportPlacementTitle">1. File & placement</h3><span>Up to 10 MB · one worksheet per import</span></div>
        {setupError && <div className="student-import-setup-error" role="alert"><p>{setupError}</p><button className="btn btn-secondary" type="button" disabled={busy || setupBusy} onClick={() => { if (year) setSetupVersion(version => version + 1); else void loadYears(); }}>Retry setup</button></div>}
        <fieldset className="student-import-options" disabled={busy || setupBusy}>
          <legend className="visually-hidden">Student placement</legend>
          <label>School year<select value={year} onChange={event => { setYear(event.target.value); setGrade(''); setSection(''); invalidate(); }}><option value="">Select year</option>{years.map(value => <option key={value.schoolYear}>{value.schoolYear}</option>)}</select></label>
          <label>Grade level *<select required value={grade} onChange={event => { setGrade(event.target.value); setSection(''); invalidate(); }}><option value="">Select configured grade</option>{gradeOptions.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Section *<select required value={section} disabled={!grade} onChange={event => { setSection(event.target.value); invalidate(); }}><option value="">Select configured section</option>{sectionOptions.map(value => <option key={value.section}>{value.section}</option>)}</select></label>
        </fieldset>
        <p className="student-import-placement-note">Every imported student uses this placement. Grade and section columns in the file are ignored.</p>

        <div className="student-import-file-row">
          <span className="student-import-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3H6v18h12V7l-4-4Z"/><path d="M14 3v5h4M9 13h6M9 17h6"/></svg></span>
          <div className="student-import-file-copy"><strong>{filename || 'Select your student file'}</strong><span>Excel, CSV, JSON and other supported tabular files</span></div>
          <input ref={fileInput} type="file" aria-label="Student dataset" disabled={busy || setupBusy || !!setupError || !year} hidden onChange={event => {
            const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = '';
          }} />
          <button className="btn btn-secondary" type="button" disabled={busy || setupBusy || !!setupError || !year} onClick={() => fileInput.current?.click()}>{filename ? 'Change file' : 'Choose file'}</button>
        </div>

        <details className="student-import-help student-import-advanced"><summary>Advanced file options</summary>
          <fieldset className="student-import-options" disabled={busy || setupBusy}><legend className="visually-hidden">Parsing options</legend>
            <label>File type<select value={kind} onChange={event => {
              setKind(event.target.value as FileKind); reader.current?.dispose(); reader.current = null;
              setSheets([]); setFilename(''); setFileYear(''); setResult(null); setPhase('idle'); setStatus('Choose a file using the selected file type.');
              if (fileInput.current) fileInput.current.value = '';
            }}><option value="auto">Auto-detect content</option><option value="json">JSON / JSON Lines</option><option value="text">Delimited / tabular text</option><option value="spreadsheet">Excel / ODS / XML / HTML</option></select></label>
            <label>Date order<select value={dateOrder} onChange={event => { setDateOrder(event.target.value as 'mdy' | 'dmy'); invalidate(); }}><option value="mdy">Month / day / year (SF1)</option><option value="dmy">Day / month / year</option></select></label>
            <label>Header depth<select value={headerRows} onChange={event => { setHeaderRows(+event.target.value); invalidate(); }}><option value={0}>Auto-detect merged headers</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} header {value === 1 ? 'row' : 'rows'}</option>)}</select></label>
          </fieldset>
          <p className="student-import-hint">Defaults work for most files. Use header depth for multirow headings and date order for ambiguous birthdates.</p>
        </details>
        <details className="student-import-help"><summary>File requirements & field handling</summary>
          <ul><li>New students need a 12-digit LRN and first/last name. Keep LRNs as text to retain leading zeros.</li>
            <li>Supported: JSON, JSON Lines, CSV, TSV, XLS, XLSX, XLSB, ODS, Spreadsheet XML and HTML tables. Files are detected by content; macros never run.</li>
            <li>Only recognized fields are imported. Unknown columns and empty optional values are ignored. Missing guardian/contact values use N/A on new records.</li>
            <li>Common suffixes (Jr., Sr., II, III) are separated automatically. Use a Suffix or Name extension column for custom suffixes or single-letter Roman numerals.</li>
            <li>A populated CPP column sets 4Ps status. Blank CPP cells preserve existing 4Ps status when updating.</li>
            <li>Birthdates are normalized to YYYY-MM-DD and age is recalculated. JSON must match this school and school year.</li></ul>
        </details>
      </div>

      <div className="student-import-stage" ref={reviewStep} tabIndex={-1} aria-labelledby="studentImportReviewTitle">
        <div className="student-import-stage-heading"><h3 id="studentImportReviewTitle">2. Validate & review</h3><span>Check records before saving</span></div>
        {!!sheets.length && <div className="student-import-sheet-options">
          <label>Worksheet<select value={sheet} disabled={busy || setupBusy} onChange={event => { setSheet(+event.target.value); invalidate(); }}>{sheets.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>
          <button className="btn btn-primary" type="button" disabled={busy || setupBusy || !!setupError || !hasTarget} onClick={() => void scan()}>Scan and validate</button>
        </div>}
        <p className={`student-import-status ${phase === 'error' ? 'student-import-error' : ''}`} role="status" aria-live="polite" aria-busy={busy}>{busy && <span className="student-import-spinner" aria-hidden="true" />} {status}</p>
        {progress && <progress className="student-import-progress" aria-label="Students processed" max={result?.students.length || 1} value={progress.processed} />}

      {result && <div className="student-import-review">
        <div className="student-import-summary"><span><strong>{result.students.length}</strong> students</span><span><strong>{result.mappings.length}</strong> matched fields</span><span data-state={result.errors.length ? 'error' : undefined}><strong>{result.errors.length}</strong> errors</span><span data-state={result.warnings.length ? 'warning' : undefined}><strong>{result.warnings.length}</strong> warnings</span><span><strong>{existing}</strong> existing LRNs</span></div>
        <p className="student-import-hint">Headers: {result.headerRow === result.headerEnd ? `row ${result.headerRow}` : `rows ${result.headerRow}–${result.headerEnd}`}. {result.skippedRows} blank, repeated-header or summary rows skipped. Placement: {grade} / {section}.</p>
        <details><summary>Column mappings & ignored labels</summary><div className="student-import-table-wrap"><table><thead><tr><th>Source label</th><th>Student field</th></tr></thead><tbody>{result.mappings.map(mapping => <tr key={mapping.column}><td>{mapping.label}</td><td>{mapping.field}</td></tr>)}</tbody></table></div><p className="student-import-hint"><strong>Ignored:</strong> {result.ignored.join(' · ') || 'None'}. Missing optional fields remain absent.</p></details>
        {!!conflicts.length && <p className="student-import-error" role="alert">Archived or transferred LRNs: {conflicts.slice(0, 30).join(', ')}{conflicts.length > 30 ? ` and ${conflicts.length - 30} more` : ''}. No upload is allowed until these conflicts are resolved.</p>}
        {result.errors.length > 0 && <details open className="student-import-errors"><summary>{result.errors.length} errors — upload blocked</summary><IssueList issues={result.errors} /></details>}
        {result.warnings.length > 0 && <details><summary>{result.warnings.length} warnings — review normalized values</summary><IssueList issues={result.warnings} /></details>}
        {!!result.students.length && <details open><summary>Student preview · first {Math.min(10, result.students.length)} rows</summary><div className="student-import-table-wrap" tabIndex={0} role="region" aria-label="Normalized student preview"><table><thead><tr><th>Source row</th>{previewColumns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.students.slice(0, 10).map((student, index) => <tr key={String(student.learnerId)}><td>{result.sourceRows[index]}</td>{previewColumns.map(column => <td key={column}>{student[column] == null ? '—' : String(student[column])}</td>)}</tr>)}</tbody></table></div></details>}
      </div>}
      </div>

      <div className="student-import-stage student-import-final-stage" ref={importStep} tabIndex={-1} aria-labelledby="studentImportConfirmTitle">
        <div className="student-import-stage-heading"><h3 id="studentImportConfirmTitle">3. Confirm import</h3><span>{phase === 'done' ? 'Import complete' : 'Your final review'}</span></div>
        <fieldset className="student-import-final-options" disabled={busy || setupBusy || phase === 'done'}><legend className="visually-hidden">Duplicate handling</legend>
          <label>Existing LRN<select value={mode} onChange={event => setMode(event.target.value as DuplicateMode)}><option value="skip">Skip existing students</option><option value="merge">Update matched fields</option></select></label>
          <p>{mode === 'skip' ? 'Existing LRNs stay unchanged. Only new students are added.' : 'Updates nonempty matched fields and moves existing students to the selected placement. Missing fields, guardian/contact details and blank CPP values stay unchanged.'}</p>
        </fieldset>
        <aside className="student-import-warning" role="note"><strong>No learners are deleted.</strong> {mode === 'merge' ? 'Take a school database backup before updating existing students. ' : ''}Keep this page open during upload. An interrupted import may save only some records.</aside>
        {result ? <div className="student-import-actions">
          <div className="student-import-destination"><span>Import destination</span><strong>{year} · {grade} / {section}</strong></div>
          <button className="btn btn-secondary" type="button" disabled={!validJson || busy} onClick={() => downloadStudentJson(result.students, APP_CONFIG.schoolId, year)}>Download normalized JSON</button>
          {phase !== 'done' && <button className="btn btn-primary" type="button" disabled={!canUpload} onClick={() => void upload()}>Review and upload {result.students.length} students</button>}
        </div> : <p className="student-import-hint">Scan a file and resolve any errors to enable upload and JSON download.</p>}
      </div>
    </section>
  );
}

function IssueList({ issues }: { issues: { row: number; message: string }[] }) {
  return <><ul>{issues.slice(0, 50).map((issue, index) => <li key={index}>{issue.row ? `Row ${issue.row}: ` : ''}{issue.message}</li>)}</ul>{issues.length > 50 && <p>Showing the first 50 of {issues.length} issues. Correct these and rescan to check the remaining rows.</p>}</>;
}
