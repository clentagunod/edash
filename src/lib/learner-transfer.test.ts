import { afterEach, describe, expect, it } from 'vitest';
import { collectTransferSchoolInputs, ensureTransferSchoolInputs, learnerTransferDirection, loadTransferSchoolInputs, updateTransferSchoolInputs, validateTransferSchoolDetails } from './learner-transfer';
afterEach(() => document.body.replaceChildren());
describe('learner transfer schools', () => {
  it('recognizes transfer records and keeps outgoing records out of the incoming list', () => {
    expect(learnerTransferDirection({ transferIn: true })).toBe('Transfer In');
    expect(learnerTransferDirection({ transferType: 'Transfer-Out' })).toBe('Transfer Out');
    expect(learnerTransferDirection({ transferType: 'Transfer In', enrollmentStatus: 'TRANSFERRED_OUT' })).toBe('Transfer Out');
    expect(learnerTransferDirection({})).toBe('');
  });
  for (const archived of [false, true]) it(`requires four school fields only when a transfer is selected (${archived ? 'archive' : 'learner'} form)`, () => {
    const nameId = archived ? 'archiveTransferSchool' : 'f_transferSchool';
    const typeId = archived ? 'archiveTransferType' : 'f_transferType';
    document.body.innerHTML = `<form><div class="field-grid">${archived ? '' : `<select id="${typeId}"><option value=""></option><option>Transfer In</option><option>Transfer Out</option></select>`}<div class="field"><label for="${nameId}">School</label><input id="${nameId}"></div></div></form>`;
    const form = document.querySelector('form')!;
    ensureTransferSchoolInputs(form, archived);
    ensureTransferSchoolInputs(form, archived);
    const type = form.querySelector<HTMLSelectElement>(`#${typeId}`)!;
    updateTransferSchoolInputs(form, archived);
    expect(form.querySelectorAll('input[required]')).toHaveLength(0);
    type.value = 'Transfer In'; updateTransferSchoolInputs(form, archived);
    expect(form.querySelectorAll('input[required]')).toHaveLength(4);
    expect(() => collectTransferSchoolInputs(form, archived)).toThrow('School ID');
    loadTransferSchoolInputs(form, { transferType: 'Transfer In', transferSchoolId: '001234', transferSchool: 'Previous School', transferSchoolAddress: 'Sample Town', transferSchoolZipCode: '0010' }, archived);
    expect(collectTransferSchoolInputs(form, archived)).toMatchObject({ transferIn: true, transferOut: false, transferSchoolId: '001234', transferSchool: 'Previous School', transferSchoolAddress: 'Sample Town', transferSchoolZipCode: '0010' });
    type.value = 'Transfer Out'; updateTransferSchoolInputs(form, archived);
    expect(form.querySelector(`label[for="${nameId}"]`)?.textContent).toBe('To school name *');
    type.value = ''; updateTransferSchoolInputs(form, archived);
    expect(form.querySelectorAll('input[required]')).toHaveLength(0);
    expect(collectTransferSchoolInputs(form, archived).transferSchoolId).toBe('');
  });
  it('rejects whitespace-only transfer schools while allowing ordinary learners without a transfer', () => {
    expect(() => validateTransferSchoolDetails({})).not.toThrow();
    expect(() => validateTransferSchoolDetails({ transferOut: true, transferSchoolId: ' ', transferSchool: 'School', transferSchoolAddress: 'Town', transferSchoolZipCode: '0010' })).toThrow('School ID');
  });
});
