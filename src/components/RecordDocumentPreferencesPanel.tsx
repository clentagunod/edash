import { useEffect, useRef, useState, type FormEvent } from 'react';
import RecordDocumentTemplate from './RecordDocumentTemplate';
import { fsGetRecordDocumentPreferences, fsSetRecordDocumentPreference } from '../lib/firestore-api';
import { DOCUMENT_PAPER_SIZES, RECORD_TEMPLATE_DIMENSIONS, normalizeRecordDocumentPreference, type DocumentPaperSizeId, type RecordDocumentPreference } from '../lib/record-document-preferences';
import { makeCertificateFields, PRINTABLES, type RecordDocumentKind } from '../lib/printables';
import { getStoredSchool } from '../lib/school-registry';
import type { PaperOrientation } from '../lib/student-card-layout';
import '../styles/components/certificate-preferences.css';

export default function RecordDocumentPreferencesPanel({ kind }: { kind: RecordDocumentKind }) {
  const [draft, setDraft] = useState(() => normalizeRecordDocumentPreference(kind));
  const [saved, setSaved] = useState<RecordDocumentPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const saveInProgress = useRef(false);
  const printable = PRINTABLES[kind];
  const dimensions = RECORD_TEMPLATE_DIMENSIONS[kind];
  const [sample] = useState(() => ({
    ...makeCertificateFields(getStoredSchool(), '2026-2027'), studentName: 'ALEX M. CRUZ', learnerId: '000000000000',
    gradeLevel: '6', previousGradeLevel: '5', previousSchoolYear: '2025-2026', previousAdviser: 'Sample Teacher',
    destinationSchoolName: 'Recipient School', destinationSchoolId: '000000', destinationSchoolAddress: 'Recipient school address',
  }));
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fsGetRecordDocumentPreferences().then((all) => {
      if (!active) return;
      setSaved(all[kind]);
      setDraft(all[kind]);
      setStatus('Preferences loaded.');
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load document preferences.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, reload]);
  function patch(value: Partial<RecordDocumentPreference>) { setDraft((previous) => ({ ...previous, ...value })); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved || loading || saveInProgress.current) return;
    saveInProgress.current = true;
    setSaving(true);
    setError('');
    try {
      const value = await fsSetRecordDocumentPreference(kind, draft);
      if (!mounted.current) return;
      setSaved(value);
      setDraft(value);
      setStatus('Preferences saved for this school.');
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not save document preferences.');
    } finally { saveInProgress.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="panel certificate-preferences-panel" aria-labelledby={`record-preferences-${kind}`} aria-busy={loading || saving}>
    <div className="certificate-preferences-heading"><span className="eyebrow-label">Printables setup</span><h2 id={`record-preferences-${kind}`}>{printable.title}</h2><p>Set the school’s print defaults. Registrars and School Admins can adjust the page layout in the studio.</p></div>
    {error && <p className="certificate-preferences-error" role="alert">{error} {!saved && !loading && <button type="button" onClick={() => setReload((value) => value + 1)}>Retry preferences</button>}</p>}
    {loading && <p role="status">Loading document preferences…</p>}
    <form onSubmit={(event) => void save(event)}><fieldset className="certificate-preferences-fields" disabled={loading || saving || !saved}>
      <section className="certificate-preference-section"><h3>Document template</h3><p>{kind === 'sf10-request' ? 'The supplied A4 school letter with permanent-records request table.' : 'The supplied outgoing-records envelope. Original Word size: 241.3 × 104.775 mm; default print size: 241 × 105 mm.'}</p><button type="button" className="btn btn-secondary" onClick={() => dialog.current?.showModal()}>Preview {printable.title}</button></section>
      <section className="certificate-preference-section"><h3>Layout & school information</h3><div className="certificate-preference-grid">
        <label className="certificate-preference-field"><span>Default paper size</span><select value={draft.defaultPaperSize} onChange={(event) => patch({ defaultPaperSize: event.currentTarget.value as DocumentPaperSizeId })}>{Object.entries(DOCUMENT_PAPER_SIZES).map(([id, paper]) => <option key={id} value={id}>{paper.label}</option>)}</select></label>
        <label className="certificate-preference-field"><span>Default orientation</span><select value={draft.defaultOrientation} onChange={(event) => patch({ defaultOrientation: event.currentTarget.value as PaperOrientation })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        {([['defaultMargin', 'Outer margin (mm)', 0, 30], ['defaultScale', 'Document size (%)', 50, 100], ['defaultTextSize', 'Text size (%)', 70, 130]] as const).map(([key, label, min, max]) => <label className="certificate-preference-field" key={key}><span>{label}</span><input type="number" min={min} max={max} value={draft[key]} onChange={(event) => patch({ [key]: Number(event.currentTarget.value) })} /></label>)}
        <label className="certificate-preference-check"><input type="checkbox" checked={draft.allowSchoolDetailsOverride} onChange={(event) => patch({ allowSchoolDetailsOverride: event.currentTarget.checked })} /><span><strong>Allow registrars to edit school details</strong><small>Allow temporary changes to the sender, signatory, logos, and footer. School Admins can always edit these in the studio.</small></span></label>
      </div></section>
      <div className="certificate-preferences-footer"><p role="status" aria-live="polite">{dirty ? 'You have unsaved changes.' : status}</p><button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => { if (saved) setDraft(saved); setError(''); }}>Discard changes</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{saving ? 'Saving…' : 'Save document preferences'}</button></div>
    </fieldset></form>
    <dialog className="certificate-template-dialog" ref={dialog} aria-label={`${printable.title} preview`} onClick={(event) => { if (event.currentTarget === event.target) dialog.current?.close(); }}><header><h3>{printable.title}</h3><button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>Close preview</button></header><div className="certificate-template-preview-scroll"><div className="certificate-template-preview-page" style={{ width: `${dimensions.width}mm`, height: `${dimensions.height}mm` }}><RecordDocumentTemplate kind={kind} fields={sample} textSize={draft.defaultTextSize} /></div></div></dialog>
  </section>;
}
