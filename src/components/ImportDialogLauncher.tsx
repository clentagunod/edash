import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSelectedSchoolYear, readStoredSchoolYear_ } from '../lib/school-year';
import '../styles/components/student-import-dialog.css';

export interface ImportPanelProps {
  authorized: boolean;
  initialYear: string;
  onBusyChange: (busy: boolean) => void;
}

/** Retain a prepared review when dismissed, and prevent dismissal during writes. */
export default function ImportDialogLauncher({ allowed, buttonId, id, title, description, closeLabel, children }: {
  allowed: boolean;
  buttonId: string;
  id: string;
  title: string;
  description: string;
  closeLabel: string;
  children: (props: ImportPanelProps) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [initialYear, setInitialYear] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const close = useCallback(() => {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }, [busy]);

  return <>
    {allowed && <button ref={trigger} id={buttonId} className="btn btn-secondary" type="button" aria-haspopup="dialog"
      onClick={() => {
        if (!started) setInitialYear(getSelectedSchoolYear() || readStoredSchoolYear_());
        setStarted(true); setOpen(true);
      }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4" /></svg>
      {title}
    </button>}
    <dialog ref={dialog} className="student-import-dialog" aria-labelledby={`${id}DialogTitle`} aria-describedby={`${id}DialogDescription`}
      onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className="student-import-dialog-heading">
        <div><span className="student-import-dialog-eyebrow">Learner Masterlist</span>
          <h2 id={`${id}DialogTitle`}>{title}</h2><p id={`${id}DialogDescription`}>{description}</p>
        </div>
        <button type="button" className="student-import-dialog-close" aria-label={closeLabel} disabled={busy} onClick={close} autoFocus>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      {started && children({ authorized: allowed, initialYear, onBusyChange: setBusy })}
      <footer className="student-import-dialog-footer">
        <span>{busy ? 'Keep this window open while processing.' : 'You can close this window and return to your review.'}</span>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Close</button>
      </footer>
    </dialog>
  </>;
}
