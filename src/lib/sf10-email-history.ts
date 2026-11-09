import { parseEmailAddresses } from './gmail-send';
import { sf10EmailDetails, sf10EmailRecord, type Sf10EmailReceipt } from './sf10-email';

export type Sf10EmailHistoryPatch = { sf10Email?: Sf10EmailReceipt | null };

/** Stage history changes until the enclosing learner form is saved. */
export function renderSf10EmailHistory(host: HTMLElement, value: unknown, prefix: string): () => Sf10EmailHistoryPatch {
  const original = sf10EmailRecord(value);
  if (!original) return () => ({});
  let receipt: Sf10EmailReceipt | null = original;
  let beforeDelete = original;
  let editing = false;
  let readEditor: (() => Sf10EmailReceipt) | undefined;
  const summary = document.createElement('div');
  summary.className = 'document-status-email-summary';
  // Keep applied changes visible to the learner form's unsaved-change guard.
  const draftInput = document.createElement('input');
  draftInput.type = 'hidden';
  draftInput.name = 'sf10EmailHistory';
  host.append(summary);

  function button(label: string, action: string, onClick: () => void) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'btn btn-secondary document-status-email-action';
    control.textContent = label;
    control.setAttribute(`data-sf10-email-${action}`, '');
    control.setAttribute('aria-label', `${label} SF10 email history`);
    control.addEventListener('click', onClick);
    return control;
  }

  function render(focus?: string) {
    draftInput.value = JSON.stringify(receipt);
    summary.replaceChildren(draftInput);
    readEditor = undefined;
    const header = document.createElement('div');
    header.className = 'document-status-email-header';
    const heading = document.createElement('strong');
    heading.textContent = 'Latest SF10 email';
    const actions = document.createElement('div');
    actions.className = 'document-status-email-actions';
    header.append(heading, actions);
    summary.append(header);
    if (!receipt) {
      actions.append(button('Undo', 'undo', () => { receipt = beforeDelete; render('delete'); }));
      const notice = document.createElement('p');
      notice.setAttribute('role', 'status');
      notice.textContent = 'Email history will be deleted when you save changes.';
      summary.append(notice);
    } else {
      if (!editing) actions.append(button('Edit', 'edit', () => { editing = true; render('to'); }));
      const remove = button('Delete', 'delete', () => {
        beforeDelete = receipt!;
        receipt = null;
        editing = false;
        render('undo');
      });
      remove.classList.add('danger');
      actions.append(remove);
      if (editing) renderEditor(receipt);
      else sf10EmailDetails(receipt).forEach((detail) => {
        const row = document.createElement('p');
        row.textContent = detail;
        summary.append(row);
      });
    }
    if (focus) summary.querySelector<HTMLElement>(`[data-sf10-email-${focus}]`)?.focus();
  }

  function renderEditor(saved: Sf10EmailReceipt) {
    const editor = document.createElement('div');
    editor.className = 'document-status-email-editor';
    const error = document.createElement('p');
    error.className = 'document-status-email-error';
    error.id = `${prefix}_sf10EmailError`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const inputs: HTMLInputElement[] = [];
    function field(title: string, key: string, value: string, required = false) {
      const label = document.createElement('label');
      label.className = 'field';
      const input = document.createElement('input');
      input.id = `${prefix}_sf10Email_${key}`;
      input.name = `sf10Email_${key}`;
      input.setAttribute(`data-sf10-email-${key}`, '');
      input.setAttribute('aria-describedby', error.id);
      input.required = required;
      input.value = value;
      input.addEventListener('input', () => {
        inputs.forEach((control) => { control.setCustomValidity(''); control.removeAttribute('aria-invalid'); });
        error.hidden = true;
      });
      label.htmlFor = input.id;
      label.append(document.createTextNode(title), input);
      editor.append(label);
      inputs.push(input);
      return input;
    }
    const to = field('To *', 'to', saved.to.join(', '), true);
    const cc = field('CC', 'cc', saved.cc.join(', '));
    const bcc = field('BCC', 'bcc', saved.bcc.join(', '));
    [to, cc, bcc].forEach((input) => { input.inputMode = 'email'; input.maxLength = 13000; });
    // datetime-local has no timezone: show and interpret this value in PHT.
    const localTime = new Date(Date.parse(saved.sentAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, -1);
    const sent = field('Sent date and time (PHT) *', 'sent', '', true);
    sent.type = 'datetime-local';
    sent.step = 'any';
    sent.value = localTime;
    function invalid(input: HTMLInputElement, message: string): never {
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', 'true');
      error.textContent = message;
      error.hidden = false;
      input.focus();
      input.reportValidity();
      throw new Error(message);
    }
    readEditor = () => {
      const recipients = [to, cc, bcc].map((input, index) => {
        try { return parseEmailAddresses(input.value, index === 0); }
        catch { return invalid(input, `${['To', 'CC', 'BCC'][index]}: Enter valid email addresses, separated by commas.`); }
      });
      if (recipients.flat().length > 50) invalid(to, 'Use no more than 50 recipients across To, CC, and BCC.');
      const timestamp = Date.parse(`${sent.value}+08:00`);
      if (!sent.value || !Number.isFinite(timestamp)) invalid(sent, 'Enter a valid sent date and time in PHT.');
      const updated = sf10EmailRecord({ ...saved, to: recipients[0], cc: recipients[1], bcc: recipients[2], sentAt: new Date(timestamp).toISOString() });
      if (!updated) invalid(sent, 'Enter a valid sent date and time in PHT.');
      return updated!;
    };
    const hint = document.createElement('p');
    hint.textContent = 'Separate email addresses with commas. Save the learner record to keep these changes.';
    const actions = document.createElement('div');
    actions.className = 'document-status-email-actions';
    actions.append(button('Apply', 'apply', () => {
      try { receipt = readEditor!(); } catch { return; }
      editing = false;
      render('edit');
    }), button('Cancel edit', 'cancel', () => { editing = false; render('edit'); }));
    editor.append(hint, error, actions);
    summary.append(editor);
  }

  render();
  return () => {
    const updated = editing ? readEditor!() : receipt;
    return JSON.stringify(updated) === JSON.stringify(original) ? {} : { sf10Email: updated };
  };
}
