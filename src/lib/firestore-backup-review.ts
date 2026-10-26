interface ReviewBackup {
  schoolId: string;
  schoolName?: string;
  exportedAt: string;
  documents: { path: string }[];
}

/** Counts imported documents, not estimated writes/deletions in the live database. */
export function summarizeFirestoreBackup(backup: ReviewBackup) {
  const counts = { students: 0, archives: 0, users: 0, settings: 0, structure: 0, assignments: 0, statistics: 0, yearDocuments: 0 };
  const years = new Set<string>();
  for (const { path } of backup.documents) {
    const parts = path.split('/');
    if (parts[0] === 'schoolYears') {
      years.add(parts[1]);
      if (parts.length === 2) counts.yearDocuments++;
      else if (parts[2] === 'learners') counts.students++;
      else if (['dropouts', 'transferredOut', 'trash'].includes(parts[2])) counts.archives++;
      else counts.structure++;
    } else if (parts[0] === 'users') {
      if (parts.length === 2) counts.users++;
      else counts.assignments++;
    } else if (parts[0] === 'settings') counts.settings++;
    else if (parts[0] === 'publicStats') counts.statistics++;
  }
  return { total: backup.documents.length, years: [...years].sort(), counts };
}

export function clearFirestoreBackupReview() {
  const review = document.getElementById('firestoreBackupReview');
  if (review) review.hidden = true;
  for (const id of ['confirmFirestoreBackupBtn', 'cancelFirestoreBackupBtn']) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) { button.onclick = null; button.disabled = false; }
  }
}

export function renderFirestoreBackupReview(backup: ReviewBackup, fileName: string, mode: string, onRestore: () => Promise<unknown>) {
  const review = document.getElementById('firestoreBackupReview');
  const content = document.getElementById('firestoreBackupReviewContent');
  const confirm = document.getElementById('confirmFirestoreBackupBtn') as HTMLButtonElement | null;
  const cancel = document.getElementById('cancelFirestoreBackupBtn') as HTMLButtonElement | null;
  if (!review || !content || !confirm || !cancel) throw new Error('Backup review is unavailable. Reload Admin Console before restoring.');
  const summary = summarizeFirestoreBackup(backup);
  const metadata = document.createElement('dl');
  metadata.className = 'admin-backup-review-metadata';
  const entry = (parent: HTMLElement, label: string, value: string) => {
    const group = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value;
    group.append(term, description); parent.append(group);
  };
  entry(metadata, 'File', fileName || 'Selected JSON backup');
  entry(metadata, 'School', `${backup.schoolName || backup.schoolId} (${backup.schoolId})`);
  entry(metadata, 'Exported', new Date(backup.exportedAt).toLocaleString());
  entry(metadata, 'Restore mode', mode.charAt(0).toUpperCase() + mode.slice(1));
  const totals = document.createElement('dl'); totals.className = 'admin-backup-review-totals';
  entry(totals, 'Total documents', summary.total.toLocaleString());
  entry(totals, 'Student records', summary.counts.students.toLocaleString());
  entry(totals, 'User profiles', summary.counts.users.toLocaleString());
  entry(totals, 'School years', summary.years.length.toLocaleString());
  const breakdown = document.createElement('p'); breakdown.className = 'admin-backup-review-note';
  breakdown.textContent = `Also includes ${summary.counts.archives.toLocaleString()} archive/trash records, ${summary.counts.settings.toLocaleString()} settings documents, ${summary.counts.structure.toLocaleString()} grade/section/teacher documents, ${summary.counts.assignments.toLocaleString()} assignment history documents, ${summary.counts.statistics.toLocaleString()} statistics documents, and ${summary.counts.yearDocuments.toLocaleString()} school-year documents.`;
  const years = document.createElement('p'); years.className = 'admin-backup-review-note';
  years.textContent = `School years: ${summary.years.join(', ') || 'None in this file'}. Counts describe this backup; live records may differ.`;
  content.replaceChildren(metadata, totals, breakdown, years);
  confirm.disabled = false;
  cancel.disabled = false;
  cancel.textContent = 'Cancel restore';
  confirm.onclick = () => { void onRestore(); };
  cancel.onclick = () => {
    clearFirestoreBackupReview();
    const status = document.getElementById('firestoreBackupValidationStatus');
    if (status) status.textContent = 'Restore canceled; database unchanged. Choose a backup to start again.';
  };
  review.hidden = false;
  review.scrollIntoView?.({ block: 'nearest' });
  return summary;
}
