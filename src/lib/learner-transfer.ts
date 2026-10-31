export const TRANSFER_SCHOOL_FIELDS = ['transferSchoolId', 'transferSchool', 'transferSchoolAddress', 'transferSchoolZipCode'] as const;
export type TransferDirection = '' | 'Transfer In' | 'Transfer Out';
const clean = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
export function learnerTransferDirection(record: Record<string, unknown>): TransferDirection {
  const type = clean(record.transferType).toLowerCase().replace(/[\s_-]+/g, '');
  if (record.transferOut === true || clean(record.enrollmentStatus).toUpperCase() === 'TRANSFERRED_OUT' || type === 'transferout' || type === 'out') return 'Transfer Out';
  return record.transferIn === true || type === 'transferin' || type === 'in' ? 'Transfer In' : '';
}
export function transferSchoolDetails(record: Record<string, unknown>) {
  return Object.fromEntries(TRANSFER_SCHOOL_FIELDS.map((field) => [field, clean(record[field])])) as Record<typeof TRANSFER_SCHOOL_FIELDS[number], string>;
}
export function validateTransferSchoolDetails(record: Record<string, unknown>): void {
  const direction = learnerTransferDirection(record);
  if (!direction) return;
  const details = transferSchoolDetails(record);
  const labels = ['School ID', 'School name', 'School address', 'ZIP code'];
  const missing = TRANSFER_SCHOOL_FIELDS.filter((field) => !details[field]).map((field) => labels[TRANSFER_SCHOOL_FIELDS.indexOf(field)]);
  if (missing.length) throw new Error(`${direction === 'Transfer In' ? 'From' : 'To'} school requires: ${missing.join(', ')}.`);
}

const inputIds = (archived: boolean) => archived
  ? ['archiveTransferSchoolId', 'archiveTransferSchool', 'archiveTransferSchoolAddress', 'archiveTransferSchoolZipCode']
  : ['f_transferSchoolId', 'f_transferSchool', 'f_transferSchoolAddress', 'f_transferSchoolZipCode'];

/** Extend the existing controls rather than duplicating transfer forms on each page. */
export function ensureTransferSchoolInputs(form: HTMLFormElement, archived = false): void {
  const ids = inputIds(archived);
  const name = form.querySelector<HTMLInputElement>(`#${ids[1]}`);
  if (!name || form.querySelector(`#${ids[0]}`)) return;
  const field = name.closest('.field')!;
  const markup = ([index, label, max]: [number, string, number]) => `<div class="field" data-transfer-school-detail><label for="${ids[index]}">${label} <span class="learner-required-mark" aria-hidden="true">*</span></label><input id="${ids[index]}" maxlength="${max}" autocomplete="off" /></div>`;
  field.insertAdjacentHTML('beforebegin', markup([0, 'School ID', 40]));
  field.insertAdjacentHTML('afterend', markup([2, 'School address', 500]) + markup([3, 'ZIP code', 20]));
  name.maxLength = 200;
  field.setAttribute('data-transfer-school-detail', '');
  if (archived && !form.querySelector('#archiveTransferType')) {
    field.insertAdjacentHTML('beforebegin', '<div class="field"><label for="archiveTransferType">Transfer information</label><select id="archiveTransferType"><option value="">No transfer record</option><option>Transfer In</option><option>Transfer Out</option></select></div>');
    form.querySelector('#archiveTransferType')!.addEventListener('change', () => updateTransferSchoolInputs(form, true));
  }
}
export function updateTransferSchoolInputs(form: HTMLFormElement, archived = false): void {
  if (!form) return;
  const type = form.querySelector<HTMLSelectElement>(archived ? '#archiveTransferType' : '#f_transferType')?.value || '';
  const active = type === 'Transfer In' || type === 'Transfer Out';
  const ids = inputIds(archived);
  ids.forEach((id) => {
    const input = form.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) return;
    input.required = active; input.disabled = !active;
    input.closest<HTMLElement>('.field')!.hidden = !active;
  });
  const label = form.querySelector(`label[for="${ids[1]}"]`);
  if (label) label.textContent = `${type === 'Transfer In' ? 'From school name' : type === 'Transfer Out' ? 'To school name' : 'School name'}${active ? ' *' : ''}`;
}
export function loadTransferSchoolInputs(form: HTMLFormElement, record: Record<string, unknown>, archived = false): void {
  const ids = inputIds(archived), details = transferSchoolDetails(record);
  TRANSFER_SCHOOL_FIELDS.forEach((key, index) => { const input = form.querySelector<HTMLInputElement>(`#${ids[index]}`); if (input) input.value = details[key]; });
  const type = form.querySelector<HTMLSelectElement>(archived ? '#archiveTransferType' : '#f_transferType');
  if (type) type.value = learnerTransferDirection(record);
  updateTransferSchoolInputs(form, archived);
}
export function collectTransferSchoolInputs(form: HTMLFormElement, archived = false) {
  const type = form.querySelector<HTMLSelectElement>(archived ? '#archiveTransferType' : '#f_transferType')?.value || '';
  const ids = inputIds(archived);
  const details = Object.fromEntries(TRANSFER_SCHOOL_FIELDS.map((key, index) => [key, type ? (form.querySelector<HTMLInputElement>(`#${ids[index]}`)?.value || '').trim() : '']));
  const record = { ...details, transferType: type, transferIn: type === 'Transfer In', transferOut: type === 'Transfer Out' };
  validateTransferSchoolDetails(record);
  return record;
}
