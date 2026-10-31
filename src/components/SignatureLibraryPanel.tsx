import { useEffect, useRef, useState } from 'react';
import { getSignatureAsset, migrateSignatureAsset, removeSignatureAsset, saveSignatureAsset, setSignatureAssignments, subscribeSignatureLibrary } from '../lib/printable-signature-api';
import { signatureCloudinaryConfig } from '../lib/cloudinary-signatures';
import { normalizeSignatureLibrary, prepareSignatureImage, PRINTABLE_KINDS, SIGNATURE_SLOTS, type SignatureAsset, type SignatureSlot } from '../lib/printable-signatures';
import { PRINTABLES } from '../lib/printables';
import '../styles/components/printable-signatures.css';

export default function SignatureLibraryPanel() {
  const [library, setLibrary] = useState(normalizeSignatureLibrary);
  const [assignments, setAssignments] = useState(library.assignments);
  const [images, setImages] = useState<Partial<Record<SignatureSlot, SignatureAsset>>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState<SignatureSlot>('signature-1');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [threshold, setThreshold] = useState(235);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareSignatureImage>> | null>(null);
  const mounted = useRef(false);
  const inProgress = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cloudinary = signatureCloudinaryConfig();
  const uploadConfigured = !!cloudinary.cloudName && !!cloudinary.uploadPreset;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setReady(false);
    const unsubscribe = subscribeSignatureLibrary((value) => { if (active) { setLibrary(value); setAssignments(value.assignments); setReady(true); setError(''); } }, (failure) => { if (active) { setReady(false); setError(failure.message || 'Could not load signatures.'); } });
    return () => { active = false; unsubscribe(); };
  }, [reload]);
  useEffect(() => {
    let active = true;
    void Promise.all(SIGNATURE_SLOTS.map(async (id) => {
      const metadata = library.slots[id];
      if (!metadata) return;
      try { const asset = await getSignatureAsset(id, metadata.revision); if (active) setImages((previous) => ({ ...previous, [id]: asset })); }
      catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'Could not load signature preview.'); }
    }));
    return () => { active = false; };
  }, [library]);
  useEffect(() => { setPrepared(null); }, [file, removeWhite, threshold]);
  async function run(action: () => Promise<void>, success: string) {
    if (inProgress.current) return;
    inProgress.current = true; setBusy(true); setError(''); setStatus('');
    try { await action(); if (mounted.current) setStatus(success); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The signature change could not be saved.'); }
    finally { inProgress.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="panel signature-library" aria-labelledby="signatureLibraryTitle" aria-busy={busy}>
    <header className="panel-header"><div><span className="eyebrow-label">Shared assets</span><h2 id="signatureLibraryTitle">E-Signatures</h2><p>Store up to three signatures by position and choose where each is available. Adding a signature to a document is optional.</p></div></header>
    <div className="panel-body">
      {error && <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Reload library</button></p>}
      {!ready && !error && <p role="status">Loading school signatures…</p>}
      {!uploadConfigured && <p role="status">Cloudinary signature uploads are not configured. Ask the site administrator to set the Cloudinary cloud name and unsigned upload preset.</p>}
      <fieldset disabled={!ready || busy}><legend>Signature library</legend>
        <div className="signature-library-slots">{SIGNATURE_SLOTS.map((id, index) => <section className="signature-library-slot" key={id}><h3>Signature {index + 1}</h3>{library.slots[id] ? <><div className="signature-checkerboard">{images[id]?.revision === library.slots[id]?.revision && <img src={images[id]!.dataUrl} alt={library.slots[id]!.label} />}</div><strong>{library.slots[id]!.label}</strong>{images[id]?.revision === library.slots[id]?.revision && images[id]?.storage === 'firestore' && <button type="button" className="btn btn-secondary" disabled={!uploadConfigured} onClick={() => void run(() => migrateSignatureAsset(id, library.slots[id]!.revision), 'Signature moved to Cloudinary. Printable availability was preserved.')}>Move to Cloudinary</button>}<button type="button" className="btn btn-secondary" onClick={() => void run(() => removeSignatureAsset(id), 'Signature removed from the library and all printable assignments.')}>Remove signature {index + 1}</button></> : <p>Empty slot</p>}</section>)}</div>
        <div className="signature-upload-fields"><label>Upload to<select value={slot} onChange={(event) => setSlot(event.currentTarget.value as SignatureSlot)}>{SIGNATURE_SLOTS.map((id, index) => <option key={id} value={id} disabled={!!library.slots[id]}>Signature {index + 1}{library.slots[id] ? ' (occupied)' : ''}</option>)}</select></label>
          <label>Position<input maxLength={80} value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="Position" /></label>
          <label>Signature image<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.currentTarget.files?.[0] || null)} /></label>
          <label className="signature-checkbox"><input type="checkbox" checked={removeWhite} onChange={(event) => setRemoveWhite(event.currentTarget.checked)} />Remove white background</label>
          {removeWhite && <label>Background cleanup<input type="range" min={200} max={250} value={threshold} onChange={(event) => setThreshold(Number(event.currentTarget.value))} /><small>Lower values remove more of the pale background.</small></label>}
        </div>
        <p className="signature-helper">PNG, JPEG, or WebP up to 5 MB. Images are cropped, resized, and saved as transparent PNGs. Review the preview before uploading.</p>
        <div className="signature-control-actions"><button type="button" className="btn btn-secondary" disabled={!file || !!library.slots[slot]} onClick={() => void run(async () => { if (file) { const image = await prepareSignatureImage(file, removeWhite, threshold); if (mounted.current) setPrepared(image); } }, 'Preview ready. Review the signature before uploading.')}>Prepare preview</button>
          <button type="button" className="btn btn-primary" disabled={!uploadConfigured || !prepared || !label.trim() || !!library.slots[slot]} onClick={() => void run(async () => { if (!prepared) return; await saveSignatureAsset(slot, { ...prepared, label: label.trim(), revision: crypto.randomUUID() }); if (mounted.current) { setPrepared(null); setFile(null); setLabel(''); if (fileInput.current) fileInput.current.value = ''; } }, 'Signature uploaded to Cloudinary. Choose its printable assignments below.')}>Upload signature</button></div>
        {prepared && <div className="signature-checkerboard signature-upload-preview"><img src={prepared.dataUrl} alt="Prepared transparent signature" /></div>}
      </fieldset>
      <fieldset disabled={!ready || busy}><legend>Available signatures by printable</legend><p>Staff see only the signatures enabled for their printable. Teachers can use signatures on Learner Card (SF9).</p>
        <div className="signature-assignment-list">{PRINTABLE_KINDS.map((kind) => <section key={kind}><h3>{PRINTABLES[kind].title}</h3>{SIGNATURE_SLOTS.map((id, index) => <label className="signature-checkbox" key={id}><input type="checkbox" disabled={!library.slots[id]} checked={assignments[kind].includes(id)} onChange={(event) => { const checked = event.currentTarget.checked; setAssignments((previous) => ({ ...previous, [kind]: checked ? [...previous[kind], id] : previous[kind].filter((value) => value !== id) })); }} />{library.slots[id]?.label || `Signature ${index + 1} (empty)`}</label>)}</section>)}</div>
        <button type="button" className="btn btn-primary" disabled={JSON.stringify(assignments) === JSON.stringify(library.assignments)} onClick={() => void run(() => setSignatureAssignments(assignments), 'Signature availability saved for all printable studios.')}>Save signature availability</button>
      </fieldset><p role="status" aria-live="polite">{busy ? 'Working…' : status}</p>
    </div>
  </section>;
}
