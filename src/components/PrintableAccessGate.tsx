import { useEffect, useState, type ReactNode } from 'react';
import { requireAuth } from '../lib/auth';
import { canAccessPrintable } from '../lib/printable-access';
import type { PrintableKind } from '../lib/printables';

export default function PrintableAccessGate({ kind, children }: { kind: PrintableKind; children: ReactNode }) {
  const [access, setAccess] = useState<{ kind: PrintableKind; status: 'checking' | 'allowed' | 'denied' | 'error' }>({ kind, status: 'checking' });
  const status = access.kind === kind ? access.status : 'checking';
  useEffect(() => {
    let active = true;
    setAccess({ kind, status: 'checking' });
    void requireAuth().then(() => {
      if (active) setAccess({ kind, status: canAccessPrintable(kind) ? 'allowed' : 'denied' });
    }).catch(() => { if (active) setAccess({ kind, status: 'error' }); });
    return () => { active = false; };
  }, [kind]);
  if (status === 'allowed') return <>{children}</>;
  return <main className="page" aria-live="polite">
    {status === 'checking' ? <p role="status">Checking printable access…</p> : <section className="panel printable-intro"><div className="panel-body">
      <h1>{status === 'denied' ? 'This printable is restricted' : 'Could not verify your access'}</h1>
      <p>{status === 'denied' ? 'Teachers can use Learner Card (SF9). Other printables are available to Registrars and School Admins.' : 'Refresh the page to check your signed-in role again.'}</p>
      <a href="/pages/student-card.html">Open Learner Card (SF9)</a>
    </div></section>}
  </main>;
}
