import { useCallback, useEffect, useRef, useState } from 'react';
import { isSchoolAdmin, isTeacher } from '../lib/app-config';
import { fsSubscribeImportConfiguration } from '../lib/firestore-api';
import { getSelectedSchoolYear, readStoredSchoolYear_ } from '../lib/school-year';
import StudentImportPanel from './StudentImportPanel';
import '../styles/components/student-import-dialog.css';

/** Mounted only after the Masterlist authentication guard has completed. */
export default function StudentImportLauncher({ onComplete }: { onComplete: () => void }) {
  const [allowed, setAllowed] = useState(isSchoolAdmin);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [initialYear, setInitialYear] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSchoolAdmin()) { setAllowed(true); return; }
    setAllowed(false);
    if (!isTeacher()) return;
    return fsSubscribeImportConfiguration(
      configuration => setAllowed(configuration.canTeacherImport === true),
      () => setAllowed(false),
    );
  }, []);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const close = useCallback(() => {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }, [busy]);
  const complete = useCallback(() => onComplete(), [onComplete]);

  return <>
    {allowed && <button ref={trigger} id="importStudentsBtn" className="btn btn-secondary" type="button"
      aria-haspopup="dialog" onClick={() => {
        if (!started) setInitialYear(getSelectedSchoolYear() || readStoredSchoolYear_());
        setStarted(true); setOpen(true);
      }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg>
      Import Students
    </button>}
    <dialog ref={dialog} className="student-import-dialog" aria-labelledby="studentImportDialogTitle"
      aria-describedby="studentImportDialogDescription" onCancel={event => { event.preventDefault(); close(); }}
      onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className="student-import-dialog-heading">
        <div><span className="student-import-dialog-eyebrow">Learner Masterlist</span>
          <h2 id="studentImportDialogTitle">Import Students</h2>
          <p id="studentImportDialogDescription">Choose a file, review the records, then confirm the import.</p>
        </div>
        <button type="button" className="student-import-dialog-close" aria-label="Close student import"
          disabled={busy} onClick={close} autoFocus>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      {started && <StudentImportPanel authorized={allowed} initialYear={initialYear} onBusyChange={setBusy} onComplete={complete} />}
      <footer className="student-import-dialog-footer">
        <span>{busy ? 'Keep this window open while processing.' : 'You can close this window and return to your review.'}</span>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Close</button>
      </footer>
    </dialog>
  </>;
}
