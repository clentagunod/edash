import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { getSignatureAsset, subscribeSignatureLibrary } from '../lib/printable-signature-api';
import { clampSignaturePlacement, signatureBoxMetrics, normalizeSignatureLibrary, type SignatureAsset, type SignaturePlacement, type SignatureSlot } from '../lib/printable-signatures';
import type { PrintableKind } from '../lib/printables';
import '../styles/components/printable-signatures.css';

export interface SignatureController { render(surface?: string, interactive?: boolean): ReactNode }
function SignatureOverlay({ asset, placement, surfaceAspect, onChange }: { asset: SignatureAsset; placement: SignaturePlacement; surfaceAspect: number; onChange?: (next: SignaturePlacement) => void }) {
  const drag = useRef<{ x: number; y: number; width: number; height: number; placement: SignaturePlacement; mode: 'move' | 'resize' }>();
  const aspect = asset.width / asset.height;
  const metrics = signatureBoxMetrics(placement, aspect, surfaceAspect);
  function begin(event: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (!onChange || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = event.currentTarget.closest('.printable-signature')!.parentElement!.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, placement, mode };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || !onChange) return;
    const dx = (event.clientX - start.x) / start.width, dy = (event.clientY - start.y) / start.height;
    const shape = signatureBoxMetrics(start.placement, aspect, surfaceAspect);
    const next = start.mode === 'move' ? { ...start.placement, x: start.placement.x + dx, y: start.placement.y + dy }
      : { ...start.placement, width: start.placement.width + (dx * shape.widthFactor + dy * shape.heightFactor) / (shape.widthFactor ** 2 + shape.heightFactor ** 2) };
    onChange(clampSignaturePlacement(next, aspect, surfaceAspect));
  }
  return <div className={`printable-signature${onChange ? ' is-draggable' : ''}`} style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${metrics.width * 100}%`, height: `${metrics.height * 100}%` } as CSSProperties}
    role={onChange ? 'img' : undefined} aria-label={onChange ? `${asset.label}. Drag to move; arrow keys adjust position.` : undefined} tabIndex={onChange ? 0 : undefined}
    onPointerDown={onChange ? (event) => begin(event, 'move') : undefined}
    onPointerMove={move} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
    onKeyDown={onChange ? (event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .01 : .002; onChange(clampSignaturePlacement({ ...placement, x: placement.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: placement.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }, aspect, surfaceAspect)); } : undefined}>
    <img src={asset.dataUrl} alt={asset.label} draggable={false} style={{ position: 'absolute', left: '50%', top: '50%', width: `${placement.width / metrics.width * 100}%`, height: `${placement.width * surfaceAspect / aspect / metrics.height * 100}%`, transform: `translate(-50%, -50%) rotate(${metrics.angle}deg)` }} />
    {onChange && <button type="button" className="signature-resize-handle" aria-label="Resize E-Signature" title="Drag to resize" onPointerDown={(event) => begin(event, 'resize')} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); onChange(clampSignaturePlacement({ ...placement, width: placement.width + (['ArrowRight', 'ArrowDown'].includes(event.key) ? .005 : -.005) }, aspect, surfaceAspect)); }} />}
  </div>;
}

export function usePrintableSignature(kind: PrintableKind, enabled: boolean, surface = 'document') {
  const [library, setLibrary] = useState(normalizeSignatureLibrary);
  const [slot, setSlot] = useState<SignatureSlot | ''>('');
  const [asset, setAsset] = useState<SignatureAsset | null>(null);
  const [placements, setPlacements] = useState<Record<string, SignaturePlacement | null>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = subscribeSignatureLibrary((value) => { if (active) { setLibrary(value); setError(''); } }, () => { if (active) { setLibrary(normalizeSignatureLibrary()); setError('School signatures could not be loaded.'); } }); }
    catch { setError('School signatures could not be loaded.'); }
    return () => { active = false; unsubscribe?.(); };
  }, [enabled, reload]);
  const revision = slot ? library.slots[slot]?.revision : undefined;
  const allowed = library.assignments[kind];
  const approved = !!slot && allowed.includes(slot);
  useEffect(() => {
    let active = true;
    setAsset(null);
    if (!slot || !revision || !approved) { setLoading(false); return; }
    setLoading(true); setError('');
    void getSignatureAsset(slot, revision).then((value) => { if (active) setAsset(value); }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Could not load the signature.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slot, revision, approved, reload]);
  const surfaceAspect = kind === 'student-card' ? 470 / 884 : kind === 'outgoing-envelope' ? 241.3 / 104.775 : 210 / 297;
  const activeAsset = asset?.revision === revision && approved ? asset : null;
  const placement = placements[surface];
  const defaults = { x: kind === 'student-card' ? .15 : .6, y: kind === 'outgoing-envelope' ? .2 : kind === 'student-card' ? (surface === 'back' ? .78 : .28) : .64, width: kind === 'student-card' ? .3 : .22 };
  function change(next: SignaturePlacement) { if (activeAsset) setPlacements((previous) => ({ ...previous, [surface]: clampSignaturePlacement(next, activeAsset.width / activeAsset.height, surfaceAspect) })); }
  const controller: SignatureController = { render(target = 'document', interactive = false) {
    const value = placements[target];
    return activeAsset && value ? <SignatureOverlay asset={activeAsset} placement={clampSignaturePlacement(value, activeAsset.width / activeAsset.height, surfaceAspect)} surfaceAspect={surfaceAspect} onChange={interactive ? (next) => setPlacements((previous) => ({ ...previous, [target]: next })) : undefined} /> : null;
  } };
  return { controller, ready: !slot || (!!activeAsset && !loading), controls: <details className="signature-studio-controls" aria-label="E-Signatures">
    <summary>E-Signatures <small>Optional</small></summary><p>Choose an approved signature, place it, then drag it or its corner handle on the preview. Placement applies to this batch{kind === 'student-card' ? ` · ${surface} side` : ''}.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Retry signatures</button></p>}
    <label>Signature<select value={slot} onChange={(event) => { setSlot(event.currentTarget.value as SignatureSlot | ''); setPlacements({}); }}><option value="">No signature</option>{allowed.map((id) => <option key={id} value={id}>{library.slots[id]?.label}</option>)}</select></label>
    {!allowed.length && !error && <p>No signatures are enabled for this printable. A School Admin can configure them in Printables.</p>}
    {loading && <p role="status">Loading signature…</p>}
    {activeAsset && <><div className="signature-checkerboard signature-studio-swatch"><img src={activeAsset.dataUrl} alt={activeAsset.label} /></div><div className="signature-control-actions"><button className="btn btn-secondary" type="button" onClick={() => change(defaults)}>{placement ? 'Reset placement' : 'Place signature'}</button>{placement && <button className="btn btn-secondary" type="button" onClick={() => setPlacements((previous) => ({ ...previous, [surface]: null }))}>Remove from {kind === 'student-card' ? 'this side' : 'document'}</button>}</div>
      {placement && <div className="signature-position-fields">{(['x', 'y', 'width'] as const).map((key) => <label key={key}>{key === 'x' ? 'Left (%)' : key === 'y' ? 'Top (%)' : 'Width (%)'}<input type="number" min={key === 'width' ? 5 : 0} max={key === 'width' ? 70 : 100} step={.5} value={Math.round(placement[key] * 1000) / 10} onChange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value)) change({ ...placement, [key]: value / 100 }); }} /></label>)}</div>}</>}
    {activeAsset && placement && <div className="signature-transform-fields"><label>Signature orientation<select value={placement.orientation || 'horizontal'} onChange={(event) => change({ ...placement, orientation: event.currentTarget.value as 'horizontal' | 'vertical' })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label><label>Rotation (degrees)<input type="number" min={-180} max={180} step={1} value={placement.rotation || 0} onChange={(event) => change({ ...placement, rotation: Math.max(-180, Math.min(180, Number(event.currentTarget.value) || 0)) })} /><input type="range" aria-label="Rotate E-Signature" min={-180} max={180} value={placement.rotation || 0} onChange={(event) => change({ ...placement, rotation: Number(event.currentTarget.value) })} /></label></div>}
  </details> };
}
