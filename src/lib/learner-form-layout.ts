type FormSection = { key: string; title: string; description: string; selector: string };

const LEARNER_SECTIONS: FormSection[] = [
  { key: 'identity', title: 'Personal information', description: 'Start with the learner’s identity and birth details.', selector: '#f_learnerId, #f_firstName, #f_middleName, #f_lastName, #f_suffix, #f_customSuffix, #f_birthDate, #f_age, #f_gender' },
  { key: 'enrollment', title: 'Enrollment', description: 'Grade, section, and current enrollment status.', selector: '#f_gradeLevel, #f_section, #f_teacherAssignment, #f_enrollmentStatus' },
  { key: 'contact', title: 'Parent or guardian', description: 'Keep the learner’s contact information up to date.', selector: '#f_guardian, #f_contact' },
  { key: 'programs', title: 'Program participation', description: 'Select all programs that apply to this learner.', selector: '.checkbox-grid' },
  { key: 'learning', title: 'Learner Assessment', description: 'Reading and math records for each assessment period.', selector: '.reading-reference, .math-reference' },
  { key: 'nutrition', title: 'Nutrition', description: 'Record measurements for each assessment period when available.', selector: '.nutrition-inputs' },
  { key: 'additional', title: 'Additional information', description: 'Other learner fields configured for your school.', selector: '#extraFieldsContainer' },
  { key: 'anecdotal', title: 'Anecdotal Records', description: 'Verified conduct information used when preparing a Certificate of Good Moral.', selector: '#f_anecdotalRecords' },
  { key: 'card-record', title: 'Learner Card', description: 'Select a term to enter its grades and Teacher Comments. Monthly attendance is saved for the school year.', selector: '.subject-input-group, [data-learner-card-record]' },
  { key: 'transfer', title: 'Transfer Information and EOSY Status', description: 'Record end-of-year status, transfer details, and document progress.', selector: '#f_transferType, #f_eosyStatus, [data-document-status-fields]' },
];

const ARCHIVE_SECTIONS: FormSection[] = [
  { key: 'identity', title: 'Personal information', description: 'Review the learner’s identity and birth details.', selector: '#archiveFirstName, #archiveMiddleName, #archiveLastName, #archiveSuffix, #archiveCustomSuffix, #archiveBirthDate, #archiveGender' },
  { key: 'enrollment', title: 'Enrollment', description: 'Placement and the original enrollment date.', selector: '#archiveGrade, #archiveSection, #archiveDateAdded, #archiveEnrollmentStatus' },
  { key: 'anecdotal', title: 'Anecdotal Records', description: 'Verified conduct information retained with this learner’s record.', selector: '#archiveAnecdotalRecords' },
  { key: 'card-record', title: 'Learner card', description: 'Teacher Comments and monthly attendance retained with this archived learner.', selector: '[data-learner-card-record]' },
  { key: 'transfer', title: 'Transfer Information and EOSY Status', description: 'School, dates, document progress, and end-of-year status.', selector: '#archiveTransferSchool, #archiveTransferDate, #archiveReason, #archiveEosyStatus, [data-document-status-fields]' },
];

/** Reuse the original controls so values, validation, and event listeners stay intact. */
export function organizeLearnerForm(form: HTMLFormElement, archived = false): void {
  const grid = form.querySelector<HTMLElement>('.field-grid');
  if (!grid) return;
  const definitions = archived ? ARCHIVE_SECTIONS : LEARNER_SECTIONS;
  const controls: HTMLElement[] = [];
  for (const child of Array.from(grid.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains('learner-form-section')) {
      controls.push(...Array.from(child.querySelector<HTMLElement>('.learner-form-section-grid')?.children || []) as HTMLElement[]);
    } else controls.push(child);
  }
  const groups = definitions.map((definition) => ({ definition, fields: controls.filter((field) => field.matches(definition.selector) || field.querySelector(definition.selector)) }));
  const assigned = new Set(groups.flatMap((group) => group.fields));
  const remaining = controls.filter((field) => !assigned.has(field));
  if (remaining.length) {
    const additional = groups.find((group) => group.definition.key === 'additional');
    if (additional) additional.fields.push(...remaining);
    else groups.splice(-2, 0, { definition: { key: 'additional', title: 'Additional information', description: 'Other information saved with the learner record.', selector: '' }, fields: remaining });
  }

  grid.classList.add('learner-form-layout');
  const fragment = document.createDocumentFragment();
  let number = 0;
  for (const { definition, fields } of groups) {
    if (!fields.length) continue;
    const section = document.createElement('fieldset');
    section.className = 'learner-form-section';
    section.dataset.learnerSection = definition.key;
    const legend = document.createElement('legend');
    const badge = document.createElement('span');
    badge.className = 'learner-section-number';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(++number).padStart(2, '0');
    legend.append(badge, document.createTextNode(definition.title));
    const description = document.createElement('p');
    description.className = 'learner-section-description';
    description.textContent = definition.description;
    const content = document.createElement('div');
    content.className = 'learner-form-section-grid';
    content.append(...fields);
    section.append(legend, description, content);
    if (definition.key === 'additional') {
      section.hidden = fields.every((field) => field.id === 'extraFieldsContainer' && (!field.children.length || field.style.display === 'none'));
    }
    fragment.append(section);
  }
  grid.replaceChildren(fragment);

  for (const row of Array.from(grid.querySelectorAll<HTMLElement>('.nutrition-inputs'))) {
    for (const control of Array.from(row.children)) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) continue;
      const label = document.createElement('label');
      label.htmlFor = control.id;
      label.textContent = control.id.endsWith('Height') ? 'Height (m)'
        : control.id.endsWith('Weight') ? 'Weight (kg)' : 'Nutritional status';
      control.before(label);
      label.append(control);
    }
  }

  for (const field of Array.from(grid.querySelectorAll<HTMLElement>('.field'))) {
    const required = field.querySelector(':scope > input[required], :scope > select[required], :scope > textarea[required]');
    const label = field.querySelector(':scope > label');
    if (required && label && !label.textContent?.includes('*')) {
      const mark = document.createElement('span');
      mark.className = 'learner-required-mark';
      mark.textContent = ' *';
      mark.setAttribute('aria-hidden', 'true');
      label.append(mark);
    }
  }
  enhanceModalHeader(form, archived);
}

function enhanceModalHeader(form: HTMLFormElement, archived: boolean): void {
  const modal = form.closest<HTMLElement>('.modal');
  const header = modal?.querySelector('.modal-header');
  const title = header?.querySelector('h3');
  if (!modal || !header || !title) return;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', title.id);
  if (!header.querySelector('.learner-modal-heading')) {
    const heading = document.createElement('div');
    heading.className = 'learner-modal-heading';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'learner-modal-eyebrow';
    eyebrow.textContent = archived ? 'Archived learner record' : 'Learner record';
    const hint = document.createElement('p');
    hint.textContent = 'Review each section. Fields marked * are required.';
    header.prepend(heading);
    heading.append(eyebrow, title, hint);
    const status = header.querySelector('#learnerModalStatus');
    if (status) heading.append(status);
  }
  const close = header.querySelector<HTMLButtonElement>('.modal-close');
  if (close) { close.type = 'button'; close.setAttribute('aria-label', 'Close learner form'); }
}

export function ensureAnecdotalRecordsInput(form: HTMLFormElement, archived = false): void {
  const grid = form.querySelector('.field-grid');
  const id = archived ? 'archiveAnecdotalRecords' : 'f_anecdotalRecords';
  if (!grid || form.querySelector(`#${id}`)) return;
  const field = document.createElement('div');
  field.className = 'field span-2 anecdotal-records-field';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Anecdotal Records';
  const input = document.createElement('textarea');
  input.id = id;
  input.name = 'anecdotalRecords';
  input.rows = 5;
  input.placeholder = 'Enter verified conduct or anecdotal information about this learner.';
  const hint = document.createElement('small');
  hint.id = `${id}_hint`;
  hint.className = 'field-hint';
  hint.textContent = 'Saved with the learner’s information and used to fill the Good Moral certificate. Review the wording before printing.';
  input.setAttribute('aria-describedby', hint.id);
  field.append(label, input, hint);
  grid.append(field);
}
