import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const access = vi.hoisted(() => ({ role: 'Teacher' }));
vi.mock('../lib/app-config', () => ({ appRole: () => access.role, normalizedAppRole: (value: string) => value }));
vi.mock('../lib/auth', () => ({ requireAuth: vi.fn().mockResolvedValue({ uid: 'user' }) }));
import { canAccessPrintable } from '../lib/printable-access';
import PrintableAccessGate from './PrintableAccessGate';
import { PRINTABLES } from '../lib/printables';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { document.body.innerHTML = ''; });

describe('printable role restrictions', () => {
  it('allows teachers only SF9 and staff every printable', () => {
    for (const kind of Object.keys(PRINTABLES) as Array<keyof typeof PRINTABLES>) {
      expect(canAccessPrintable(kind, 'Teacher')).toBe(kind === 'student-card');
      expect(canAccessPrintable(kind, 'Registrar')).toBe(true);
      expect(canAccessPrintable(kind, 'School Admin')).toBe(true);
      expect(canAccessPrintable(kind, 'Visitor')).toBe(false);
      expect(canAccessPrintable(kind, '')).toBe(false);
    }
  });
  it('does not mount a restricted studio when a teacher opens its URL or changes from SF9', async () => {
    access.role = 'Teacher';
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const mount = vi.fn();
    function Restricted() { mount(); return <p>Private studio</p>; }
    try {
      await act(async () => root.render(<PrintableAccessGate kind="student-card"><p>SF9</p></PrintableAccessGate>));
      expect(container.textContent).toBe('SF9');
      await act(async () => root.render(<PrintableAccessGate kind="outgoing-envelope"><Restricted /></PrintableAccessGate>));
      expect(mount).not.toHaveBeenCalled();
      expect(container.textContent).toContain('This printable is restricted');
    } finally { act(() => root.unmount()); }
  });
});
