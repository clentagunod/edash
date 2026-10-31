import { useEffect, useState } from 'react';
import { requireAuth } from '../lib/auth';
import { appDocumentTitle } from '../lib/app-config';
import { renderShell } from '../lib/shell';
import { PRINTABLES, PRINTABLE_ICONS, printableWorkspaceHref, type PrintableKind } from '../lib/printables';
import { Icon } from '../lib/icons';
import '../styles/pages/printables.css';

export default function PrintablesPage({ kind }: { kind: PrintableKind }) {
  const printable = PRINTABLES[kind];
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    document.title = appDocumentTitle(printable.title);
    void requireAuth().then(() => {
      if (!active) return;
      renderShell(printable.navKey, printable.title);
      setReady(true);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not open this printable.');
    });
    return () => { active = false; };
  }, [printable]);

  function workspaceHref() {
    let year = '';
    try { year = sessionStorage.getItem('lps_selected_school_year') || ''; } catch { /* Optional preference. */ }
    return printableWorkspaceHref(kind, year);
  }

  return <div className="app-shell">
    <div id="sidebarMount" />
    <div className="main-area">
      <div id="topbarMount" />
      <main className="page">
        <div className="page-header"><div><h1>{printable.title}</h1><p className="desc">Printables · School records</p></div></div>
        <section className="panel printable-intro">
          <div className="panel-header"><span className="printable-element-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: Icon[PRINTABLE_ICONS[kind]] }} /><div><span className="eyebrow">Printables</span><h3>{printable.title}</h3></div></div>
          <div className="panel-body">
            <p>{printable.description}</p>
            <p className="printable-intro-note">The print studio opens in a separate tab so you can keep working here.</p>
            {ready && <a className="btn btn-primary" id="openPrintableStudio" href={workspaceHref()} target="_blank" rel="noopener noreferrer">{printable.button} <span aria-hidden="true">↗</span></a>}
            {!ready && !error && <p role="status">Loading printables…</p>}
            {error && <p role="alert">{error}</p>}
          </div>
        </section>
      </main>
    </div>
  </div>;
}
