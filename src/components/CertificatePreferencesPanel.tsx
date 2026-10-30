import { useEffect, useRef, useState, type FormEvent } from 'react';
import CertificateTemplate from './CertificateTemplate';
import { CERTIFICATE_KINDS, CERTIFICATE_TEMPLATES, normalizeCertificatePreferences, type CertificatePreferences, type CertificateTemplateId } from '../lib/certificate-preferences';
import { fsGetCertificatePreferences, fsSetCertificatePreferences } from '../lib/firestore-api';
import { makeCertificateFields, type CertificateKind } from '../lib/printables';
import { getStoredSchool } from '../lib/school-registry';
import { PAPER_SIZES, type PaperOrientation, type PaperSizeId } from '../lib/student-card-layout';
import '../styles/components/certificate-preferences.css';

const kindName = (kind: CertificateKind) => kind === 'good-moral' ? 'Good Moral' : 'Certificate of Enrollment';

export default function CertificatePreferencesPanel() {
  const [draft, setDraft] = useState(normalizeCertificatePreferences);
  const [saved, setSaved] = useState<CertificatePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ kind: CertificateKind; id: CertificateTemplateId } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const savingRef = useRef(false);
  const [previewFields] = useState(() => ({
    ...makeCertificateFields(getStoredSchool(), '2026-2027'),
    studentName: 'SAMPLE LEARNER', learnerId: '000000000000', gradeLevel: '6', section: 'Sample Section',
    conduct: 'demonstrated good moral character',
  }));
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fsGetCertificatePreferences().then((value) => {
      if (!active) return;
      setDraft(value);
      setSaved(value);
      setStatus('Certificate preferences loaded.');
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load certificate preferences.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);

  function updateTemplate(kind: CertificateKind, patch: Partial<CertificatePreferences['templates'][CertificateKind]>) {
    setStatus('You have unsaved changes.');
    setDraft((previous) => ({ ...previous, templates: { ...previous.templates, [kind]: { ...previous.templates[kind], ...patch } } }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !saved || loading) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setStatus('Saving certificate preferences…');
    try {
      const value = await fsSetCertificatePreferences(draft);
      if (!mounted.current) return;
      setSaved(value);
      setDraft(value);
      setStatus('Certificate preferences saved for everyone in this school.');
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : 'Could not save certificate preferences.');
        setStatus('Changes have not been saved. Please try again.');
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <section className="panel certificate-preferences-panel" aria-labelledby="certificate-preferences-title" aria-busy={loading || saving}>
    <div className="certificate-preferences-heading"><span className="eyebrow-label">Printables setup</span><h2 id="certificate-preferences-title">Certificates Preferences</h2><p>Choose the templates teachers can use and the default for each certificate. Saved preferences apply across this school.</p></div>
    {error && <p className="certificate-preferences-error" role="alert">{error} {!saved && !loading && <button type="button" className="btn btn-secondary" onClick={() => setReload((value) => value + 1)}>Retry preferences</button>}</p>}
    {loading && <p role="status">Loading certificate preferences…</p>}
    <form onSubmit={(event) => void save(event)}>
      <fieldset className="certificate-preferences-fields" disabled={loading || saving || !saved}>
        {CERTIFICATE_KINDS.map((kind) => {
          const config = draft.templates[kind];
          return <section className="certificate-preference-section" key={kind} aria-labelledby={`certificate-preference-${kind}`}>
            <h3 id={`certificate-preference-${kind}`}>{kindName(kind)}</h3>
            <p>{kind === 'good-moral' ? 'The default template is available now. Additional templates can be added later.' : 'Enable the COE layouts you want to make available to teachers.'}</p>
            <div className="certificate-template-options">
              {CERTIFICATE_TEMPLATES[kind].map((template) => {
                const enabled = config.enabledTemplates.includes(template.id);
                return <article className={`certificate-template-option${enabled ? ' is-enabled' : ''}`} key={template.id}>
                  <label><input type="checkbox" checked={enabled} disabled={enabled && config.enabledTemplates.length === 1} onChange={(event) => {
                    const enabledTemplates = event.currentTarget.checked ? [...config.enabledTemplates, template.id] : config.enabledTemplates.filter((id) => id !== template.id);
                    updateTemplate(kind, { enabledTemplates, defaultTemplate: enabledTemplates.includes(config.defaultTemplate) ? config.defaultTemplate : enabledTemplates[0] });
                  }} /><strong>{template.name}</strong><span>{enabled ? 'Available' : 'Disabled'}</span></label>
                  <p>{template.description}</p>
                  <button className="btn btn-secondary" type="button" onClick={() => setPreview({ kind, id: template.id })}>Preview {template.name}</button>
                </article>;
              })}
            </div>
            <div className="certificate-preference-grid">
              <label className="certificate-preference-field"><span>Default {kind === 'good-moral' ? 'Good Moral' : 'COE'} template</span><select value={config.defaultTemplate} onChange={(event) => updateTemplate(kind, { defaultTemplate: event.currentTarget.value as CertificateTemplateId })}>{CERTIFICATE_TEMPLATES[kind].filter(({ id }) => config.enabledTemplates.includes(id)).map(({ id, name }) => <option value={id} key={id}>{name}</option>)}</select></label>
              <label className="certificate-preference-check"><input type="checkbox" checked={config.allowTeacherTemplateChoice} onChange={(event) => updateTemplate(kind, { allowTeacherTemplateChoice: event.currentTarget.checked })} /><span><strong>Let teachers choose a template</strong><small>When off, every certificate uses the default template.</small></span></label>
            </div>
          </section>;
        })}
        <section className="certificate-preference-section" aria-labelledby="certificate-output-preferences">
          <h3 id="certificate-output-preferences">Layout & school information</h3>
          <p>These defaults apply to both certificate types. Teachers can adjust the paper layout in the print studio.</p>
          <div className="certificate-preference-grid">
            <label className="certificate-preference-field"><span>Default paper size</span><select value={draft.defaultPaperSize} onChange={(event) => setDraft({ ...draft, defaultPaperSize: event.currentTarget.value as PaperSizeId })}>{Object.entries(PAPER_SIZES).map(([id, size]) => <option value={id} key={id}>{size.label}</option>)}</select></label>
            <label className="certificate-preference-field"><span>Default orientation</span><select value={draft.defaultOrientation} onChange={(event) => setDraft({ ...draft, defaultOrientation: event.currentTarget.value as PaperOrientation })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
            <label className="certificate-preference-check"><input type="checkbox" checked={draft.allowSchoolDetailsOverride} onChange={(event) => setDraft({ ...draft, allowSchoolDetailsOverride: event.currentTarget.checked })} /><span><strong>Allow teachers to edit school details</strong><small>Allow temporary changes to the signatory, school information, logos, and footer. Administrators can always edit these in the studio.</small></span></label>
            <label className="certificate-preference-check"><input type="checkbox" checked={draft.showSealNotice} onChange={(event) => setDraft({ ...draft, showSealNotice: event.currentTarget.checked })} /><span><strong>Show school-seal notice</strong><small>Include “Not valid without school seal” on printed and exported certificates.</small></span></label>
          </div>
        </section>
        <div className="certificate-preferences-footer">
          <p role="status" aria-live="polite">{dirty && !saving ? 'You have unsaved changes.' : status}</p>
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => { if (saved) setDraft(saved); setError(''); setStatus('Unsaved changes discarded.'); }}>Discard changes</button>
          <button type="submit" className="btn btn-primary" disabled={!dirty}>{saving ? 'Saving…' : 'Save certificate preferences'}</button>
        </div>
      </fieldset>
    </form>
    <dialog ref={dialog} className="certificate-template-dialog" aria-labelledby="certificate-template-preview-title" onClose={() => setPreview(null)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {preview && <><header><div><h3 id="certificate-template-preview-title">{CERTIFICATE_TEMPLATES[preview.kind].find(({ id }) => id === preview.id)?.name}</h3><p>Sample preview using this school’s information. Missing school details remain blank.</p></div><button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>Close preview</button></header><div className="certificate-template-preview-scroll"><div className="certificate-template-preview-page"><CertificateTemplate kind={preview.kind} templateId={preview.id} fields={previewFields} showSealNotice={draft.showSealNotice} /></div></div></>}
    </dialog>
  </section>;
}
