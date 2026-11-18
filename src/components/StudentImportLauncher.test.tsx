import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'School Admin',
  year: '2025-2026',
  next: null as null | ((value: { canTeacherImport: boolean }) => void),
  error: null as null | (() => void),
  stop: vi.fn(),
  busyChange: null as null | ((value: boolean) => void),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../lib/app-config', () => ({
  isSchoolAdmin: () => ['Developer', 'School Admin'].includes(state.role),
  isTeacher: () => state.role === 'Teacher',
}));
vi.mock('../lib/firestore-api', () => ({ fsSubscribeImportConfiguration: (next: typeof state.next, error: typeof state.error) => {
  state.next = next; state.error = error; return state.stop;
} }));
vi.mock('../lib/school-year', () => ({ getSelectedSchoolYear: () => state.year, readStoredSchoolYear_: () => '2025-2026' }));
vi.mock('./StudentImportPanel', () => ({ default: ({ authorized, initialYear, onBusyChange, onComplete }: {
  authorized: boolean; initialYear: string; onBusyChange: (busy: boolean) => void; onComplete: () => void;
}) => {
  state.busyChange = onBusyChange;
  const [draft, setDraft] = useState('');
  return authorized ? <div><span>{initialYear}</span><input aria-label="Draft file" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={onComplete}>Finish test import</button></div> : <p>Import access disabled</p>;
} }));
import StudentImportLauncher from './StudentImportLauncher';

describe('Masterlist import dialog access and lifecycle', () => {
  const originalDialogMethods = Object.fromEntries(['showModal', 'close'].map(key => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)]));
  let root: Root;
  let host: HTMLDivElement;
  const complete = vi.fn();
  const dialog = () => host.querySelector<HTMLDialogElement>('dialog')!;
  const launcher = () => host.querySelector<HTMLButtonElement>('#importStudentsBtn');
  const close = () => host.querySelector<HTMLButtonElement>('[aria-label="Close student import"]')!;
  beforeEach(() => {
    vi.clearAllMocks(); state.role = 'School Admin'; state.year = '2025-2026'; state.next = null; state.error = null;
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } },
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
    for (const [key, descriptor] of Object.entries(originalDialogMethods)) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
    }
  });
  async function mount(role = 'School Admin') { state.role = role; await act(async () => root.render(<StudentImportLauncher onComplete={complete} />)); }

  it.each(['School Admin', 'Developer'])('lets %s open imports in the selected year and refreshes after success', async role => {
    await mount(role);
    expect(state.next).toBeNull();
    expect(host.querySelector('[aria-label="Draft file"]')).toBeNull();
    await act(async () => launcher()!.click());
    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain('2025-2026');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Finish test import')!.click());
    expect(complete).toHaveBeenCalledOnce();
    await act(async () => close().click());
    expect(dialog().open).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(launcher());
  });

  it('keeps teacher access hidden until enabled, reacts to revocation, and fails closed on errors', async () => {
    await mount('Teacher');
    expect(launcher()).toBeNull();
    await act(async () => state.next!({ canTeacherImport: false }));
    expect(launcher()).toBeNull();
    await act(async () => state.next!({ canTeacherImport: true }));
    await act(async () => launcher()!.click());
    expect(dialog().open).toBe(true);
    await act(async () => state.next!({ canTeacherImport: false }));
    expect(launcher()).toBeNull();
    expect(dialog().textContent).toContain('Import access disabled');
    await act(async () => close().click());
    await act(async () => state.next!({ canTeacherImport: true }));
    expect(launcher()).not.toBeNull();
    await act(async () => state.error!());
    expect(launcher()).toBeNull();
    await act(async () => root.unmount());
    expect(state.stop).toHaveBeenCalledOnce();
  });

  it('uses the restored Masterlist year while the year switcher is still initializing', async () => {
    state.year = '';
    await mount(); await act(async () => launcher()!.click());
    expect(dialog().textContent).toContain('2025-2026');
  });

  it.each(['Registrar', 'Visitor', ''])('does not expose imports to %s', async role => {
    await mount(role);
    expect(launcher()).toBeNull();
    expect(state.next).toBeNull();
  });

  it('preserves a prepared file across closing and reopening the dialog', async () => {
    await mount(); await act(async () => launcher()!.click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Draft file"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'class-list.xlsx');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => close().click());
    await act(async () => launcher()!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Draft file"]')!.value).toBe('class-list.xlsx');
  });

  it('blocks dismissal while processing and restores scrolling on unmount', async () => {
    await mount(); await act(async () => launcher()!.click());
    await act(async () => state.busyChange!(true));
    expect(close().disabled).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => dialog().dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    await act(async () => dialog().click());
    expect(dialog().open).toBe(true);
    await act(async () => state.busyChange!(false));
    await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(dialog().open).toBe(false);
    await act(async () => launcher()!.click());
    await act(async () => root.unmount());
    expect(document.body.style.overflow).toBe('');
  });
});
