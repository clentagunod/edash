import { useRef, useState } from 'react';
import { APP_CONFIG } from '../lib/app-config';
import { parentPortalUrl } from '../lib/parent-portal-links';
import '../styles/components/parent-portal-link.css';

export default function ParentPortalLinkPanel() {
  const url = parentPortalUrl(APP_CONFIG.schoolId);
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [copying, setCopying] = useState(false);

  async function copyLink() {
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setStatus('Parent portal link copied. Use it as the destination for your school’s QR code.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setStatus('Link selected. Copy it using your browser’s copy command.');
    } finally { setCopying(false); }
  }

  return <div className="parent-portal-link-panel">
    <label htmlFor="schoolParentPortalLink">School-specific parent portal link</label>
    <p>Use this link for your school’s QR code. Parents go directly to the learner lookup without selecting a school or signing in.</p>
    <div className="parent-portal-link-actions">
      <input ref={input} id="schoolParentPortalLink" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
      <button type="button" className="btn btn-secondary" disabled={copying} onClick={() => void copyLink()}>{copying ? 'Copying…' : 'Copy link'}</button>
      <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Open portal</a>
    </div>
    <p>Parent Portal access must be enabled for families to view records.</p>
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}
