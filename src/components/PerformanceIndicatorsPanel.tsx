import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fsGetCurrentSchoolYear } from '../lib/firestore-api';
import { getPerformanceConfig, savePerformanceConfig } from '../lib/performance-indicators-api';
import {
  emptyPerformanceConfig, formatPerformanceRate, formatPerformanceVariance, MAX_PERFORMANCE_COUNT,
  normalizePerformanceYear, PERFORMANCE_INDICATORS, PERFORMANCE_WINDOW_OPTIONS, performanceLabels,
  performanceRate, performanceVariance, performanceYear, validatePerformanceConfig,
  type PerformanceConfig, type PerformanceEntry, type PerformanceIndicatorId, type PerformanceWindow,
} from '../lib/performance-indicators';
import {
  mergePerformanceImport, performanceCsv, readPerformanceFile, type PerformanceImportResult,
} from '../lib/performance-indicators-import';
import PerformanceIndicatorOverview from './PerformanceIndicatorOverview';
import '../styles/components/performance-indicators.css';

function downloadCsv(contents: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed. Please try again.';

export default function PerformanceIndicatorsPanel() {
  const [draft, setDraft] = useState<PerformanceConfig>(emptyPerformanceConfig);
  const [saved, setSaved] = useState<PerformanceConfig | null>(null);
  const [currentYear, setCurrentYear] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [newYear, setNewYear] = useState('');
  const [addIndicator, setAddIndicator] = useState<PerformanceIndicatorId>('graduation');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [importPreview, setImportPreview] = useState<PerformanceImportResult | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = !!saved && JSON.stringify(saved) !== JSON.stringify(draft);
  const years = Object.keys(draft.configurations).sort().reverse();
  const entries = draft.configurations[selectedYear]?.indicators || {};
  const availableIndicators = PERFORMANCE_INDICATORS.filter(item => !entries[item.id]);
  const selectedAddIndicator = availableIndicators.some(item => item.id === addIndicator) ? addIndicator : availableIndicators[0]?.id;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void Promise.all([getPerformanceConfig(), fsGetCurrentSchoolYear()]).then(([config, year]) => {
      if (!active) return;
      setDraft(config); setSaved(config); setCurrentYear(normalizePerformanceYear(year) || '');
      setSelectedYear(Object.keys(config.configurations).sort().reverse()[0] || '');
      setNewYear(year ? String(Number(year.slice(0, 4)) - 1) : '');
      setStatus(''); setImportPreview(null);
    }).catch(error => { if (active) setError(message(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update(next: PerformanceConfig) { setDraft(next); setStatus('Unsaved changes'); setError(''); }
  function updateEntry(id: PerformanceIndicatorId, patch: Partial<PerformanceEntry>) {
    update({ ...draft, configurations: { ...draft.configurations, [selectedYear]: {
      indicators: { ...entries, [id]: { ...entries[id], ...patch } },
    } } });
  }
  function addYear() {
    const start = Number(newYear), year = performanceYear(start);
    if (!/^\d{4}$/.test(newYear) || !normalizePerformanceYear(year)) { setError('Enter a valid four-digit starting year.'); return; }
    if (!currentYear) { setError('Set the current school year in School structure before adding performance years.'); return; }
    if (year > currentYear) { setError(`Choose the current school year (${currentYear}) or an earlier year.`); return; }
    if (draft.configurations[year]) { setSelectedYear(year); setError(`${year} is already available. Select an indicator below.`); return; }
    try {
      update(validatePerformanceConfig({ ...draft, configurations: { ...draft.configurations, [year]: { indicators: {} } } }));
      setSelectedYear(year); setNewYear(String(start - 1));
    } catch (error) { setError(message(error)); }
  }
  function removeYear() {
    if (!window.confirm(`Remove ${selectedYear} and its performance indicator data? Save changes to apply this removal.`)) return;
    const configurations = { ...draft.configurations }; delete configurations[selectedYear];
    update({ ...draft, configurations }); setSelectedYear(Object.keys(configurations).sort().reverse()[0] || '');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || !saved) return;
    busyRef.current = true; setBusy(true); setError(''); setStatus('Saving performance indicators…');
    try {
      const result = await savePerformanceConfig(draft);
      if (mounted.current) { setDraft(result); setSaved(result); setStatus('Saved. Performance indicators are available to everyone in this school.'); }
    } catch (error) { if (mounted.current) { setError(message(error)); setStatus('Your draft has not been saved.'); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file || busyRef.current || !currentYear) return;
    busyRef.current = true; setBusy(true); setError(''); setImportPreview(null);
    try {
      const result = await readPerformanceFile(file, currentYear);
      if (mounted.current) { setImportPreview(result); setOverwrite(false); }
    } catch (error) { if (mounted.current) setError(message(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  function applyImport() {
    if (!importPreview) return;
    try {
      const next = validatePerformanceConfig(mergePerformanceImport(draft, importPreview.rows, overwrite));
      update(next); setSelectedYear(importPreview.rows[0].year); setImportPreview(null);
      setStatus('Import applied to your draft. Review the data, then save changes to publish it.');
    } catch (error) { setError(message(error)); }
  }
  function reloadConfig() {
    if (dirty && !window.confirm('Discard your unsaved performance indicator changes and reload?')) return;
    setReload(value => value + 1);
  }

  return <div className="pi-admin">
    <div className="admin-section-label"><div><h2>Performance Indicators</h2><small>Manage historical school performance and the dashboard year window.</small></div></div>
    {error && <div className="pi-message pi-message-error" role="alert">{error}</div>}
    {loading ? <div className="pi-empty" role="status">Loading performance indicators…</div> : !saved ?
      <button type="button" className="btn btn-secondary" onClick={reloadConfig}>Try again</button> : <>
      <div className="pi-import-tools">
        <div><strong>Bring your historical data</strong><p>Import the Performance Indicator workbook or a table with School Year, Indicator, Numerator, and Denominator columns. Rates and variance are recalculated.</p></div>
        <div className="pi-actions">
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv,.ods" hidden aria-label="Import performance indicator file" onChange={event => void importFile(event.target.files?.[0])} />
          <button className="btn btn-primary" type="button" disabled={busy || !currentYear} onClick={() => fileInput.current?.click()}>{busy ? 'Please wait…' : 'Import from Excel / CSV'}</button>
          <button className="btn btn-secondary" type="button" disabled={busy || !currentYear} onClick={() => downloadCsv(performanceCsv(undefined, currentYear), 'performance-indicators-template.csv')}>CSV template</button>
          <button className="btn btn-secondary" type="button" disabled={busy || !years.length} onClick={() => downloadCsv(performanceCsv(draft), 'performance-indicators-draft.csv')}>Export draft</button>
        </div>
      </div>
      {!currentYear && <p className="pi-message">Configure the current school year in School structure to add years or import data.</p>}
      {importPreview && <section className="pi-import-preview" aria-label="Performance indicator import preview">
        <h3>Review import</h3>
        <p>{importPreview.rows.length} valid indicators across {new Set(importPreview.rows.map(row => row.year)).size} school years. {importPreview.ignoredSheets} unrelated sheets ignored.</p>
        <label className="pi-checkbox"><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />Replace matching indicators already in this draft</label>
        <p className="pi-muted">{importPreview.rows.filter(row => draft.configurations[row.year]?.indicators[row.id]).length} existing indicators will be {overwrite ? 'replaced' : 'kept'}. Other indicators and school years are preserved.</p>
        {importPreview.warnings.length > 0 && <details className="pi-import-warnings"><summary>{importPreview.warnings.length} import notices — review skipped or incomplete data</summary><ul>{importPreview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className="pi-table-scroll"><table className="data-table"><thead><tr><th>School year</th><th>Indicator</th><th>Numerator</th><th>Denominator</th><th>Rate</th></tr></thead><tbody>
          {importPreview.rows.map(row => <tr key={`${row.year}/${row.id}`}><td>{row.year}</td><td>{PERFORMANCE_INDICATORS.find(item => item.id === row.id)?.label}</td><td>{row.entry.numerator}</td><td>{row.entry.denominator}</td><td>{formatPerformanceRate(performanceRate(row.entry))}</td></tr>)}
        </tbody></table></div>
        <div className="pi-actions"><button type="button" className="btn btn-primary" onClick={applyImport}>Apply to draft</button><button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>Cancel import</button></div>
      </section>}
      <form onSubmit={event => void save(event)}>
        <fieldset className="pi-fieldset" disabled={busy}>
          <section className="pi-settings-row">
            <label className="pi-field"><span>Dashboard year window</span><select value={draft.windowYears} onChange={event => update({ ...draft, windowYears: Number(event.target.value) as PerformanceWindow })}>{PERFORMANCE_WINDOW_OPTIONS.map(years => <option key={years} value={years}>{years} school years{years === 5 ? ' (default)' : ''}</option>)}</select><small>Applies to every dashboard viewer.</small></label>
            <div className="pi-field"><label htmlFor="pi-new-year">Add a performance school year</label><div className="pi-actions"><input id="pi-new-year" type="text" inputMode="numeric" maxLength={4} value={newYear} onChange={event => setNewYear(event.target.value)} placeholder="Starting year" /><button type="button" className="btn btn-secondary" onClick={addYear} disabled={!currentYear}>Add {/^\d{4}$/.test(newYear) ? performanceYear(Number(newYear)) : 'year'}</button></div><small>Independent of School structure. Current school year: {currentYear || 'not set'}.</small></div>
          </section>
          {years.length ? <>
            <div className="pi-editor-toolbar"><label className="pi-field"><span>School year to edit</span><select value={selectedYear} onChange={event => setSelectedYear(event.target.value)}>{years.map(year => <option key={year}>{year}</option>)}</select></label><button type="button" className="btn btn-secondary pi-remove" onClick={removeYear}>Remove school year</button></div>
            <div className="pi-editor-list">
              {PERFORMANCE_INDICATORS.filter(item => entries[item.id]).map(item => {
                const entry = entries[item.id]!, defaults = performanceLabels(item.id, selectedYear);
                const rate = performanceRate(entry), variance = performanceVariance(draft, selectedYear, item.id);
                return <article className="pi-editor-card" key={`${selectedYear}/${item.id}`}>
                  <div className="pi-editor-heading"><h3>{item.label}</h3><button className="pi-text-button pi-remove" type="button" aria-label={`Remove ${item.label} from ${selectedYear}`} onClick={() => { const indicators = { ...entries }; delete indicators[item.id]; update({ ...draft, configurations: { ...draft.configurations, [selectedYear]: { indicators } } }); }}>Remove</button></div>
                  <div className="pi-count-grid">{(['numerator', 'denominator'] as const).map((field, index) => <div className="pi-count-field" key={field}>
                    <label className="pi-field"><span>{field === 'numerator' ? 'Numerator · computational guide' : 'Denominator · computational guide'}</span><input type="text" maxLength={300} required value={entry[`${field}Label`] ?? defaults[index]} onChange={event => updateEntry(item.id, { [`${field}Label`]: event.target.value })} aria-label={`${item.label} ${field} label`} /></label>
                    <label className="pi-field"><span>Count</span><input type="number" min="0" max={MAX_PERFORMANCE_COUNT} step="1" value={entry[field] ?? ''} placeholder="Enter count" aria-label={`${item.label} ${field} count`} onChange={event => updateEntry(item.id, { [field]: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                  </div>)}</div>
                  <div className="pi-formula"><span>(Numerator ÷ Denominator) × 100</span><strong>{formatPerformanceRate(rate)}</strong><span>Variance: {formatPerformanceVariance(variance)}</span></div>
                  {rate === null && <p className="pi-muted">Enter both counts with a denominator greater than zero to calculate the rate.</p>}
                </article>;
              })}
            </div>
            {availableIndicators.length > 0 && <div className="pi-actions pi-add-indicator"><label className="pi-field"><span>Add an indicator to {selectedYear}</span><select value={selectedAddIndicator} onChange={event => setAddIndicator(event.target.value as PerformanceIndicatorId)}>{availableIndicators.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" className="btn btn-secondary" onClick={() => { if (selectedAddIndicator) updateEntry(selectedAddIndicator, { numerator: null, denominator: null }); }}>Add indicator</button></div>}
          </> : <div className="pi-empty"><strong>Start your performance history</strong><p>Add a school year above, or import your existing workbook.</p></div>}
          <div className="pi-save-bar"><span role="status" aria-live="polite">{status || 'Rates and variance update automatically. Variance is measured in percentage points (pp).'}</span><div className="pi-actions"><button type="button" className="btn btn-secondary" onClick={reloadConfig}>Reload</button><button className="btn btn-primary" type="submit" disabled={!dirty}>{busy ? 'Saving…' : 'Save changes'}</button></div></div>
        </fieldset>
      </form>
      <button type="button" className="pi-text-button" aria-expanded={showPreview} onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Hide dashboard preview' : 'Preview dashboard with this draft'}</button>
      {showPreview && <div className="pi-draft-preview"><PerformanceIndicatorOverview config={draft} /></div>}
    </>}
  </div>;
}
