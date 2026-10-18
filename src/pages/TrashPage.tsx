import LegacyPage from './LegacyPage';
import { requireAuth } from '../lib/auth';
import { renderShell, escapeHtml, showToast } from '../lib/shell';
import { getSelectedSchoolYear, initYearSwitcher } from '../lib/school-year';
import { fsGetTrash, fsGetTrashRetention, fsRestoreTrashItem, fsPermanentlyDeleteTrashItem } from '../lib/firestore-api';
import { isSchoolAdmin, isTeacher } from '../lib/app-config';
import { Icon } from '../lib/icons';
import '../styles/pages/trash.css';

const html = `<div class="app-shell"><div id="sidebarMount"></div><div class="main-area"><div id="topbarMount"></div><main class="page"><div class="page-header"><div><h1>Trash</h1><p class="desc">Restore removed learner records or permanently delete them. Teachers see records only for their assigned grade and section.</p></div></div><div id="yearSwitcherMount"></div><div class="trash-retention-info" id="trashRetentionInfo" role="status" aria-live="polite">Loading Trash retention…</div><section class="panel"><div class="panel-header"><h2 id="trashYearTitle">Removed learners</h2><button class="btn btn-secondary" id="refreshTrash" type="button">Refresh</button></div><div id="trashStatus" class="panel-body" role="status" aria-live="polite">Loading Trash…</div><div id="trashBulkToolbar" class="bulk-toolbar trash-bulk-toolbar"><span class="bulk-selection-count" id="trashSelectionCount">No items selected</span><div class="trash-bulk-actions"><button class="btn btn-secondary" id="restoreSelectedTrash" type="button" disabled>Restore selected</button><button class="btn btn-danger-outline" id="deleteSelectedTrash" type="button" disabled>Permanently delete selected</button></div></div><div style="overflow-x:auto"><table class="data-table"><thead><tr><th class="select-column"><input id="selectAllTrash" class="row-select" type="checkbox" aria-label="Select all visible Trash items" /></th><th>Learner</th><th>Learner ID</th><th>Removed from</th><th>Removed on</th><th>Permanently deleted</th><th>Removed by</th><th>Actions</th></tr></thead><tbody id="trashRows"></tbody></table></div></section></main></div></div>`;

function nameOf(learner: any) { return [learner?.firstName, learner?.middleName, learner?.lastName, learner?.suffix].filter(Boolean).join(' ') || 'Unnamed learner'; }

async function initTrash() {
  if (!isSchoolAdmin() && !isTeacher()) { window.location.replace('/pages/dashboard.html'); return; }
  renderShell('trash', 'Trash');
  let year = getSelectedSchoolYear();
  let retention = '30';
  const status = document.getElementById('trashStatus')!;
  const rows = document.getElementById('trashRows')!;
  const retentionInfo = document.getElementById('trashRetentionInfo')!;
  const selectedTrashIds = new Set<string>();
  const selectionCount = document.getElementById('trashSelectionCount')!;
  const selectAll = document.getElementById('selectAllTrash') as HTMLInputElement;
  const restoreSelected = document.getElementById('restoreSelectedTrash') as HTMLButtonElement;
  const deleteSelected = document.getElementById('deleteSelectedTrash') as HTMLButtonElement;
  let bulkBusy = false;

  const updateSelectionControls = () => {
    const visible = [...rows.querySelectorAll<HTMLInputElement>('.trash-select')];
    const selectedCount = selectedTrashIds.size;
    selectionCount.textContent = selectedCount
      ? `${selectedCount} item${selectedCount === 1 ? '' : 's'} selected`
      : 'No items selected';
    restoreSelected.disabled = bulkBusy || selectedCount === 0;
    deleteSelected.disabled = bulkBusy || selectedCount === 0;
    selectAll.disabled = bulkBusy || visible.length === 0;
    selectAll.checked = visible.length > 0 && visible.every((checkbox) => checkbox.checked);
    selectAll.indeterminate = selectedCount > 0 && !selectAll.checked;
    visible.forEach((checkbox) => { checkbox.disabled = bulkBusy; });
  };

  const processSelectedTrash = async (action: 'restore' | 'delete') => {
    if (bulkBusy || selectedTrashIds.size === 0) return;
    const selectedIds = [...selectedTrashIds];
    if (action === 'delete' && !window.confirm(
      `Permanently delete ${selectedIds.length} selected Trash item${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
    )) return;

    bulkBusy = true;
    restoreSelected.disabled = true;
    deleteSelected.disabled = true;
    selectAll.disabled = true;
    (document.getElementById('refreshTrash') as HTMLButtonElement).disabled = true;
    rows.querySelectorAll<HTMLInputElement>('.trash-select').forEach((checkbox) => {
      checkbox.disabled = true;
    });
    rows.querySelectorAll<HTMLButtonElement>('.row-actions button').forEach((button) => {
      button.disabled = true;
    });
    const targetYear = year;

    let completed = 0;
    const failures: string[] = [];
    for (const trashId of selectedIds) {
      try {
        if (action === 'restore') await fsRestoreTrashItem(targetYear, trashId);
        else await fsPermanentlyDeleteTrashItem(targetYear, trashId);
        completed += 1;
      } catch (error: any) {
        console.error(`Could not ${action} Trash item ${trashId}.`, error);
        failures.push(`${trashId}: ${error?.message || 'Unknown error'}`);
      }
    }

    bulkBusy = false;
    (document.getElementById('refreshTrash') as HTMLButtonElement).disabled = false;
    selectedTrashIds.clear();
    if (!failures.length) {
      showToast(
        `${completed} item${completed === 1 ? '' : 's'} ${action === 'restore' ? 'restored' : 'permanently deleted'}.`,
        'success',
      );
    }
    await load();
    if (failures.length) {
      status.textContent = `${completed} completed; ${failures.length} failed. ${failures[0]}`;
      showToast(
        `${completed} item${completed === 1 ? '' : 's'} ${action === 'restore' ? 'restored' : 'deleted'}; ${failures.length} failed. ${failures[0]}`,
        'error',
      );
    }
  };

  selectAll.onchange = () => {
    rows.querySelectorAll<HTMLInputElement>('.trash-select').forEach((checkbox) => {
      checkbox.checked = selectAll.checked;
      if (checkbox.checked) selectedTrashIds.add(checkbox.value);
      else selectedTrashIds.delete(checkbox.value);
    });
    updateSelectionControls();
  };
  restoreSelected.onclick = () => { void processSelectedTrash('restore'); };
  deleteSelected.onclick = () => { void processSelectedTrash('delete'); };

  try {
    retention = await fsGetTrashRetention();
    retentionInfo.textContent = retention === 'never'
      ? 'Trash items are kept until someone permanently deletes them.'
      : `Trash items are automatically permanently deleted ${retention} days after removal.`;
  } catch {
    retentionInfo.textContent = 'Trash retention is set to 30 days. Items are automatically permanently deleted after that period.';
  }
  const load = async () => {
    year = getSelectedSchoolYear();
    document.getElementById('trashYearTitle')!.textContent = `Removed learners · ${year || 'No school year selected'}`;
    selectedTrashIds.clear();
    selectAll.checked = false;
    if (!year) {
      rows.replaceChildren();
      status.textContent = 'Select a school year to view its Trash.';
      updateSelectionControls();
      return;
    }
    status.textContent = 'Loading Trash…'; rows.replaceChildren();
    updateSelectionControls();
    try {
      const items = await fsGetTrash(year);
      status.textContent = items.length ? `${items.length} learner record${items.length === 1 ? '' : 's'} in Trash.` : 'Trash is empty.';
      rows.innerHTML = items.map((item: any) => {
        const deletedDate = item.deletedAt ? new Date(item.deletedAt) : null;
        const scheduledDate = retention === 'never' || !deletedDate || Number.isNaN(deletedDate.getTime())
          ? (retention === 'never' ? 'Never' : '—')
          : new Date(deletedDate.getTime() + Number(retention) * 86400000).toLocaleString();
        return `<tr><td><input class="row-select trash-select" type="checkbox" value="${escapeHtml(item.trashId)}" aria-label="Select ${escapeHtml(nameOf(item.learner))}" /></td><td>${escapeHtml(nameOf(item.learner))}</td><td>${escapeHtml(item.learnerId)}</td><td>${escapeHtml(item.sourceCollection)}</td><td>${escapeHtml(deletedDate && !Number.isNaN(deletedDate.getTime()) ? deletedDate.toLocaleString() : '')}</td><td>${escapeHtml(scheduledDate)}</td><td>${escapeHtml(item.deletedByName || '')}</td><td><div class="row-actions"><button class="icon-btn" type="button" data-restore="${escapeHtml(item.trashId)}" title="Restore learner" aria-label="Restore learner">${Icon.rotateCcw}</button><button class="icon-btn danger" type="button" data-purge="${escapeHtml(item.trashId)}" title="Permanently delete learner" aria-label="Permanently delete learner">${Icon.trash}</button></div></td></tr>`;
      }).join('');
      rows.querySelectorAll<HTMLInputElement>('.trash-select').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedTrashIds.add(checkbox.value);
          else selectedTrashIds.delete(checkbox.value);
          updateSelectionControls();
        });
      });
      rows.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await fsRestoreTrashItem(year, button.dataset.restore); showToast('Learner restored.', 'success'); await load(); }
        catch (error: any) { showToast(error.message || 'Could not restore learner.', 'error'); button.disabled = false; }
      }));
      rows.querySelectorAll<HTMLButtonElement>('[data-purge]').forEach((button) => button.addEventListener('click', async () => {
        if (!window.confirm('Are you sure you want to permanently delete this learner? This cannot be undone.')) return;
        button.disabled = true;
        try { await fsPermanentlyDeleteTrashItem(year, button.dataset.purge); showToast('Learner permanently deleted.', 'success'); await load(); }
        catch (error: any) { showToast(error.message || 'Could not permanently delete learner.', 'error'); button.disabled = false; }
      }));
      updateSelectionControls();
    } catch (error: any) {
      status.textContent = error.message || 'Could not load Trash.';
      updateSelectionControls();
    }
  };
  document.getElementById('refreshTrash')!.onclick = () => { void load(); };
  await initYearSwitcher(load);
}

export default function TrashPage() {
  return <LegacyPage html={html} title="Trash" onMount={async () => { await requireAuth(); await initTrash(); }} />;
}
