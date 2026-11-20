import { useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../lib/app-config';
import { getStoredSchool } from '../lib/school-registry';
import { fsGetCardPrintingPreferences, fsGetSchoolYears, fsGetSections } from '../lib/firestore-api';
import { attendanceImportSections, importSf2Attendance, loadAttendanceImportTargets } from '../lib/attendance-import/store';
import { matchSf2Rows, SF2_MONTHS, type AttendanceImportEntry, type Sf2Report, type Sf2Review } from '../lib/attendance-import/sf2';
import { Sf2Reader } from '../lib/attendance-import/worker-client';
import { attendanceMonthNeedsReplacement, attendanceMonthValues, canonicalAttendanceMonth } from '../lib/attendance-import/months';
import type { ImportPanelProps } from './ImportDialogLauncher';
import '../styles/components/student-import.css';
import '../styles/components/attendance-import.css';

interface Section { gradeLevel: string; section: string }
interface SchoolYear { schoolYear: string; isCurrent?: boolean }
type Phase = 'idle' | 'reading' | 'ready' | 'scanning' | 'review' | 'saving' | 'done' | 'error';
type Review = Sf2Review & { month: string; errors: string[]; warnings: string[] };
const rows = ['daysPresent', 'daysAbsent', 'classDays'] as const;
function previousMonth(entry: AttendanceImportEntry, month: string): string[] {
  const values = attendanceMonthValues(entry.expectedAttendance, month);
  return rows.map(row => [...new Set(values[row].filter(Boolean))].join(' or '));
}
function replacesAttendance(entry: AttendanceImportEntry, month: string) {
  return attendanceMonthNeedsReplacement(entry.expectedAttendance, month, entry);
}

export default function AttendanceImportPanel({ authorized, initialYear, onBusyChange, onComplete }: ImportPanelProps & { onComplete: () => void }) {
  const [years, setYears] = useState<SchoolYear[]>([]);
  const [year, setYear] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [placement, setPlacement] = useState('');
  const [month, setMonth] = useState('auto');
  const [cardMonths, setCardMonths] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [filename, setFilename] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [setupVersion, setSetupVersion] = useState(0);
  const [status, setStatus] = useState('Choose an SF2 workbook, a school year, and its section.');
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const reader = useRef<Sf2Reader | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const access = useRef(authorized);
  const operation = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  access.current = authorized;
  const busy = ['reading', 'scanning', 'saving'].includes(phase);
  const target = sections.find(value => JSON.stringify([value.gradeLevel, value.section]) === placement);
  const replacements = review?.entries.filter(entry => replacesAttendance(entry, review.month)).length || 0;
  const canSave = authorized && phase === 'review' && !!target && !setupBusy && !setupError && !!review?.entries.length
    && !review.errors.length && confirmed && (!replacements || overwrite);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current++; reader.current?.dispose(); };
  }, []);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    let current = true;
    if (!authorized) {
      operation.current++; reader.current?.dispose(); reader.current = null;
      setReview(null); setSheets([]); setFilename(''); setSections([]); setYear(''); setPlacement('');
      setPhase(value => value === 'saving' ? value : 'idle');
      return;
    }
    setSetupBusy(true); setSetupError('');
    Promise.all([fsGetSchoolYears(), fsGetCardPrintingPreferences()]).then(([values, preferences]) => {
      if (!current || !access.current) return;
      const available = values as SchoolYear[];
      if (!available.length) throw new Error('Create a school year and section in Academic setup first.');
      setYears(available); setCardMonths(preferences.attendanceMonths);
      setYear(available.some(value => value.schoolYear === initialYear) ? initialYear : available.find(value => value.isCurrent)?.schoolYear || available[0].schoolYear);
    }).catch(error => { if (current && access.current) setSetupError((error as Error).message); })
      .finally(() => { if (current && access.current) setSetupBusy(false); });
    return () => { current = false; };
  }, [authorized, initialYear, setupVersion]);

  useEffect(() => {
    let current = true;
    if (!authorized || !year) return;
    setSections([]); setPlacement(''); setSetupBusy(true); setSetupError('');
    fsGetSections(year).then(values => {
      if (!current || !access.current) return;
      const available = attendanceImportSections(year, values as Section[]);
      setSections(available);
      if (!available.length) throw new Error('No configured sections are available for your account in this school year.');
    }).catch(error => { if (current && access.current) setSetupError((error as Error).message); })
      .finally(() => { if (current && access.current) setSetupBusy(false); });
    return () => { current = false; };
  }, [authorized, year, setupVersion]);

  useEffect(() => {
    if (phase !== 'saving') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  function invalidate() {
    operation.current++; setReview(null); setConfirmed(false); setOverwrite(false);
    setPhase(sheets.length ? 'ready' : 'idle');
    setStatus('Options changed. Validate the worksheet again before saving.');
  }
  async function readFile(file: File) {
    if (!access.current || busy) return;
    const request = ++operation.current;
    reader.current?.dispose(); reader.current = null;
    setReview(null); setSheets([]); setSheet(0); setConfirmed(false); setOverwrite(false);
    setFilename(file.name); setPhase('reading'); setStatus('Reading SF2 worksheets…');
    try {
      if (!/\.(xlsx|xls|xlsb)$/i.test(file.name)) throw new Error('Choose an Excel SF2 workbook (.xlsx, .xls, or .xlsb).');
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a non-empty SF2 workbook up to 10 MB.');
      const next = new Sf2Reader(); reader.current = next;
      const result = await next.parse(await file.arrayBuffer());
      if (!mounted.current || !access.current || operation.current !== request) return;
      setSheets(result.sheets); setPhase('ready'); setStatus('Choose the worksheet, month, and section, then validate learner matches.');
    } catch (error) {
      if (!mounted.current || !access.current || operation.current !== request) return;
      reader.current?.dispose(); reader.current = null; setPhase('error'); setStatus((error as Error).message);
    }
  }
  async function validate() {
    if (!access.current || !target || !reader.current || busy || setupBusy || setupError) return;
    const request = ++operation.current;
    setPhase('scanning'); setReview(null); setConfirmed(false); setOverwrite(false);
    setStatus('Checking SF2 format, month, attendance totals, and section learner matches…');
    try {
      // Registry IDs identify workspaces; SF2 uses the official DepEd school ID.
      const schoolId = String(getStoredSchool()?.schoolInfo?.id ?? '').trim()
        || (/^\d{6}$/.test(APP_CONFIG.schoolId) ? APP_CONFIG.schoolId : '');
      const [report, learners]: [Sf2Report, Awaited<ReturnType<typeof loadAttendanceImportTargets>>] = await Promise.all([
        reader.current.scan(sheet, { month, schoolYear: year, gradeLevel: target.gradeLevel, section: target.section, schoolId }),
        loadAttendanceImportTargets(year, target),
      ]);
      if (!mounted.current || !access.current || operation.current !== request) return;
      const result = matchSf2Rows(report, learners);
      const warnings = [...new Set([...report.warnings, ...result.warnings])];
      if (report.month && !cardMonths.some(value => canonicalAttendanceMonth(value) === report.month)) warnings.push(`${report.month} is not displayed in the current Learner Card attendance layout. An administrator can add it in Card Preferences; the imported record will be retained.`);
      const errors = [...new Set([...report.errors, ...result.errors])];
      setReview({ ...result, month: report.month, errors, warnings }); setPhase('review');
      setStatus(errors.length ? `Resolve ${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'} before importing.` : `${result.entries.length} learners matched. Review their ${report.month} attendance below.`);
      window.setTimeout(() => { if (mounted.current && operation.current === request) reviewHeading.current?.focus(); }, 0);
    } catch (error) {
      if (mounted.current && access.current && operation.current === request) { setPhase('error'); setStatus((error as Error).message); }
    }
  }
  async function save() {
    if (!canSave || !review || !target) return;
    const request = ++operation.current;
    setPhase('saving'); setStatus('Saving the reviewed monthly attendance…');
    try {
      const result = await importSf2Attendance({ schoolYear: year, placement: target, month: review.month, entries: review.entries, overwriteExisting: overwrite });
      if (!mounted.current) return;
      onComplete();
      if (!access.current || operation.current !== request) return;
      setPhase('done'); setStatus(`Attendance imported for ${review.month}: ${result.updated} updated, ${result.unchanged} already up to date.`);
    } catch (error) {
      if (!mounted.current || !access.current || operation.current !== request) return;
      setReview(null); setConfirmed(false); setOverwrite(false); setPhase('error');
      setStatus(`${(error as Error).message} Validate again before retrying.`);
    } finally {
      if (mounted.current && (!access.current || operation.current !== request)) setPhase(value => value === 'saving' ? 'idle' : value);
    }
  }

  if (!authorized) return <p className="student-import-access-denied" role="alert">Attendance imports are not enabled for your account. Contact your school administrator.</p>;
  return <section className="student-import-panel attendance-import-panel" aria-label="SF2 attendance import workflow" aria-busy={busy}>
    <p className="attendance-import-intro">Import the <strong>Present</strong> and <strong>Absent</strong> totals from one SF2 worksheet. Total Classes is their sum. Review all matches before saving to learners’ Attendance Records.</p>
    <section className="student-import-stage" aria-labelledby="attendanceFileTitle">
      <div className="student-import-stage-heading"><h3 id="attendanceFileTitle">1. File and attendance month</h3><span>Excel · up to 10 MB · one worksheet</span></div>
      {setupError && <div className="student-import-setup-error" role="alert"><p>{setupError}</p><button type="button" className="btn btn-secondary" disabled={busy || setupBusy} onClick={() => setSetupVersion(value => value + 1)}>Retry setup</button></div>}
      <fieldset className="student-import-options" disabled={busy || setupBusy}>
        <legend className="visually-hidden">Attendance Record to update</legend>
        <label>School year<select value={year} onChange={event => { setYear(event.target.value); setPlacement(''); invalidate(); }}><option value="">Select school year</option>{years.map(value => <option key={value.schoolYear}>{value.schoolYear}</option>)}</select></label>
        <label>Grade and section<select value={placement} onChange={event => { setPlacement(event.target.value); invalidate(); }}><option value="">Select configured section</option>{sections.map(value => <option key={JSON.stringify([value.gradeLevel, value.section])} value={JSON.stringify([value.gradeLevel, value.section])}>{value.gradeLevel} · {value.section}</option>)}</select></label>
        <label>Attendance month<select value={month} onChange={event => { setMonth(event.target.value); invalidate(); }}><option value="auto">Autodetect from SF2</option>{SF2_MONTHS.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label>
      </fieldset>
      <p className="student-import-hint">Autodetect reads the “Report for the Month of” header. Select a month explicitly to override it; any difference will appear in the review.</p>
      <div className="student-import-file-row">
        <div className="student-import-file-copy"><strong>{filename || 'Choose your SF2 workbook'}</strong><span>Names and monthly summary columns must follow the School Form 2 format.</span></div>
        <input ref={fileInput} hidden type="file" accept=".xlsx,.xls,.xlsb" aria-label="SF2 Excel workbook" disabled={busy || setupBusy || !!setupError} onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ''; }} />
        <button className="btn btn-secondary" type="button" disabled={busy || setupBusy || !!setupError} onClick={() => fileInput.current?.click()}>{filename ? 'Change file' : 'Choose file'}</button>
      </div>
      {!!sheets.length && <div className="student-import-sheet-options attendance-import-worksheet">
        <label>Worksheet<select value={sheet} disabled={busy || setupBusy} onChange={event => { setSheet(Number(event.target.value)); invalidate(); }}>{sheets.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <button className="btn btn-primary" type="button" disabled={busy || setupBusy || !!setupError || !target} onClick={() => void validate()}>Validate attendance</button>
      </div>}
    </section>
    <p className={`student-import-status ${phase === 'error' ? 'student-import-error' : ''}`} role="status" aria-live="polite">{busy && <span className="student-import-spinner" aria-hidden="true" />}{status}</p>
    {review && <section className="student-import-stage student-import-review" aria-labelledby="attendanceReviewTitle">
      <div className="student-import-stage-heading"><h3 id="attendanceReviewTitle" ref={reviewHeading} tabIndex={-1}>2. Review learner matches</h3><span>{year} · {target?.gradeLevel} · {target?.section} · {review.month}</span></div>
      <div className="student-import-summary attendance-import-summary"><span><strong>{review.entries.length}</strong>Matched learners</span><span data-state={review.errors.length ? 'error' : undefined}><strong>{review.errors.length}</strong>Errors</span><span data-state={review.warnings.length ? 'warning' : undefined}><strong>{review.warnings.length}</strong>Warnings</span><span><strong>{replacements}</strong>Existing records to replace</span></div>
      {!!review.errors.length && <details open className="student-import-errors"><summary>Errors to resolve</summary><ul>{review.errors.slice(0, 100).map((error, index) => <li key={index}>{error}</li>)}</ul>{review.errors.length > 100 && <p>Showing the first 100 errors. Correct the file and validate again.</p>}</details>}
      {!!review.warnings.length && <details open><summary>Warnings to review</summary><ul>{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {!!review.unmatchedMasterlist.length && <details><summary>Learners missing from this worksheet ({review.unmatchedMasterlist.length})</summary><ul>{review.unmatchedMasterlist.map((name, index) => <li key={index}>{name}</li>)}</ul></details>}
      {!!review.entries.length && <div className="student-import-table-wrap" tabIndex={0} role="region" aria-label="Attendance match preview"><table><thead><tr><th>SF2 row</th><th>SF2 name</th><th>Matched learner</th><th>Learner ID</th><th>Present</th><th>Absent</th><th>Total Classes</th><th>Current Present / Absent / Total</th></tr></thead><tbody>{review.entries.map(entry => <tr key={entry.learnerId}><td>{entry.rowNumber}</td><td>{entry.sourceName}</td><td>{entry.name}</td><td>{entry.learnerId}</td><td>{entry.daysPresent}</td><td>{entry.daysAbsent}</td><td>{entry.classDays}</td><td>{previousMonth(entry, review.month).map(value => value || '—').join(' / ')}</td></tr>)}</tbody></table></div>}
      <p className="student-import-hint">Learners missing from this worksheet keep their current attendance. Other months and learner details are preserved.</p>
    </section>}
    {review && phase !== 'done' && <section className="student-import-stage" aria-labelledby="attendanceConfirmTitle">
      <div className="student-import-stage-heading"><h3 id="attendanceConfirmTitle">3. Confirm import</h3></div>
      <fieldset className="attendance-import-confirm" disabled={busy || !!review.errors.length}>
        <legend className="visually-hidden">Confirm attendance changes</legend>
        {!!replacements && <label><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />Replace the {replacements} existing monthly attendance {replacements === 1 ? 'record' : 'records'} shown in this review.</label>}
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the learner matches, month, attendance totals, and warnings.</label>
      </fieldset>
      <div className="student-import-actions"><div className="student-import-destination"><span>Attendance Record to update</span><strong>{target?.gradeLevel} · {target?.section} · {review.month} · {year}</strong></div><button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void save()}>{phase === 'saving' ? 'Importing attendance…' : 'Import attendance'}</button></div>
    </section>}
  </section>;
}
