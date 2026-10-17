import LegacyPage from './LegacyPage';
import { requireAuth } from '../lib/auth';
import { renderShell, escapeHtml, showToast } from '../lib/shell';
import { getSelectedSchoolYear, initYearSwitcher } from '../lib/school-year';
import { fsGetTrash, fsGetTrashRetention, fsRestoreTrashItem, fsPermanentlyDeleteTrashItem } from '../lib/firestore-api';
import { canManageLearners } from '../lib/app-config';
import { Icon } from '../lib/icons';
import '../styles/pages/trash.css';

const html = `<div class="app-shell"><div id="sidebarMount"></div><div class="main-area"><div id="topbarMount"></div><main class="page"><div class="page-header"><div><h1>Trash</h1><p class="desc">Restore removed learner records or permanently delete them.</p></div></div><div id="yearSwitcherMount"></div><div class="trash-retention-info" id="trashRetentionInfo" role="status" aria-live="polite">Loading Trash retention…</div><section class="panel"><div class="panel-header"><h2 id="trashYearTitle">Removed learners</h2><button class="btn btn-secondary" id="refreshTrash" type="button">Refresh</button></div><div id="trashStatus" class="panel-body" role="status" aria-live="polite">Loading Trash…</div><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Learner</th><th>Learner ID</th><th>Removed from</th><th>Removed on</th><th>Permanently deleted</th><th>Removed by</th><th>Actions</th></tr></thead><tbody id="trashRows"></tbody></table></div></section></main></div></div>`;

function nameOf(learner: any) { return [learner?.firstName, learner?.middleName, learner?.lastName, learner?.suffix].filter(Boolean).join(' ') || 'Unnamed learner'; }

async function initTrash() {
  if (!canManageLearners()) { window.location.replace('/pages/dashboard.html'); return; }
  renderShell('trash', 'Trash');
  let year = getSelectedSchoolYear();
  let retention = '30';
  const status = document.getElementById('trashStatus')!;
  const rows = document.getElementById('trashRows')!;
  const retentionInfo = document.getElementById('trashRetentionInfo')!;
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
    if (!year) { status.textContent = 'Select a school year to view its Trash.'; return; }
    status.textContent = 'Loading Trash…'; rows.replaceChildren();
    try {
      const items = await fsGetTrash(year);
      status.textContent = items.length ? `${items.length} learner record${items.length === 1 ? '' : 's'} in Trash.` : 'Trash is empty.';
      rows.innerHTML = items.map((item: any) => {
        const deletedDate = item.deletedAt ? new Date(item.deletedAt) : null;
        const scheduledDate = retention === 'never' || !deletedDate || Number.isNaN(deletedDate.getTime())
          ? (retention === 'never' ? 'Never' : '—')
          : new Date(deletedDate.getTime() + Number(retention) * 86400000).toLocaleString();
        return `<tr><td>${escapeHtml(nameOf(item.learner))}</td><td>${escapeHtml(item.learnerId)}</td><td>${escapeHtml(item.sourceCollection)}</td><td>${escapeHtml(deletedDate && !Number.isNaN(deletedDate.getTime()) ? deletedDate.toLocaleString() : '')}</td><td>${escapeHtml(scheduledDate)}</td><td>${escapeHtml(item.deletedByName || '')}</td><td><div class="row-actions"><button class="icon-btn" type="button" data-restore="${escapeHtml(item.trashId)}" title="Restore learner" aria-label="Restore learner">${Icon.rotateCcw}</button><button class="icon-btn danger" type="button" data-purge="${escapeHtml(item.trashId)}" title="Permanently delete learner" aria-label="Permanently delete learner">${Icon.trash}</button></div></td></tr>`;
      }).join('');
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
    } catch (error: any) { status.textContent = error.message || 'Could not load Trash.'; }
  };
  document.getElementById('refreshTrash')!.addEventListener('click', () => void load());
  await initYearSwitcher(load);
}

export default function TrashPage() {
  return <LegacyPage html={html} title="Trash" onMount={async () => { await requireAuth(); await initTrash(); }} />;
}
