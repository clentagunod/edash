import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import CertificateTemplate from '../components/CertificateTemplate';
import { APP_CONFIG, appDocumentTitle, isSchoolAdmin } from '../lib/app-config';
import { loginPageUrl, requireAuth } from '../lib/auth';
import { auth } from '../lib/firebase';
import { fsGetLearners, fsGetSchoolYears, fsSubscribeCertificatePreferences } from '../lib/firestore-api';
import { CERTIFICATE_TEMPLATES, normalizeCertificatePreferences, resolveCertificateTemplate, type CertificatePreferences, type CertificateTemplateId } from '../lib/certificate-preferences';
import { compareLearnersBySurname, formatLearnerNameSurnameFirst } from '../lib/learner-sorting';
import { getRegisteredSchools, getStoredSchool, type RegisteredSchool } from '../lib/school-registry';
import { applySavedTheme } from '../lib/shell';
import { getPaperDimensions, PAPER_SIZES, type PaperOrientation, type PaperSizeId } from '../lib/student-card-layout';
import { exportCertificateSheets, prepareCertificateSheets, type CertificateExportFormat } from '../lib/certificate-export';
import { makeCertificateFields, missingCertificateFields, PRINTABLES, text, type CertificateFields, type CertificateKind, type CertificateLearner } from '../lib/printables';
import '../styles/pages/print-certificate.css';

const PERSONAL_FIELDS: Array<[keyof CertificateFields, string]> = [
  ['studentName', 'Student name'], ['learnerId', 'Learner Reference Number (LRN)'],
  ['gradeLevel', 'Grade level'], ['section', 'Section'], ['schoolYear', 'School year on certificate'],
  ['issuedDate', 'Issue date'],
];
const SCHOOL_FIELDS: Array<[keyof CertificateFields, string]> = [
  ['schoolName', 'School name'], ['schoolId', 'School ID'], ['address', 'School address'], ['region', 'Region'],
  ['division', 'Schools division'], ['district', 'District'], ['schoolHead', 'School head'],
  ['schoolHeadPosition', 'School head position'], ['fbPage', 'School Facebook page'],
  ['email', 'Email address'], ['contactNumber', 'Contact number'], ['motto', 'School motto / tagline'],
  ['divisionLogo', 'Division logo URL'], ['districtLogo', 'District logo URL'], ['schoolLogo', 'School logo URL'],
];
const MM_TO_PX = 96 / 25.4;

function readPreferredYear() {
  try { return sessionStorage.getItem('lps_selected_school_year') || ''; } catch { return ''; }
}

function LayoutNumber({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="certificate-field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={draft}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => {
      const parsed = draft.trim() ? Number(draft) : value;
      const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
      onChange(next);
      setDraft(String(next));
    }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
  /></label>;
}

export default function PrintCertificatePage({ kind }: { kind: CertificateKind }) {
  const printable = PRINTABLES[kind];
  const [school, setSchool] = useState<RegisteredSchool | null>(getStoredSchool);
  const [schoolYears, setSchoolYears] = useState<string[]>([]);
  const [year, setYear] = useState('');
  const [students, setStudents] = useState<CertificateLearner[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<CertificateFields>>>({});
  const [schoolDraft, setSchoolDraft] = useState<Partial<CertificateFields>>({});
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState(normalizeCertificatePreferences);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [preferencesReload, setPreferencesReload] = useState(0);
  const [requestedTemplate, setRequestedTemplate] = useState<CertificateTemplateId>();
  const layoutInitialized = useRef(false);
  const outputInProgress = useRef(false);
  const pendingPreferences = useRef<CertificatePreferences | null>(null);
  const templateId = resolveCertificateTemplate(kind, preferences, requestedTemplate);
  const templatePreference = preferences.templates[kind];
  const canEditSchool = isSchoolAdmin() || preferences.allowSchoolDetailsOverride;
  const [error, setError] = useState('');
  const [directoryWarning, setDirectoryWarning] = useState('');
  const [outputError, setOutputError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paperSize, setPaperSize] = useState<PaperSizeId>('a4');
  const [orientation, setOrientation] = useState<PaperOrientation>('portrait');
  const [margin, setMargin] = useState(0);
  const [scale, setScale] = useState(100);
  const [zoom, setZoom] = useState(100);
  const [stageWidth, setStageWidth] = useState(900);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<'students' | 'details'>('students');
  const stageRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const currentExportRef = useRef<HTMLDivElement>(null);
  const { width, height } = getPaperDimensions(paperSize, orientation);
  const documentScale = Math.min((width - margin * 2) / 210, (height - margin * 2) / 297) * scale / 100;
  const previewScale = Math.max(.1, Math.min((stageWidth - 48) / (width * MM_TO_PX), .85)) * zoom / 100;
  const documentStyle: CSSProperties = {
    position: 'absolute', left: `${(width - 210 * documentScale) / 2}mm`,
    top: `${(height - 297 * documentScale) / 2}mm`, transform: `scale(${documentScale})`,
  };

  function applyCertificatePreferences(value: CertificatePreferences) {
    setPreferences(value);
    setPreferencesReady(true);
    setPreferencesError('');
    setRequestedTemplate((previous) => previous && value.templates[kind].allowTeacherTemplateChoice && value.templates[kind].enabledTemplates.includes(previous) ? previous : undefined);
    if (!value.allowSchoolDetailsOverride) setSchoolDraft({});
    if (!layoutInitialized.current) {
      setPaperSize(value.defaultPaperSize);
      setOrientation(value.defaultOrientation);
      layoutInitialized.current = true;
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      try {
        await requireAuth();
        if (!active) return;
        applySavedTheme();
        document.title = appDocumentTitle(printable.title);
        unsubscribe = auth.onAuthStateChanged((user) => {
          if (active && (!user || user.isAnonymous)) window.location.replace(loginPageUrl('?auth=required'));
        });
        const [years, schools] = await Promise.all([
          fsGetSchoolYears(),
          getRegisteredSchools().catch(() => {
            if (active) setDirectoryWarning('The school directory could not be refreshed. Review the school details before printing.');
            return [] as RegisteredSchool[];
          }),
        ]);
        if (!active) return;
        setSchool(schools.find((entry) => entry.id === APP_CONFIG.schoolId) || getStoredSchool());
        const options = years.map((entry) => text(entry.schoolYear)).filter(Boolean);
        const requested = new URLSearchParams(window.location.search).get('schoolYear') || '';
        setSchoolYears(options);
        setYear([requested, readPreferredYear(), text(years.find((entry) => entry.isCurrent)?.schoolYear), options[0]].find((value) => options.includes(value)) || '');
        setReady(true);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Could not load the certificate studio.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; unsubscribe?.(); };
  }, [printable]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setPreferencesReady(false);
    setPreferencesError('');
    const unsubscribe = fsSubscribeCertificatePreferences((value) => {
      if (!active) return;
      // Keep an in-progress batch on the layout it started with.
      if (outputInProgress.current) pendingPreferences.current = value;
      else applyCertificatePreferences(value);
    }, (failure) => {
      if (!active) return;
      pendingPreferences.current = null;
      setPreferencesReady(false);
      setPreferencesError(`Certificate preferences could not be loaded. ${failure.message || 'Check your connection and try again.'}`);
    });
    return () => { active = false; unsubscribe(); };
  }, [ready, preferencesReload, kind]);

  useEffect(() => {
    if (!ready || !year) return;
    let active = true;
    setLoading(true);
    setError('');
    setOutputError('');
    setStudents([]);
    setActiveId('');
    setSelectedIds([]);
    setGrade('');
    void fsGetLearners(year).then((rows) => {
      if (active) setStudents((rows as CertificateLearner[]).filter((row) => text(row.learnerId)).sort(compareLearnersBySurname));
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load student records.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ready, year, reload]);

  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.certificatePage = 'true';
    style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
    document.head.append(style);
    return () => style.remove();
  }, [width, height]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setStageWidth(stage.clientWidth || 900);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const studentsById = useMemo(() => new Map(students.map((student) => [student.learnerId, student])), [students]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeStudent = studentsById.get(activeId);
  function fieldsFor(student?: CertificateLearner): CertificateFields {
    return { ...makeCertificateFields(school, year, student), ...(canEditSchool ? schoolDraft : {}), ...drafts[`${year}:${student?.learnerId || 'manual'}`] };
  }
  const fields = fieldsFor(activeStudent);
  const selectedStudents = selectedIds.map((id) => studentsById.get(id)).filter((student): student is CertificateLearner => Boolean(student));
  const batch = selectedStudents.length ? selectedStudents.map((student) => ({ id: student.learnerId, fields: fieldsFor(student) })) : [{ id: activeId || 'manual', fields }];
  const currentMissing = missingCertificateFields(kind, fields, templateId);
  const invalidBatch = batch.filter((entry) => missingCertificateFields(kind, entry.fields, templateId).length);
  const canOutput = ready && preferencesReady && !loading && !error && !busy && !invalidBatch.length;
  const grades = useMemo(() => [...new Set(students.map((student) => text(student.gradeLevel)))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [students]);
  const filtered = useMemo(() => students.filter((student) => (!grade || text(student.gradeLevel) === grade) &&
    `${formatLearnerNameSurnameFirst(student)} ${text(student.learnerId)} ${text(student.lrn)} ${text(student.section)}`.toLowerCase().includes(search.trim().toLowerCase())), [students, grade, search]);

  function updateField(key: keyof CertificateFields, value: string, shared = false) {
    if (shared && !canEditSchool) return;
    setOutputError('');
    if (shared) setSchoolDraft((previous) => ({ ...previous, [key]: value }));
    else setDrafts((previous) => ({ ...previous, [`${year}:${activeId || 'manual'}`]: { ...previous[`${year}:${activeId || 'manual'}`], [key]: value } }));
  }

  function fieldInput([key, label]: [keyof CertificateFields, string], shared = false) {
    return <label className="certificate-field" key={key}><span>{label}</span><input type={key === 'issuedDate' ? 'date' : 'text'} value={fields[key]} readOnly={shared && !canEditSchool} onChange={(event) => updateField(key, event.currentTarget.value, shared)} /></label>;
  }

  function sheet(value: CertificateFields) {
    return <div className="certificate-sheet" style={{ width: `${width}mm`, height: `${height}mm` }}><CertificateTemplate kind={kind} fields={value} templateId={templateId} showSealNotice={preferences.showSealNotice} style={documentStyle} /></div>;
  }

  async function output(format: CertificateExportFormat | 'print') {
    const png = format === 'png';
    if (outputInProgress.current || !ready || !preferencesReady || loading || error || (png ? currentMissing.length : invalidBatch.length)) return;
    const source = png ? currentExportRef.current : printRef.current;
    const sheets = Array.from(source?.querySelectorAll<HTMLElement>('.certificate-sheet') || []);
    outputInProgress.current = true;
    setBusy(true);
    setOutputError('');
    try {
      if (format === 'print') {
        await prepareCertificateSheets(sheets);
        window.print();
      } else {
        await exportCertificateSheets({ sheets, format, width, height, orientation,
          name: `${printable.title}-${png || batch.length === 1 ? fields.studentName : `${batch.length}-students`}-${year}` });
      }
    } catch (failure) {
      setOutputError(failure instanceof Error ? failure.message : 'Could not prepare the certificate.');
    } finally {
      outputInProgress.current = false;
      setBusy(false);
      if (pendingPreferences.current) {
        const next = pendingPreferences.current;
        pendingPreferences.current = null;
        applyCertificatePreferences(next);
      }
    }
  }

  return <main className="certificate-app">
    <header className="certificate-topbar">
      <div><span className="certificate-eyebrow">Printables</span><h1>{printable.title} print studio</h1><p>Choose students, review the information, and prepare your certificates.</p></div>
      <div className="certificate-actions">
        <a className="btn btn-secondary" href={`/pages/${printable.page}`}>Back to {printable.title}</a>
        <details className="certificate-export-menu"><summary className="btn btn-secondary">{busy ? 'Preparing…' : 'Export'}</summary><div>
          <button type="button" disabled={!canOutput} onClick={() => void output('pdf')}>Download PDF ({batch.length})</button>
          <button type="button" disabled={!canOutput} onClick={() => void output('docx')}>Download Word ({batch.length})</button>
          <button type="button" disabled={!ready || !preferencesReady || loading || !!error || busy || !!currentMissing.length} onClick={() => void output('png')}>Download current PNG</button>
        </div></details>
        <button type="button" className="btn btn-primary" disabled={!canOutput} onClick={() => void output('print')}>Print {batch.length > 1 ? `${batch.length} certificates` : 'certificate'}</button>
      </div>
    </header>
    {(error || directoryWarning || outputError || preferencesError || !preferencesReady) && <div className="certificate-notices">
      {preferencesError ? <p role="alert">{preferencesError} <button type="button" onClick={() => setPreferencesReload((value) => value + 1)}>Retry certificate preferences</button></p> : !preferencesReady && <p role="status">Loading certificate preferences…</p>}
      {error && <p role="alert">{error} {ready && <button type="button" onClick={() => setReload((value) => value + 1)}>Retry loading students</button>}</p>}
      {directoryWarning && <p role="status">{directoryWarning}</p>}
      {outputError && <p role="alert">{outputError}</p>}
    </div>}
    <div className="certificate-workspace">
      <aside className="certificate-editor" aria-label="Certificate information">
        <fieldset className="certificate-editor-fields" disabled={busy || !preferencesReady}>
        <label className="certificate-field"><span>School year</span><select value={year} disabled={!ready || loading} onChange={(event) => setYear(event.currentTarget.value)}>{!schoolYears.length && <option value="">No school years available</option>}{schoolYears.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="certificate-field"><span>Certificate template</span><select value={templateId} disabled={!preferencesReady || !templatePreference.allowTeacherTemplateChoice || templatePreference.enabledTemplates.length < 2} onChange={(event) => setRequestedTemplate(event.currentTarget.value as CertificateTemplateId)}>{CERTIFICATE_TEMPLATES[kind].filter(({ id }) => templatePreference.enabledTemplates.includes(id)).map(({ id, name }) => <option value={id} key={id}>{name}</option>)}</select><small>{templatePreference.allowTeacherTemplateChoice ? 'Choose from the templates enabled by your administrator.' : 'Your administrator has fixed the template for this certificate.'}</small></label>
        <div className="certificate-tabs" role="tablist" aria-label="Certificate editor"><button id="certificate-students-tab" type="button" role="tab" aria-selected={tab === 'students'} aria-controls="certificate-students-panel" onClick={() => setTab('students')}>Students ({students.length})</button><button id="certificate-details-tab" type="button" role="tab" aria-selected={tab === 'details'} aria-controls="certificate-details-panel" onClick={() => setTab('details')}>Information</button></div>
        <section id="certificate-students-panel" role="tabpanel" aria-labelledby="certificate-students-tab" hidden={tab !== 'students'}>
          <label className="certificate-field"><span>Search students</span><input type="search" value={search} placeholder="Name, LRN, or section" onChange={(event) => setSearch(event.currentTarget.value)} /></label>
          <label className="certificate-field"><span>Grade level</span><select value={grade} onChange={(event) => setGrade(event.currentTarget.value)}><option value="">All grades</option>{grades.map((value) => <option key={value}>{value}</option>)}</select></label>
          <p className="certificate-hint">Click a name to review its details. Check students to print one certificate per page.</p>
          <div className="certificate-selection-actions"><button type="button" disabled={!filtered.length || loading} onClick={() => setSelectedIds((previous) => [...new Set([...previous, ...filtered.map((student) => student.learnerId)])])}>Select filtered</button><button type="button" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Clear selection ({selectedIds.length})</button></div>
          <div className="certificate-student-list" aria-busy={loading}>
            {loading ? <p role="status">Loading student records…</p> : filtered.map((student) => <div key={student.learnerId} className={`certificate-student ${activeId === student.learnerId ? 'is-active' : ''}`}>
              <input type="checkbox" aria-label={`Print ${formatLearnerNameSurnameFirst(student)}`} checked={selectedIdSet.has(student.learnerId)} onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSelectedIds((previous) => checked ? [...previous, student.learnerId] : previous.filter((id) => id !== student.learnerId));
                setActiveId(student.learnerId);
              }} />
              <button type="button" aria-pressed={activeId === student.learnerId} onClick={() => setActiveId(student.learnerId)}><strong>{formatLearnerNameSurnameFirst(student, student.learnerId)}</strong><small>{text(student.gradeLevel)}{student.section ? ` · ${text(student.section)}` : ''} · {text(student.lrn || student.learnerId)}</small></button>
            </div>)}
            {!loading && !filtered.length && <p>{error ? 'Student records are unavailable.' : 'No students match. You can enter details manually.'}</p>}
          </div>
          <button className="btn btn-secondary" type="button" disabled={!ready || loading} onClick={() => { setActiveId(''); setSelectedIds([]); setTab('details'); }}>Enter a student manually</button>
        </section>
        <section id="certificate-details-panel" role="tabpanel" aria-labelledby="certificate-details-tab" hidden={tab !== 'details'}>
          <p className="certificate-hint">{activeStudent ? `Editing ${formatLearnerNameSurnameFirst(activeStudent)}.` : 'Manual certificate.'} Changes apply to this certificate only and are kept while this studio is open.</p>
          {PERSONAL_FIELDS.map((field) => fieldInput(field))}
          {kind === 'good-moral' && <label className="certificate-field"><span>Verified anecdotal record</span><textarea rows={3} value={fields.conduct} placeholder="Enter the verified record to follow ‘has’" onChange={(event) => updateField('conduct', event.currentTarget.value)} /><small>Loaded from the learner?s Anecdotal Records when available. Review the wording to follow ?has? before printing.</small></label>}
          <button type="button" className="certificate-text-button" onClick={() => setDrafts((previous) => { const next = { ...previous }; delete next[`${year}:${activeId || 'manual'}`]; return next; })}>Reset this student's information</button>
          <details className="certificate-school-details"><summary>School information & footer</summary><p className="certificate-hint">{canEditSchool ? 'Loaded from the selected school. Edits here apply to every certificate in this studio.' : 'School information is managed by your administrator. Contact them to correct missing details.'}</p>{SCHOOL_FIELDS.map((field) => fieldInput(field, true))}{canEditSchool && <button type="button" className="certificate-text-button" onClick={() => setSchoolDraft({})}>Restore school information</button>}</details>
        </section>
        </fieldset>
      </aside>
      <section className="certificate-preview-pane" aria-label="Certificate preview">
        <fieldset className="certificate-toolbar" disabled={busy} aria-label="Page layout tools">
          <label className="certificate-field"><span>Paper size</span><select value={paperSize} onChange={(event) => setPaperSize(event.currentTarget.value as PaperSizeId)}>{Object.entries(PAPER_SIZES).map(([id, value]) => <option value={id} key={id}>{value.label}</option>)}</select></label>
          <label className="certificate-field"><span>Orientation</span><select value={orientation} onChange={(event) => setOrientation(event.currentTarget.value as PaperOrientation)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          <LayoutNumber label="Outer margin (mm)" min={0} max={30} value={margin} onChange={setMargin} />
          <LayoutNumber label="Document size (%)" min={50} max={100} value={scale} onChange={setScale} />
          <LayoutNumber label="Preview zoom (%)" min={40} max={200} step={10} value={zoom} onChange={setZoom} />
          <button className="btn btn-secondary" type="button" onClick={() => { setPaperSize(preferences.defaultPaperSize); setOrientation(preferences.defaultOrientation); setMargin(0); setScale(100); setZoom(100); }}>Reset layout</button>
        </fieldset>
        <div className="certificate-preview-info">
          <p>{width} × {height} mm · {batch.length} {batch.length === 1 ? 'certificate' : 'certificates'} · {fields.studentName || 'Manual entry'}</p>
          <p className="certificate-hint">A4 portrait at 100% preserves the supplied template proportions. Size fits the document inside your margins; zoom affects only the preview. Print at 100% with browser headers and footers turned off. Word exports preserve the layout as an image.</p>
          {currentMissing.length > 0 && <p className="certificate-validation" role="status">Complete the information: {currentMissing.join(', ')}. <button type="button" onClick={() => setTab('details')}>Edit information</button></p>}
          {selectedIds.length > 0 && invalidBatch.length > 0 && <p className="certificate-validation" role="status">{invalidBatch.length} selected {invalidBatch.length === 1 ? 'student needs' : 'students need'} more information. {invalidBatch.slice(0, 3).map((entry) => <button type="button" key={entry.id} onClick={() => { setActiveId(entry.id); setTab('details'); }}>{entry.fields.studentName || entry.id}</button>)}{invalidBatch.length > 3 ? '…' : ''}</p>}
        </div>
        <div className="certificate-preview-stage" ref={stageRef}>
          <div style={{ width: width * MM_TO_PX * previewScale, height: height * MM_TO_PX * previewScale, flexShrink: 0 }}><div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>{sheet(fields)}</div></div>
        </div>
      </section>
    </div>
    <div className="certificate-print-source" ref={printRef} aria-hidden="true">{canOutput || busy ? batch.map((entry) => <div key={entry.id}>{sheet(entry.fields)}</div>) : <p className="certificate-print-incomplete">Complete the certificate information in the print studio before printing.</p>}</div>
    <div className="certificate-current-source" ref={currentExportRef} aria-hidden="true">{sheet(fields)}</div>
  </main>;
}
