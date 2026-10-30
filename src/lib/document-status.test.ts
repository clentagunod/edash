import { describe, expect, it } from 'vitest';
import { collectDocumentStatusFields, DOCUMENT_STATUSES, documentStatusRecord, renderDocumentStatusFields } from './document-status';

function form() {
  document.body.innerHTML = '<form><div class="field-grid"></div></form>';
  return document.querySelector<HTMLFormElement>('form')!;
}

describe('Document Status', () => {
  it('retains existing notes as Custom without altering the original record', () => {
    const learner = { transferNotes: 'Awaiting the signed form.' };
    expect(documentStatusRecord(learner)).toEqual({ documentStatus: 'Custom', documentStatusCustom: learner.transferNotes, documentStatusDates: {} });
    expect(documentStatusRecord({ ...learner, documentStatus: '' }).documentStatus).toBe('');
    expect(learner).toEqual({ transferNotes: 'Awaiting the signed form.' });
  });
  it('stores an independent date for each selected category and restores it after switching', () => {
    const host = form();
    renderDocumentStatusFields(host, {}, 'test');
    const select = host.querySelector<HTMLSelectElement>('[data-document-status]')!;
    const date = host.querySelector<HTMLInputElement>('[data-document-status-date]')!;
    const custom = host.querySelector<HTMLInputElement>('[data-document-status-custom]')!;
    const selectStatus = (status: string) => { select.value = status; select.dispatchEvent(new Event('change', { bubbles: true })); };
    expect([...select.options].map((option) => option.value)).toEqual(['', ...DOCUMENT_STATUSES]);
    expect(date.closest('label')!.hidden).toBe(true);
    selectStatus('Preparing Documents');
    expect(date.closest('label')!.hidden).toBe(false);
    expect(date.getAttribute('aria-label')).toBe('Preparing Documents date');
    date.value = '2026-10-28';
    selectStatus('Transmitted');
    expect(date.value).toBe('');
    date.value = '2026-10-29';
    selectStatus('Preparing Documents');
    expect(date.value).toBe('2026-10-28');
    selectStatus('Custom');
    expect(custom.required).toBe(true);
    expect(() => collectDocumentStatusFields(host)).toThrow('custom Document Status');
    custom.value = 'Awaiting acknowledgement';
    date.value = '2026-10-30';
    const saved = collectDocumentStatusFields(host);
    expect(saved).toEqual({ documentStatus: 'Custom', documentStatusCustom: 'Awaiting acknowledgement', documentStatusDates: {
      'Preparing Documents': '2026-10-28', Transmitted: '2026-10-29', Custom: '2026-10-30',
    } });
    renderDocumentStatusFields(host, saved, 'test');
    expect(collectDocumentStatusFields(host)).toEqual(saved);
    renderDocumentStatusFields(host, {}, 'test');
    expect(collectDocumentStatusFields(host)).toEqual({ documentStatus: '', documentStatusCustom: '', documentStatusDates: {} });
  });
  it('rejects invalid categories, invalid dates, and malformed values', () => {
    expect(() => documentStatusRecord({ documentStatus: 'Unknown' }, true)).toThrow('valid Document Status');
    expect(() => documentStatusRecord({ documentStatusDates: { Transmitted: '2026-02-30' } }, true)).toThrow('valid date');
    expect(() => documentStatusRecord({ documentStatusDates: [] }, true)).toThrow('dates must');
    expect(() => documentStatusRecord({ documentStatus: 123 }, true)).toThrow('must be text');
    expect(documentStatusRecord({ documentStatusDates: { Transmitted: '2024-02-29' } }, true).documentStatusDates.Transmitted).toBe('2024-02-29');
  });
});
