import { useEffect, useRef, useState } from 'react';
import { APP_CONFIG, isSchoolAdmin } from '../lib/app-config';
import { fsGetSchoolYears, fsGetSections } from '../lib/firestore-api';
import { downloadStudentJson, studentTemplate } from '../lib/student-import/download';
import { studentImportStore } from '../lib/student-import/firestore-store';
import { normalizeGrade } from '../lib/student-import/schema';
import { IMPORT_LIMITS, type FileKind, type ScanResult } from '../lib/student-import/types';
import { inspectStudentTargets, uploadStudents, type DuplicateMode, type ImportProgress } from '../lib/student-import/upload';
import { StudentImportReader } from '../lib/student-import/worker-client';
import '../styles/components/student-import.css';

type Phase = 'idle' | 'reading' | 'ready' | 'scanning' | 'review' | 'uploading' | 'done' | 'error';
interface Section { gradeLevel: string; section: string }
interface Year { schoolYear: string; isCurrent?: boolean }

export default function StudentImportPanel() {
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
  const [status, setStatus] = useState('Choose a file to begin. Your file is scanned on this device before any database upload.');
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
  const sectionRequest = useRef(0);
  const busy = ['reading', 'scanning', 'uploading'].includes(phase);
  const hasTarget = sections.some(value => normalizeGrade(value.gradeLevel) === grade && value.section === section);
  const canUpload = phase === 'review' && hasTarget && !setupBusy && !setupError && result && !result.errors.length && !conflicts.length && result.students.length > 0;
  const validJson = hasTarget && result && !result.errors.length && !conflicts.length && result.students.length > 0;

  useEffect(() => {
    mounted.current = true;
    void loadYears();
    return () => { mounted.current = false; reader.current?.dispose(); sectionRequest.current++; };
  }, []);

  async function loadYears() {
    setSetupBusy(true);
    setSetupError('');
    try {
      const values = await fsGetSchoolYears() as Year[];
      if (!mounted.current) return;
      setYears(values);
      if (!values.length) throw new Error('Create a school year and its sections in Academic setup first.');
      setYear(values.find(value => value.isCurrent)?.schoolYear || values[0].schoolYear);
    } catch (error) { if (mounted.current) setSetupError((error as Error).message); }
    finally { if (mounted.current) setSetupBusy(false); }
  }

  useEffect(() => {
    if (!year) return;
    const request = ++sectionRequest.current;
    setSetupBusy(true);
    setSetupError('');
    setSections([]);
    void fsGetSections(year).then((values: Section[]) => {
      if (!mounted.current || request !== sectionRequest.current) return;
      setSections(values.filter(value => normalizeGrade(value.gradeLevel) && value.section));
      if (!values.length) setSetupError('No sections configured for this year. Add them in Academic setup before importing.');
    }).catch((error: Error) => {
      if (mounted.current && request === sectionRequest.current) setSetupError(error.message);
    }).finally(() => { if (mounted.current && request === sectionRequest.current) setSetupBusy(false); });
  }, [year, setupVersion]);

  useEffect(() => {
    if (phase !== 'uploading') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  function invalidate() {
    setResult(null); setExisting(0); setConflicts([]); setProgress(null);
    setPhase(sheets.length ? 'ready' : 'idle');
    setStatus(sheets.length ? 'Options changed. Scan and validate again before uploading.' : 'Choose a file to begin.');
  }

  async function readFile(file: File) {
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
      if (!mounted.current) return;
      if (parsed.schoolId && parsed.schoolId !== APP_CONFIG.schoolId) throw new Error('This JSON belongs to a different school. Choose a file for the current school.');
      setSheets(parsed.sheets); setFileYear(parsed.schoolYear || ''); setSheet(0); setPhase('ready');
      setStatus(`${file.name} read. Choose the worksheet and target options, then scan and validate.`);
    } catch (error) {
      if (!mounted.current) return;
      reader.current?.dispose(); reader.current = null;
      setPhase('error'); setStatus((error as Error).message);
    }
  }

  async function scan() {
    if (!reader.current || !year || !hasTarget || setupBusy || setupError) return;
    setPhase('scanning'); setResult(null); setProgress(null); setConflicts([]);
    setStatus('Scanning labels, normalizing values, and validating every student…');
    try {
      if (fileYear && fileYear !== year) throw new Error(`This JSON specifies school year ${fileYear}. Select that target year, or correct the source file before importing.`);
      const scanResult = await reader.current.scan(sheet, { schoolYear: year, gradeLevel: grade, section, dateOrder, headerRows, sections });
      if (!mounted.current) return;
      setResult(scanResult);
      if (scanResult.errors.length) {
        setPhase('review'); setStatus(`${scanResult.errors.length} validation errors. Correct the source file and import it again. Nothing has been uploaded.`);
        return;
      }
      setStatus('Checking existing LRNs and archived records in the selected school year…');
      const targets = await inspectStudentTargets(studentImportStore, year, scanResult.students, count => {
        if (mounted.current) setStatus(`Checking existing LRNs: ${count} of ${scanResult.students.length} students…`);
      });
      if (!mounted.current) return;
      setExisting(targets.existing); setConflicts(targets.conflicts); setPhase('review');
      setStatus(targets.conflicts.length
        ? `${targets.conflicts.length} LRNs conflict with archived or transferred learners. Resolve these before uploading.`
        : `Ready for review. ${scanResult.students.length} students validated; normalized JSON prepared. Nothing has been uploaded.`);
    } catch (error) { if (mounted.current) { setPhase('error'); setStatus((error as Error).message); } }
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
    } catch (error) {
      if (mounted.current) { setPhase('error'); setStatus((error as Error).message); }
    }
  }

  if (!isSchoolAdmin()) return null;
  const gradeOptions = [...new Set(sections.map(value => normalizeGrade(value.gradeLevel)))];
  const sectionOptions = sections.filter(value => normalizeGrade(value.gradeLevel) === grade);
  const previewColumns = [...new Set(result?.students.slice(0, 10).flatMap(student => Object.keys(student)) || [])];
  const stepIndex = { idle: 0, reading: 0, ready: 1, scanning: 1, review: 3, uploading: 4, done: 5, error: -1 }[phase];

  return (
    <details className="admin-accordion admin-database-accordion student-import-accordion" id="studentImportAccordion">
      <summary className="admin-accordion-summary">
        <span className="admin-accordion-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg></span>
        <span className="admin-accordion-copy"><strong id="studentImportTitle">Import students</strong><small>{busy ? status : 'Scan a student dataset, review normalized records, and import into a configured section'}</small></span>
        <svg className="admin-accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
    <section className="panel student-import-panel" aria-labelledby="studentImportTitle">
      <header className="student-import-heading">
        <div><span className="student-import-eyebrow">Student records only</span>
          <p>Add students from labelled datasets without restoring a whole database. Review matched columns and normalized values before uploading to {APP_CONFIG.branding.schoolName}.</p>
          <p>Common name suffixes such as Jr., Sr., II, and III are separated automatically, including Last, First, Suffix, Middle names. Use a Suffix or Name extension column for custom suffixes or single-letter Roman numerals.</p></div>
        <button className="btn btn-secondary" type="button" disabled={busy || setupBusy || !year || !hasTarget} onClick={() => downloadStudentJson(studentTemplate(year, grade, section), APP_CONFIG.schoolId, year, 'edash-student-template.json')}>Export template</button>
      </header>

      <aside className="student-import-warning" role="note">
        <strong>Review before uploading.</strong> Only recognized student fields are kept. Unknown columns and empty optional values are ignored. Missing guardian names and contact numbers use N/A for future editing in the Masterlist. New records need a 12-digit LRN, first/last name, and a configured grade and section. Existing LRNs are skipped by default. “Update matched fields” preserves absent fields and existing guardian/contact details when the file has no replacement. No learners are deleted. Take a tenant backup before updating existing students.
      </aside>

      {setupError && <p className="student-import-error" role="alert">{setupError} <button className="btn btn-secondary" type="button" disabled={busy || setupBusy} onClick={() => { if (year) setSetupVersion(version => version + 1); else void loadYears(); }}>Retry setup</button></p>}
      <fieldset className="student-import-options" disabled={busy || setupBusy}>
        <legend>Import options</legend>
        <label>File type<select value={kind} onChange={event => {
          setKind(event.target.value as FileKind); reader.current?.dispose(); reader.current = null;
          setSheets([]); setFilename(''); setFileYear(''); setResult(null); setPhase('idle'); setStatus('Choose a file using the selected file type.');
          if (fileInput.current) fileInput.current.value = '';
        }}><option value="auto">Auto-detect content</option><option value="json">JSON / JSON Lines</option><option value="text">Delimited / tabular text</option><option value="spreadsheet">Excel / ODS / XML / HTML</option></select></label>
        <label>School year<select value={year} onChange={event => { setYear(event.target.value); setGrade(''); setSection(''); invalidate(); }}><option value="">Select year</option>{years.map(value => <option key={value.schoolYear}>{value.schoolYear}</option>)}</select></label>
        <label>Grade level *<select required value={grade} onChange={event => { setGrade(event.target.value); setSection(''); invalidate(); }}><option value="">Select configured grade</option>{gradeOptions.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Section *<select required value={section} disabled={!grade} onChange={event => { setSection(event.target.value); invalidate(); }}><option value="">Select configured section</option>{sectionOptions.map(value => <option key={value.section}>{value.section}</option>)}</select></label>
        <label>Date order<select value={dateOrder} onChange={event => { setDateOrder(event.target.value as 'mdy' | 'dmy'); invalidate(); }}><option value="mdy">Month / day / year (SF1)</option><option value="dmy">Day / month / year</option></select></label>
        <label>Existing LRN<select value={mode} onChange={event => setMode(event.target.value as DuplicateMode)}><option value="skip">Skip existing students</option><option value="merge">Update matched fields</option></select></label>
      </fieldset>
      <p className="student-import-hint">Choose a grade and section from this school year’s structure. Every imported student uses this placement; grade and section columns in the file are ignored. In update mode, existing students also move to the selected grade and section.</p>

      <div className="student-import-file-row">
        <input ref={fileInput} type="file" aria-label="Student dataset" hidden onChange={event => {
          const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = '';
        }} />
        <button className="btn btn-primary" type="button" disabled={busy || setupBusy || !!setupError || !year} onClick={() => fileInput.current?.click()}>Import students</button>
        <span>{filename || 'Choose a dataset · up to 10 MB'}</span>
      </div>
      <p className="student-import-hint">JSON, JSON Lines, CSV, TSV, XLS, XLSX, XLSB, ODS, Spreadsheet XML, and HTML tables. Detection uses content rather than the filename. One worksheet per import; macros are never run. Text LRNs preserve leading zeros.</p>

      {!!sheets.length && <div className="student-import-sheet-options">
        <label>Worksheet<select value={sheet} disabled={busy} onChange={event => { setSheet(+event.target.value); invalidate(); }}>{sheets.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>
        <label>Header depth<select value={headerRows} disabled={busy} onChange={event => { setHeaderRows(+event.target.value); invalidate(); }}><option value={0}>Auto-detect merged headers</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} header {value === 1 ? 'row' : 'rows'}</option>)}</select></label>
        <button className="btn btn-secondary" type="button" disabled={busy || setupBusy || !!setupError || !hasTarget} onClick={() => void scan()}>Scan and validate</button>
      </div>}

      <ol className="student-import-steps" aria-label="Import progress">{['Read file', 'Scan labels', 'Validate & create JSON', 'Review', 'Upload', 'Done'].map((label, index) => <li key={label} data-state={index < stepIndex ? 'complete' : index === stepIndex ? 'active' : 'pending'} aria-current={index === stepIndex ? 'step' : undefined}><span>{index < stepIndex ? '✓' : index + 1}</span>{label}</li>)}</ol>
      <p className={`student-import-status ${phase === 'error' ? 'student-import-error' : ''}`} role="status" aria-live="polite" aria-busy={busy}>{busy && <span className="admin-spinner" aria-hidden="true" />} {status}</p>
      {progress && <progress className="student-import-progress" aria-label="Students processed" max={result?.students.length || 1} value={progress.processed} />}

      {result && <div className="student-import-review">
        <div className="student-import-summary"><span><strong>{result.students.length}</strong> valid students</span><span><strong>{result.mappings.length}</strong> matched fields</span><span><strong>{result.errors.length}</strong> errors</span><span><strong>{result.warnings.length}</strong> warnings</span><span><strong>{existing}</strong> existing LRNs</span></div>
        <p className="student-import-hint">Labels found on {result.headerRow === result.headerEnd ? `row ${result.headerRow}` : `rows ${result.headerRow}–${result.headerEnd}`}. {result.skippedRows} blank, repeated-header, or summary rows ignored. All students are assigned to {grade} / {section} from the school structure. Birthdates use YYYY-MM-DD; age is recalculated from birthdate.</p>
        <details><summary>Column mappings & ignored labels</summary><div className="student-import-table-wrap"><table><thead><tr><th>Source label</th><th>Student field</th></tr></thead><tbody>{result.mappings.map(mapping => <tr key={mapping.column}><td>{mapping.label}</td><td>{mapping.field}</td></tr>)}</tbody></table></div><p className="student-import-hint"><strong>Ignored:</strong> {result.ignored.join(' · ') || 'None'}. Missing optional fields remain absent.</p></details>
        {!!conflicts.length && <p className="student-import-error" role="alert">Archived or transferred LRNs: {conflicts.slice(0, 30).join(', ')}{conflicts.length > 30 ? ` and ${conflicts.length - 30} more` : ''}. No upload is allowed until these conflicts are resolved.</p>}
        {result.errors.length > 0 && <details open className="student-import-errors"><summary>{result.errors.length} errors — upload blocked</summary><IssueList issues={result.errors} /></details>}
        {result.warnings.length > 0 && <details><summary>{result.warnings.length} warnings — review normalized values</summary><IssueList issues={result.warnings} /></details>}
        {!!result.students.length && <details open><summary>Student preview · first {Math.min(10, result.students.length)} rows</summary><div className="student-import-table-wrap" tabIndex={0} role="region" aria-label="Normalized student preview"><table><thead><tr><th>Source row</th>{previewColumns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.students.slice(0, 10).map((student, index) => <tr key={String(student.learnerId)}><td>{result.sourceRows[index]}</td>{previewColumns.map(column => <td key={column}>{student[column] == null ? '—' : String(student[column])}</td>)}</tr>)}</tbody></table></div></details>}
        <div className="student-import-actions">
          <button className="btn btn-secondary" type="button" disabled={!validJson || busy} onClick={() => downloadStudentJson(result.students, APP_CONFIG.schoolId, year)}>Download normalized JSON</button>
          {phase !== 'done' && <button className="btn btn-primary" type="button" disabled={!canUpload} onClick={() => void upload()}>Review and upload {result.students.length} students</button>}
        </div>
      </div>}
    </section>
    </details>
  );
}

function IssueList({ issues }: { issues: { row: number; message: string }[] }) {
  return <><ul>{issues.slice(0, 50).map((issue, index) => <li key={index}>{issue.row ? `Row ${issue.row}: ` : ''}{issue.message}</li>)}</ul>{issues.length > 50 && <p>Showing the first 50 of {issues.length} issues. Correct these and rescan to check the remaining rows.</p>}</>;
}
