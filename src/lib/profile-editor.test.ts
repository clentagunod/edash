import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'Teacher',
  year: '2026-2027',
  assignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'A' }],
  getAccess: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('./app-config', () => ({
  APP_USER_PROFILE: { uid: 'teacher' },
  appRole: () => mocks.role,
  isTeacher: () => mocks.role === 'Teacher',
  storedAppProfile: () => ({ uid: 'teacher' }),
  teacherAssignmentsForSchoolYear: (_profile: unknown, year: string) => mocks.assignments.filter(assignment => assignment.schoolYear === year),
}));
vi.mock('./firestore-api', () => ({
  fsGetProfileEditingConfiguration: mocks.getAccess,
  fsSubscribeProfileEditingConfiguration: mocks.subscribe,
  fsUpdateProfileValue: mocks.update,
}));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: () => mocks.year }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!),
  showToast: mocks.toast,
}));

import { createProfileEditor } from './profile-editor';

const learner = { learnerId: '123456789012', name: 'Sample Learner', gradeLevel: 'Grade 2', section: 'A' };
const disposers: Array<() => void> = [];

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

async function setup() {
  document.body.innerHTML = '<main><div class="page-header"><h1>Math Profile</h1><button id="export">Export Excel</button></div><table><tbody id="profiles"></tbody></table></main>';
  const reload = vi.fn().mockResolvedValue(undefined);
  const render = vi.fn(() => {
    document.getElementById('profiles')!.innerHTML = `<tr><td>${editor.cell(learner, 'bosyRMA', 'Developing', {
      choices: ['Developing', 'Proficient'], label: 'BOSY math classification',
    }) || 'Developing'}</td></tr>`;
  });
  const editor = createProfileEditor({ kind: 'math', exportButtonId: 'export', tableBodyId: 'profiles', reload, render });
  disposers.push(() => editor.dispose());
  await editor.initialize();
  const button = document.querySelector<HTMLButtonElement>('[data-profile-edit-toggle]')!;
  const status = document.querySelector<HTMLParagraphElement>('[data-profile-edit-status]')!;
  return { editor, button, status, reload, render };
}

function input() { return document.querySelector<HTMLSelectElement>('[data-profile-cell]')!; }
function change(value: string) {
  const control = input();
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
  return control;
}

describe('profile edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'Teacher';
    mocks.year = '2026-2027';
    mocks.assignments = [{ schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'A' }];
    mocks.getAccess.mockReset().mockResolvedValue({ canTeacherEditProfiles: true, configured: false });
    mocks.subscribe.mockReset().mockReturnValue(mocks.unsubscribe);
    mocks.update.mockReset().mockResolvedValue({ updated: true, value: 'Proficient' });
  });

  afterEach(() => {
    disposers.splice(0).forEach(dispose => dispose());
    document.body.innerHTML = '';
  });

  it('offers edit mode with the default-on access result and limits editable rows to assigned sections', async () => {
    const { editor, button, status } = await setup();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(editor.cell(learner, 'bosyRMA', 'Developing')).toBe('');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(status.textContent).toContain('Each changed value saves automatically');
    expect(input().value).toBe('Developing');
    expect(input().getAttribute('aria-label')).toContain('BOSY math classification');
    expect(editor.cell({ ...learner, section: 'B' }, 'bosyRMA', '')).toBe('');
    expect(editor.cell({ ...learner, learnerId: '' }, 'bosyRMA', '')).toBe('');
    mocks.year = '2025-2026';
    expect(editor.cell(learner, 'bosyRMA', '')).toBe('');
  });

  it('hides teacher editing when disabled and fails closed when access cannot be read', async () => {
    mocks.getAccess.mockResolvedValue({ canTeacherEditProfiles: false, configured: true });
    const off = await setup();
    expect(off.button.hidden).toBe(true);
    off.button.click();
    expect(document.querySelector('[data-profile-cell]')).toBeNull();
    off.editor.dispose();
    mocks.getAccess.mockRejectedValue(new Error('Offline'));
    const failed = await setup();
    expect(failed.button.hidden).toBe(true);
    expect(failed.status.textContent).toContain('could not be loaded');
    expect(failed.status.classList.contains('is-error')).toBe(true);
  });

  it.each(['School Admin', 'Developer', 'Registrar'])('retains %s access independently of teacher configuration', async role => {
    mocks.role = role;
    mocks.getAccess.mockRejectedValue(new Error('Offline'));
    const { editor, button } = await setup();
    expect(button.hidden).toBe(false);
    button.click();
    expect(editor.cell({ ...learner, section: 'B' }, 'bosyRMA', '')).not.toBe('');
  });

  it('saves only the changed cell with its original school year and refreshes after committing', async () => {
    const { button, reload, status } = await setup();
    button.click();
    change('Proficient');
    expect(mocks.update).toHaveBeenCalledWith('2026-2027', learner.learnerId, {
      kind: 'math', field: 'bosyRMA', term: undefined, previousValue: 'Developing', value: 'Proficient',
    });
    expect(button.disabled).toBe(true);
    expect(input().disabled).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith('2026-2027'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(status.textContent).toContain('Saved.');
  });

  it('does not write unchanged values and serializes changes while a save is pending', async () => {
    const pending = deferred();
    mocks.update.mockReturnValue(pending.promise);
    const { button } = await setup();
    button.click();
    change('Developing');
    expect(mocks.update).not.toHaveBeenCalled();
    change('Proficient');
    change('');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    pending.resolve({ updated: true });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it('restores a rejected cell and reports the error without refreshing', async () => {
    mocks.update.mockRejectedValue(new Error('This value changed. Refresh the page.'));
    const { button, reload, status } = await setup();
    button.click();
    const control = change('Proficient');
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(control.value).toBe('Developing');
    expect(control.disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(status.textContent).toContain('This value changed');
    expect(status.classList.contains('is-error')).toBe(true);
  });

  it('distinguishes a committed edit from a refresh failure', async () => {
    const { button, reload, status } = await setup();
    reload.mockRejectedValue(new Error('Offline'));
    button.click();
    change('Proficient');
    await vi.waitFor(() => expect(status.textContent).toContain('Your edit was saved'));
    expect(status.classList.contains('is-error')).toBe(true);
    expect(button.disabled).toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('removes editable controls immediately when the administrator revokes access', async () => {
    const { button, status } = await setup();
    button.click();
    const onConfig = mocks.subscribe.mock.calls[0][0];
    onConfig({ canTeacherEditProfiles: false, configured: true });
    expect(button.hidden).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-profile-cell]')).toBeNull();
    expect(status.textContent).toContain('disabled by your school administrator');
    onConfig({ canTeacherEditProfiles: true, configured: true });
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('unblocks editing after a school-year reset during an in-flight save without refreshing the wrong year', async () => {
    const pending = deferred();
    mocks.update.mockReturnValue(pending.promise);
    const { editor, button, reload } = await setup();
    button.click();
    change('Proficient');
    mocks.year = '2027-2028';
    editor.reset();
    expect(button.disabled).toBe(true);
    pending.resolve({ updated: true });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(reload).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('disposes listeners and ignores late configuration events', async () => {
    const { editor, button, render, status } = await setup();
    button.click();
    const onConfig = mocks.subscribe.mock.calls[0][0];
    editor.dispose();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    render.mockClear();
    const previousStatus = status.textContent;
    change('Proficient');
    button.click();
    onConfig({ canTeacherEditProfiles: false, configured: true });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(status.textContent).toBe(previousStatus);
  });
});
