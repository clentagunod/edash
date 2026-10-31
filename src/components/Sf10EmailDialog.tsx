import { useEffect, useRef, useState, type FormEvent } from 'react';
import { connectGmail, gmailClientId, loadGoogleIdentity, sendGmailMessage, validateGmailMessage, type GmailConnection, type GmailMessage } from '../lib/gmail-send';
import type { CertificateExportFormat } from '../lib/certificate-export';
import '../styles/components/sf10-email.css';

export default function Sf10EmailDialog({ open, onClose, prepare, count, learnerName }: { open: boolean; onClose(): void; prepare(format: CertificateExportFormat): Promise<File>; count: number; learnerName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [format, setFormat] = useState<CertificateExportFormat>('pdf');
  const [message, setMessage] = useState<GmailMessage>({ to: '', cc: '', bcc: '', replyTo: '', subject: '', body: '' });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sent, setSent] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) { if (dialog.current?.open) dialog.current.close(); setConnection(null); return; }
    dialog.current?.showModal(); setStatus(''); setError(''); setReady(false); setSent(false);
    setMessage((previous) => ({ ...previous, subject: `Request for Permanent Records (SF10) — ${count > 1 ? `${count} learners` : learnerName || 'Learner'}`, body: `Dear School Head,\n\nPlease find attached our request for the permanent records of ${count > 1 ? 'the learners listed in the attached document' : learnerName || 'the learner listed in the attached document'}.\n\nThank you.` }));
    if (!gmailClientId()) return;
    let active = true;
    void loadGoogleIdentity().then(() => { if (active) setReady(true); }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Google sign-in could not load.'); });
    return () => { active = false; };
  }, [open]);
  function close() { if (!sending.current && !busy) onClose(); }
  function connect() {
    if (busy) return;
    setBusy(true); setError('');
    void connectGmail().then((value) => { if (alive.current) { setConnection(value); setStatus(`Connected as ${value.email}.`); } }).catch((failure: unknown) => { if (alive.current) setError(failure instanceof Error ? failure.message : 'Could not connect Gmail.'); }).finally(() => { if (alive.current) setBusy(false); });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!connection || busy || sending.current || sent) return;
    try { validateGmailMessage(message); } catch (failure) { setError((failure as Error).message); return; }
    sending.current = true; setBusy(true); setError(''); setStatus('Preparing the attachment…');
    try {
      const file = await prepare(format);
      if (!alive.current) return;
      setStatus('Sending with Gmail…');
      await sendGmailMessage(connection, message, file);
      if (alive.current) { setSent(true); setStatus(`Email sent to ${message.to}. The attachment is also available in your Gmail Sent folder.`); }
    } catch (failure) { if (alive.current) { setStatus(''); setError(failure instanceof Error ? failure.message : 'The email could not be sent.'); } }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  function field(key: keyof GmailMessage, label: string, required = false) { return <label>{label}<input value={message[key]} required={required} maxLength={key === 'subject' ? 200 : 3000} onChange={(event) => { const value = event.currentTarget.value; setMessage((previous) => ({ ...previous, [key]: value })); }} /></label>; }
  return <dialog className="sf10-email-dialog" ref={dialog} aria-labelledby="sf10EmailTitle" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header><div><span className="eyebrow-label">Request for Permanent Records</span><h2 id="sf10EmailTitle">Send with Gmail</h2></div><button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>Close</button></header>
    <form onSubmit={(event) => void send(event)}><fieldset disabled={busy || sent}>
      <section className="sf10-email-account"><p>{connection ? `From: ${connection.email}` : 'Choose the Google account that will send this request.'}</p><button className="btn btn-secondary" type="button" disabled={!ready} onClick={connect}>{connection ? 'Change sending account' : 'Connect Gmail account'}</button></section>
      {!gmailClientId() && <p role="status">Gmail sending needs to be configured for this website. Ask the site administrator to enable the Gmail API and set the Google OAuth client ID.</p>}
      <label>Attachment type<select value={format} onChange={(event) => setFormat(event.currentTarget.value as CertificateExportFormat)}><option value="pdf">PDF · all {count} selected document(s)</option><option value="docx">Word (.docx) · all {count} selected document(s)</option><option value="png">PNG · current preview only</option></select></label>
      {field('to', 'To · recipient email', true)}<p className="sf10-email-hint">Separate multiple addresses with commas. Gmail and other school email addresses are supported.</p>
      <details><summary>CC, BCC, and Reply-to</summary><div className="sf10-email-optional">{field('cc', 'CC')}{field('bcc', 'BCC')}{field('replyTo', 'Reply-to (optional)')}</div></details>
      {field('subject', 'Subject', true)}<label>Message<textarea rows={7} required maxLength={20000} value={message.body} onChange={(event) => { const value = event.currentTarget.value; setMessage((previous) => ({ ...previous, body: value })); }} /></label>
    </fieldset>{error && <p className="sf10-email-error" role="alert">{error}</p>}<p role="status" aria-live="polite">{status}</p>
      <footer><p>The attachment uses your current layout, selected learners, and placed signature.</p><button type="submit" className="btn btn-primary" disabled={!connection || busy || sent}>{sent ? 'Email sent' : busy ? 'Working…' : 'Send email with attachment'}</button></footer>
    </form>
  </dialog>;
}
