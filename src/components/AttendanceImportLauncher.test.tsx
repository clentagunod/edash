import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'School Admin', next: null as null | ((value: { canTeacherImportAttendance: boolean }) => void), error: null as null | (() => void), stop: vi.fn() }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../lib/app-config', () => ({ isSchoolAdmin: () => ['School Admin', 'Developer'].includes(state.role), isRegistrar: () => state.role === 'Registrar', isTeacher: () => state.role === 'Teacher' }));
vi.mock('../lib/firestore-api', () => ({ fsSubscribeAttendanceImportConfiguration: (next: typeof state.next, error: typeof state.error) => { state.next = next; state.error = error; return state.stop; } }));
vi.mock('../lib/school-year', () => ({ getSelectedSchoolYear: () => '2026-2027', readStoredSchoolYear_: () => '2026-2027' }));
vi.mock('./AttendanceImportPanel', () => ({ default: ({ authorized }: { authorized: boolean }) => <p>{authorized ? 'SF2 review panel' : 'Attendance imports disabled'}</p> }));
import AttendanceImportLauncher from './AttendanceImportLauncher';

describe('SF2 import launcher access', () => {
  let root: Root, host: HTMLDivElement;
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  beforeEach(() => {
    vi.clearAllMocks(); state.next = null; state.error = null;
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  async function mount(role: string) { state.role = role; await act(async () => root.render(<AttendanceImportLauncher onComplete={vi.fn()} />)); }
  it.each(['School Admin', 'Registrar', 'Developer'])('gives %s access and opens the SF2 review panel', async role => {
    await mount(role);
    const trigger = host.querySelector<HTMLButtonElement>('#importAttendanceBtn')!;
    expect(trigger.textContent).toContain('Import Daily Attendance Report (SF2)');
    await act(async () => trigger.click());
    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(host.textContent).toContain('SF2 review panel');
    expect(state.next).toBeNull();
  });
  it('only exposes SF2 to teachers while its independent admin toggle is enabled', async () => {
    await mount('Teacher');
    expect(host.querySelector('#importAttendanceBtn')).toBeNull();
    await act(async () => state.next!({ canTeacherImportAttendance: true }));
    await act(async () => host.querySelector<HTMLButtonElement>('#importAttendanceBtn')!.click());
    await act(async () => state.next!({ canTeacherImportAttendance: false }));
    expect(host.querySelector('#importAttendanceBtn')).toBeNull();
    expect(host.textContent).toContain('Attendance imports disabled');
    await act(async () => state.error!());
    expect(host.querySelector('#importAttendanceBtn')).toBeNull();
  });
  it.each(['Visitor', 'Parent', ''])('hides SF2 imports for %s', async role => {
    await mount(role); expect(host.querySelector('#importAttendanceBtn')).toBeNull(); expect(state.next).toBeNull();
  });
});
