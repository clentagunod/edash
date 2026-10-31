import { sf10EmailDetails } from './sf10-email';

export const DOCUMENT_STATUSES = ['Successfully Transmitted', 'Transmitted', 'Preparing Documents', 'Received Documents', 'Emailed', 'Custom'] as const;
export const DOCUMENT_STATUS_FIELDS = ['documentStatus', 'documentStatusCustom', 'documentStatusDates'] as const;
export type DocumentStatusRecord = {
  documentStatus: string;
  documentStatusCustom: string;
  documentStatusDates: Record<string, string>;
};

/** The transfer table's legacy Notes column displays the shared document status. */
export function documentStatusLabel(learner: Record<string, unknown>): string {
  const value = documentStatusRecord(learner);
  return value.documentStatus === 'Custom' ? value.documentStatusCustom : value.documentStatus || 'No Documents Received';
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function documentStatusRecord(learner: Record<string, unknown> = {}, validate = false): DocumentStatusRecord {
  if (validate && [learner.documentStatus, learner.documentStatusCustom].some((value) => value != null && typeof value !== 'string')) {
    throw new Error('Document Status and its custom label must be text.');
  }
  const legacy = !Object.prototype.hasOwnProperty.call(learner, 'documentStatus')
    && typeof learner.transferNotes === 'string' ? learner.transferNotes.trim() : '';
  const recordedStatus = typeof learner.documentStatus === 'string' ? learner.documentStatus.trim() : legacy ? 'Custom' : '';
  const status = recordedStatus === 'Successfully' ? 'Successfully Transmitted' : recordedStatus;
  const custom = typeof learner.documentStatusCustom === 'string' ? learner.documentStatusCustom.trim() : legacy;
  if (validate && status && !DOCUMENT_STATUSES.includes(status as typeof DOCUMENT_STATUSES[number])) {
    throw new Error('Choose a valid Document Status category.');
  }
  if (validate && status === 'Custom' && !custom) throw new Error('Enter the custom Document Status.');
  const dates = learner.documentStatusDates;
  if (validate && dates != null && dates !== '' && (typeof dates !== 'object' || Array.isArray(dates))) {
    throw new Error('Document Status dates must contain a date for each category.');
  }
  const source = dates && typeof dates === 'object' && !Array.isArray(dates) ? dates : {};
  const documentStatusDates = Object.fromEntries(Object.entries(source).filter(([key]) => key === 'Successfully' || DOCUMENT_STATUSES.includes(key as typeof DOCUMENT_STATUSES[number])).map(([key, raw]) => {
    const date = typeof raw === 'string' ? raw.trim() : '';
    if (validate && ((raw != null && typeof raw !== 'string') || (date && !validDate(date)))) {
      throw new Error(`Enter a valid date for Document Status: ${key}.`);
    }
    return [key, date];
  }));
  // Keep the historical key as well, including when both dates already exist.
  if (!documentStatusDates['Successfully Transmitted'] && documentStatusDates.Successfully) {
    documentStatusDates['Successfully Transmitted'] = documentStatusDates.Successfully;
  }
  return { documentStatus: DOCUMENT_STATUSES.includes(status as typeof DOCUMENT_STATUSES[number]) ? status : '', documentStatusCustom: custom, documentStatusDates };
}

const drafts = new WeakMap<HTMLElement, DocumentStatusRecord>();

/** Shared by the active, archived, and migration learner editors. */
export function renderDocumentStatusFields(host: HTMLElement, learner: Record<string, unknown>, prefix: string): void {
  let container = host.querySelector<HTMLElement>('[data-document-status-fields]');
  if (!container) {
    container = document.createElement('div');
    container.className = 'field span-2 document-status-fields';
    container.dataset.documentStatusFields = '';
    (host.querySelector('.field-grid') || host).append(container);
  }
  const saved = documentStatusRecord(learner);
  drafts.set(host, saved);
  container.replaceChildren();
  function field(title: string, suffix: string, control: HTMLInputElement | HTMLSelectElement) {
    const label = document.createElement('label');
    label.className = 'field';
    label.htmlFor = `${prefix}_${suffix}`;
    control.id = label.htmlFor;
    control.name = suffix;
    label.append(document.createTextNode(title), control);
    container!.append(label);
    return label;
  }
  const select = document.createElement('select');
  select.dataset.documentStatus = '';
  ['', ...DOCUMENT_STATUSES].forEach((status) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status || 'No Documents Received';
    select.append(option);
  });
  select.value = saved.documentStatus;
  field('Document Status', 'documentStatus', select);
  const custom = document.createElement('input');
  custom.dataset.documentStatusCustom = '';
  custom.value = saved.documentStatusCustom;
  custom.maxLength = 2000;
  const customField = field('Custom Document Status', 'documentStatusCustom', custom);
  const date = document.createElement('input');
  date.type = 'date';
  date.dataset.documentStatusDate = '';
  const dateField = field('Document Status date', 'documentStatusDate', date);
  let selected = select.value;
  function showSelection() {
    customField.hidden = select.value !== 'Custom';
    custom.required = select.value === 'Custom';
    dateField.hidden = !select.value;
    date.disabled = !select.value;
    date.setAttribute('aria-label', `${select.value === 'Custom' ? 'Custom Document Status' : select.value || 'Document Status'} date`);
    dateField.firstChild!.textContent = date.getAttribute('aria-label');
    date.value = saved.documentStatusDates[select.value] || '';
  }
  select.addEventListener('change', () => {
    if (selected) saved.documentStatusDates[selected] = date.value;
    selected = select.value;
    showSelection();
  });
  showSelection();
  const emailDetails = sf10EmailDetails(learner.sf10Email);
  if (emailDetails.length) {
    const summary = document.createElement('div');
    summary.className = 'document-status-email-summary';
    const heading = document.createElement('strong');
    heading.textContent = 'Latest SF10 email';
    summary.append(heading);
    emailDetails.forEach((detail) => {
      const row = document.createElement('p');
      row.textContent = detail;
      summary.append(row);
    });
    container.append(summary);
  }
}

export function collectDocumentStatusFields(host: HTMLElement): DocumentStatusRecord {
  const saved = drafts.get(host);
  if (!saved) throw new Error('Document Status fields could not be loaded. Reopen this form before saving.');
  const status = host.querySelector<HTMLSelectElement>('[data-document-status]')!.value;
  const dates = { ...saved.documentStatusDates };
  if (status) dates[status] = host.querySelector<HTMLInputElement>('[data-document-status-date]')!.value;
  return documentStatusRecord({
    documentStatus: status,
    documentStatusCustom: host.querySelector<HTMLInputElement>('[data-document-status-custom]')!.value,
    documentStatusDates: dates,
  }, true);
}
