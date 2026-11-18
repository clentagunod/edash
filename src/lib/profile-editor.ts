import { APP_USER_PROFILE, appRole, isTeacher, storedAppProfile, teacherAssignmentsForSchoolYear } from './app-config';
import { fsGetProfileEditingConfiguration, fsSubscribeProfileEditingConfiguration, fsUpdateProfileValue } from './firestore-api';
import { getSelectedSchoolYear } from './school-year';
import { escapeHtml, showToast } from './shell';
import type { EditableProfileKind, ProfileValueEdit } from './profile-editing';
import './profile-editor.css';

interface ProfileEditorOptions {
  kind: EditableProfileKind;
  exportButtonId: string;
  tableBodyId: string;
  reload: (year: string) => Promise<void>;
  render: () => void;
}
interface CellOptions { choices?: string[]; numeric?: boolean; label?: string; term?: string }

/** A cell saves on change; only one write can run at a time in this page. */
export function createProfileEditor(options: ProfileEditorOptions) {
  let active = false, allowed = false, busy = false, disposed = false;
  let generation = 0;
  let unsubscribe: (() => void) | undefined;
  let button: HTMLButtonElement | null = null;
  let status: HTMLParagraphElement | null = null;
  let body: HTMLElement | null = null;
  const cells = new Map<string, { learnerId: string; edit: ProfileValueEdit; year: string }>();
  let cellId = 0;
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const staff = () => ['Developer', 'School Admin', 'Registrar', 'Teacher'].includes(appRole());
  const attached = () => !disposed && !!button?.isConnected;

  function updateControls(message?: string, error = false) {
    if (!attached()) return;
    button!.hidden = !allowed;
    button!.disabled = busy;
    button!.setAttribute('aria-pressed', String(active));
    button!.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5L9 20l-6 1 1-6L16 3Z"/><path d="m14 5 5 5"/></svg><span>${active ? 'Done editing' : 'Edit profiles'}</span>`;
    status!.hidden = !message && !active;
    status!.textContent = message ?? (active ? 'Edit mode is on. Each changed value saves automatically when you leave the field or choose a classification.' : '');
    status!.classList.toggle('is-error', error);
    body?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-profile-cell]').forEach(input => { input.disabled = busy; });
  }

  function applyAccess(enabled: boolean) {
    if (!attached()) return;
    const previous = allowed;
    allowed = staff() && (!isTeacher() || enabled);
    if (!allowed && active) {
      active = false;
      options.render();
      updateControls('Teacher profile editing is disabled by your school administrator.');
    } else if (previous !== allowed) updateControls();
  }

  async function toggle() {
    if (!allowed || busy) return;
    active = !active;
    cells.clear();
    options.render();
    updateControls();
  }

  async function save(event: Event) {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const cell = cells.get(input.dataset.profileCell);
    if (!cell || !active || !allowed || busy) return;
    if ('reportValidity' in input && !input.reportValidity()) return;
    const value = input.value.trim();
    if (value === cell.edit.previousValue) return;
    const token = generation;
    busy = true;
    updateControls('Saving profile value…');
    let committed = false;
    try {
      await fsUpdateProfileValue(cell.year, cell.learnerId, { ...cell.edit, value });
      committed = true;
      if (!attached() || token !== generation || cell.year !== getSelectedSchoolYear()) return;
      await options.reload(cell.year);
      if (attached() && token === generation) updateControls('Saved. You can continue editing.');
    } catch (error) {
      if (!attached() || token !== generation) return;
      input.value = cell.edit.previousValue;
      const message = committed ? 'Your edit was saved, but the profile could not refresh. Reload the page to see the updated value.' : (error as Error).message || 'Unable to save this value. Try again.';
      updateControls(message, true);
      showToast(message, 'error');
    } finally {
      busy = false;
      if (attached()) {
        button!.disabled = false;
        body?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-profile-cell]').forEach(control => { control.disabled = false; });
      }
    }
  }

  return {
    async initialize() {
      unsubscribe?.();
      body?.removeEventListener('change', save);
      button?.removeEventListener('click', toggle);
      generation++;
      const initialGeneration = generation;
      disposed = false;
      active = false;
      allowed = false;
      const exportButton = document.getElementById(options.exportButtonId);
      if (!exportButton || !staff()) return;
      body = document.getElementById(options.tableBodyId);
      const header = exportButton.closest('.page-header');
      let actions = exportButton.parentElement;
      if (actions === header) {
        actions = document.createElement('div');
        header!.append(actions);
        actions.append(exportButton);
      }
      actions!.classList.add('profile-header-actions');
      actions!.querySelector('[data-profile-edit-toggle]')?.remove();
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary profile-edit-toggle';
      button.dataset.profileEditToggle = '';
      button.hidden = true;
      button.addEventListener('click', toggle);
      actions!.prepend(button);
      header!.parentElement!.querySelector('[data-profile-edit-status]')?.remove();
      status = document.createElement('p');
      status.dataset.profileEditStatus = '';
      status.className = 'profile-edit-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.hidden = true;
      header!.after(status);
      body?.addEventListener('change', save);
      if (!isTeacher()) {
        applyAccess(true);
        return;
      }
      try {
        const config = await fsGetProfileEditingConfiguration();
        if (initialGeneration !== generation || disposed) return;
        applyAccess(config.canTeacherEditProfiles);
        if (attached()) unsubscribe = fsSubscribeProfileEditingConfiguration(
          config => applyAccess(config.canTeacherEditProfiles),
          () => {
            if (!attached()) return;
            applyAccess(false);
            updateControls('Profile editing access could not be verified. Reload the page to retry.', true);
          },
        );
      } catch {
        if (attached() && initialGeneration === generation) updateControls('Profile editing access could not be loaded. Reload the page to retry.', true);
      }
    },
    reset() {
      generation++;
      active = false;
      cells.clear();
      updateControls();
    },
    cell(record: Record<string, any>, field: string, value: unknown, config: CellOptions = {}) {
      if (!active || !allowed || !record.learnerId) return '';
      const year = getSelectedSchoolYear();
      if (isTeacher() && !teacherAssignmentsForSchoolYear(APP_USER_PROFILE || storedAppProfile(), year).some(assignment =>
        normalize(assignment.gradeLevel) === normalize(record.gradeLevel) && normalize(assignment.section) === normalize(record.section))) return '';
      const id = String(++cellId);
      const text = String(value ?? '').trim();
      cells.set(id, { learnerId: record.learnerId, year, edit: { kind: options.kind, field, term: config.term, value: text, previousValue: text } });
      const attrs = `class="profile-edit-input" data-profile-cell="${id}" aria-label="${escapeHtml(`${record.name || record.learnerId}: ${config.label || field}`)}"${busy ? ' disabled' : ''}`;
      if (config.choices) {
        const choices = [...new Set([...config.choices, ...(text && !config.choices.includes(text) ? [text] : [])])];
        return `<select ${attrs}><option value="">Not recorded</option>${choices.map(choice => `<option value="${escapeHtml(choice)}"${choice === text ? ' selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select>`;
      }
      return `<input ${attrs} type="${config.numeric ? 'number' : 'text'}"${config.numeric ? ' min="0" max="100" step="any" inputmode="decimal"' : ''} value="${escapeHtml(text)}" />`;
    },
    dispose() {
      disposed = true;
      generation++;
      active = false;
      cells.clear();
      unsubscribe?.();
      unsubscribe = undefined;
      body?.removeEventListener('change', save);
      button?.removeEventListener('click', toggle);
    },
  };
}
