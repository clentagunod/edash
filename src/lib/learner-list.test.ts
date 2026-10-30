import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: null,
  setPersistence: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
};
const mockDb = {
  enablePersistence: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn() })) })),
};

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mockAuth, firestore: () => mockDb })),
  auth: Object.assign(vi.fn(() => mockAuth), { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
  firestore: vi.fn(() => mockDb),
});

const {
  buildLearnerDetailSections,
  applyAutomaticFinalGrades,
  ensureSubjectInputs,
  ensureIdentityInputs,
  ensureSuffixInputs,
  ensureNutritionInputs,
  ensureReadingInputs,
  ensureMathInputs,
  ensureTransferInputs,
  ensureLearnerStatusInputs,
  ensureLearnerInspectModal,
  filterLearnersByTeacherScope,
  filterDemoLearners,
  LL,
  normalizeNotAvailableInput,
  renderLearnerDetailSections,
  renderLearnersTable,
  sentenceCaseName,
  sortLearners,
  wireGuardianContactFields,
} = await import('./learner-list');
const { showToast } = await import('./shell');
const { fsCanonicalLearner_ } = await import('./firestore-api');
const firestoreApi = await import('./firestore-api');
const { renderLearnerCardFields } = await import('./learner-card-record');
const cardPreferences = { attendanceMonths: ['Aug', 'Sep'], attendanceRows: [{ id: 'classDays', label: 'Class days' }, { id: 'daysPresent', label: 'Present' }, { id: 'daysAbsent', label: 'Absent' }] };
const { ensureAnecdotalRecordsInput, organizeLearnerForm } = await import('./learner-form-layout');
const { openArchiveEditor } = await import('./archive-editor');
const { LPSApi } = await import('./sheets-api');
const learnerPageMarkup = import.meta.glob('../pages/markup/{masterlist,program-*}.html', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

describe('learner list sorting and teacher scope', () => {
  it('sorts names by surname and preserves lowercase after hyphens', () => {
    const learners = [
      { firstName: 'Cati-yagan', lastName: 'Zulu' },
      { firstName: 'Ana', lastName: 'Cruz' },
      { firstName: 'Ben', lastName: 'Adams' },
    ];

    expect(sortLearners(learners, 'name-asc').map(({ lastName }) => lastName))
      .toEqual(['Adams', 'Cruz', 'Zulu']);
    expect(sentenceCaseName('cati-yagan')).toBe('Cati-yagan');
  });

  it('sorts learner surnames and added dates before pagination', () => {
    const learners = [
      { firstName: 'Zoe', lastName: 'Adams', dateAdded: '2026-05-12' },
      { firstName: 'Alex', lastName: 'Brown', dateAdded: '2026-06-12' },
    ];
    expect(sortLearners(learners, 'name-asc').map(({ firstName }) => firstName))
      .toEqual(['Zoe', 'Alex']);
    expect(sortLearners(learners, 'name-desc').map(({ firstName }) => firstName))
      .toEqual(['Alex', 'Zoe']);
    expect(sortLearners(learners, 'date-newest').map(({ firstName }) => firstName))
      .toEqual(['Alex', 'Zoe']);
    expect(sortLearners(learners, 'date-oldest').map(({ firstName }) => firstName))
      .toEqual(['Zoe', 'Alex']);
  });

  it('sorts admin learner lists by Kinder-to-Grade-6 order then section', () => {
    const learners = [
      { learnerId: 'grade-2-b', gradeLevel: 'Grade 2', section: 'B' },
      { learnerId: 'grade-1', gradeLevel: 'Grade 1', section: 'C' },
      { learnerId: 'kinder', gradeLevel: 'Kinder', section: 'A' },
      { learnerId: 'grade-2-a', gradeLevel: '2', section: 'A' },
      { learnerId: 'grade-6', gradeLevel: 'Grade 6', section: 'A' },
    ];
    expect(sortLearners(learners, 'grade-section').map(({ learnerId }) => learnerId))
      .toEqual(['kinder', 'grade-1', 'grade-2-a', 'grade-2-b', 'grade-6']);
  });

  it('scopes teachers to assigned grade-section pairs, not section names alone', () => {
    const learners = [
      { learnerId: 'assigned', gradeLevel: 'Grade 1', section: 'A' },
      { learnerId: 'same-section-other-grade', gradeLevel: 'Grade 2', section: 'A' },
      { learnerId: 'unassigned-section', gradeLevel: 'Grade 1', section: 'B' },
    ];
    expect(filterLearnersByTeacherScope(learners, [
      { gradeLevel: '1', section: 'A' },
    ]).map(({ learnerId }) => learnerId)).toEqual(['assigned']);
  });
});

describe('shared learner forms and Anecdotal Records', () => {
  let preferencesSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { preferencesSpy = vi.spyOn(firestoreApi, 'fsGetCardPrintingPreferences').mockResolvedValue(cardPreferences); });
  afterEach(() => { preferencesSpy.mockRestore(); });
  it.each(Object.entries(learnerPageMarkup))('keeps controls and validation intact while grouping %s', (_path, markup) => {
    document.body.innerHTML = markup;
    ensureIdentityInputs();
    ensureSuffixInputs();
    ensureNutritionInputs();
    ensureReadingInputs();
    ensureMathInputs();
    ensureSubjectInputs();
    ensureTransferInputs();
    ensureLearnerStatusInputs();
    const form = document.querySelector<HTMLFormElement>('#learnerForm')!;
    ensureAnecdotalRecordsInput(form);
    renderLearnerCardFields(form, { teacherComments: ['First', 'Second', 'Third'], attendance: { daysPresent: { Aug: 20 } } }, cardPreferences);
    const input = document.querySelector<HTMLTextAreaElement>('#f_anecdotalRecords')!;
    input.value = 'no recorded disciplinary violations';
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    const controls = () => [...form.querySelectorAll<HTMLInputElement>('input, select, textarea')]
      .map((control) => ({ id: control.id, value: control.value, required: control.required, checked: control.checked }));
    const before = controls().sort((a, b) => a.id.localeCompare(b.id));
    organizeLearnerForm(form);
    organizeLearnerForm(form);
    expect(controls().sort((a, b) => a.id.localeCompare(b.id))).toEqual(before);
    expect(document.querySelectorAll('#f_anecdotalRecords')).toHaveLength(1);
    expect([...form.querySelectorAll('[data-learner-section]')].slice(-3).map((section) => section.getAttribute('data-learner-section'))).toEqual(['transfer', 'anecdotal', 'card-record']);
    expect(form.querySelectorAll('[data-teacher-comment]')).toHaveLength(3);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onInput).toHaveBeenCalledOnce();
    form.reset();
    expect(input.value).toBe('');
  });

  it('keeps Anecdotal Records in canonical Firestore data with an empty default for older records', () => {
    expect(fsCanonicalLearner_({ learnerId: '123456789012', anecdotalRecords: 'no recorded violations' }).anecdotalRecords).toBe('no recorded violations');
    expect(fsCanonicalLearner_({ learnerId: '123456789012' }).anecdotalRecords).toBe('');
    expect(fsCanonicalLearner_({}).teacherComments).toEqual(['', '', '']);
    expect(fsCanonicalLearner_({ attendance: { daysPresent: { Aug: 20 } }, teacherComments: ['One', 'Two', 'Three'] })).toEqual(expect.objectContaining({
      teacherComments: ['One', 'Two', 'Three'], attendance: { classDays: {}, daysPresent: { Aug: '20' }, daysAbsent: {} },
    }));
  });

  it('preserves saved card records when older update callers omit them, and accepts explicit clearing', async () => {
    const saved = { teacherComments: ['Keep this comment', '', ''], attendance: { classDays: { Aug: '20' }, daysPresent: { Aug: '20' }, daysAbsent: { Aug: '0' } } };
    const ref = { set: vi.fn(async (data) => { Object.assign(saved, data); }) };
    const collection = vi.spyOn(mockDb, 'collection').mockReturnValue({ doc: vi.fn(() => ({ collection: vi.fn(() => ({ doc: vi.fn(() => ref) })) })) });
    const audit = vi.spyOn(LPSApi, 'recordAuditEvent').mockResolvedValue({});
    vi.useFakeTimers();
    try {
      await firestoreApi.fsUpdateLearner('2026-2027', '123456789012', { firstName: 'Updated', enrollmentStatus: 'ACTIVE' });
      expect(saved.teacherComments[0]).toBe('Keep this comment');
      expect(saved.attendance.daysPresent.Aug).toBe('20');
      expect(ref.set.mock.calls[0][0]).not.toHaveProperty('teacherComments');
      expect(ref.set.mock.calls[0][0]).not.toHaveProperty('attendance');
      await firestoreApi.fsUpdateLearner('2026-2027', '123456789012', { teacherComments: ['', '', ''], attendance: { classDays: {}, daysPresent: {}, daysAbsent: {} } });
      expect(saved.teacherComments).toEqual(['', '', '']);
      expect(saved.attendance).toEqual({ classDays: {}, daysPresent: {}, daysAbsent: {} });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      audit.mockRestore();
      collection.mockRestore();
    }
  });

  it('loads and clears records correctly when switching between archived learners', async () => {
    document.body.innerHTML = '';
    await openArchiveEditor('transferredOut', '2026-2027', { learnerId: '123', anecdotalRecords: 'Saved archive record', teacherComments: ['Saved term', '', ''] }, vi.fn());
    expect(document.querySelector<HTMLTextAreaElement>('[data-teacher-comment]')?.value).toBe('Saved term');
    expect(document.querySelector<HTMLTextAreaElement>('#archiveAnecdotalRecords')?.value).toBe('Saved archive record');
    expect(document.querySelector('#archiveAnecdotalRecords')?.closest('[data-learner-section]')?.getAttribute('data-learner-section')).toBe('anecdotal');
    await openArchiveEditor('dropout', '2026-2027', { learnerId: '456' }, vi.fn());
    expect(document.querySelector<HTMLTextAreaElement>('[data-teacher-comment]')?.value).toBe('');
    expect(document.querySelector<HTMLTextAreaElement>('#archiveAnecdotalRecords')?.value).toBe('');
  });

  it('saves edited Anecdotal Records with the correct archived learner', async () => {
    document.body.innerHTML = '';
    const update = vi.spyOn(LPSApi, 'updateArchiveRecord').mockResolvedValue({ updated: true });
    try {
      await openArchiveEditor('transferredOut', '2026-2027', { learnerId: '123456789012', firstName: 'Alex', lastName: 'Cruz', gender: 'Male' }, vi.fn());
      document.querySelector<HTMLTextAreaElement>('[data-teacher-comment="2"]')!.value = 'Third-term progress';
      document.querySelector<HTMLInputElement>('[aria-label="Present Aug"]')!.value = '20';
      document.querySelector<HTMLTextAreaElement>('#archiveAnecdotalRecords')!.value = 'Verified observation.\nFollow-up completed.';
      document.querySelector('#archiveEditorForm')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(update).toHaveBeenCalledWith('transferredOut', '2026-2027', '123456789012', expect.objectContaining({ anecdotalRecords: 'Verified observation.\nFollow-up completed.', teacherComments: ['', '', 'Third-term progress'], attendance: expect.objectContaining({ daysPresent: { Aug: '20', Sep: '' } }) })));
    } finally { update.mockRestore(); }
  });
});

describe('automatic final grade behavior', () => {
  it('writes the mean of configured numerical terms on learner saves', () => {
    LL.gradeTerms = [
      { id: 'quarter1', label: '1st Term' },
      { id: 'quarter2', label: '2nd Term' },
      { id: 'quarter3', label: '3rd Term' },
      { id: 'final', label: 'Final Grade' },
    ];
    LL.curriculumSubjects = [{ id: 'math', label: 'Math' }];
    LL.gradingConfigReady = true;
    LL.gradingConfigGrade = 'Grade 3';
    LL.gradeGrading = { gradingType: 'numerical', finalGradeMode: 'automatic' };
    const result = applyAutomaticFinalGrades({
      gradeLevel: 'Grade 3',
      gradesByTerm: {
        quarter1: { math: '80' },
        quarter2: { math: '90' },
        quarter3: { math: '' },
      },
    });

    expect(result.gradesByTerm.final.math).toBe('85');
    expect(result.math).toBe('85');
  });

  it('leaves the final grade untouched for manual or letter grading', () => {
    const learner = { gradeLevel: 'Grade 3', math: '88', gradesByTerm: { quarter1: { math: '80' } } };
    LL.gradingConfigReady = true;
    LL.gradingConfigGrade = 'Grade 3';
    LL.gradeGrading = { gradingType: 'numerical', finalGradeMode: 'manual' };
    expect(applyAutomaticFinalGrades(learner)).toBe(learner);
    LL.gradeGrading = { gradingType: 'letter', finalGradeMode: 'automatic' };
    expect(applyAutomaticFinalGrades(learner)).toBe(learner);
    LL.gradingConfigReady = false;
  });
});

describe('learner grade input configuration', () => {
  it('switches subject fields between numerical inputs and configured letter options', () => {
    const original = {
      curriculumSubjects: LL.curriculumSubjects,
      gradeGrading: LL.gradeGrading,
      gradeTerms: LL.gradeTerms,
      gradeTerm: LL.gradeTerm,
      editingLearnerOriginal: LL.editingLearnerOriginal,
    };
    document.body.innerHTML = '<form id="learnerForm"><div class="field-grid"></div></form>';
    LL.curriculumSubjects = [{ id: 'math', label: 'Math' }];
    LL.gradeTerms = [{ id: 'quarter1', label: '1st Term' }, { id: 'final', label: 'Final Grade' }];
    LL.gradeTerm = 'quarter1';
    LL.editingLearnerOriginal = {};
    LL.gradeGrading = { gradingType: 'numerical', finalGradeMode: 'manual', letterScale: [] };

    ensureSubjectInputs();
    expect(document.querySelector('#f_math')?.tagName).toBe('INPUT');

    LL.gradeGrading = {
      gradingType: 'letter',
      finalGradeMode: 'manual',
      letterScale: [{ letter: 'E', min: 90, max: 100 }, { letter: 'G', min: 0, max: 89 }],
    };
    ensureSubjectInputs();

    const letterSelect = document.querySelector<HTMLSelectElement>('#f_math');
    expect(letterSelect?.tagName).toBe('SELECT');
    expect([...letterSelect!.options].map(({ value }) => value)).toEqual(['', 'E', 'G']);

    LL.gradeGrading = { ...LL.gradeGrading, gradingType: 'numerical' };
    ensureSubjectInputs();
    expect(document.querySelector('#f_math')?.tagName).toBe('INPUT');

    LL.curriculumSubjects = original.curriculumSubjects;
    LL.gradeGrading = original.gradeGrading;
    LL.gradeTerms = original.gradeTerms;
    LL.gradeTerm = original.gradeTerm;
    LL.editingLearnerOriginal = original.editingLearnerOriginal;
    document.body.innerHTML = '';
  });
});

describe('learner guardian and contact inputs', () => {
  it('normalizes N/A to uppercase while typing and shows availability guidance', () => {
    document.body.innerHTML = `
      <div class="field"><input id="f_guardian"></div>
      <div class="field"><input id="f_contact"></div>`;
    wireGuardianContactFields();

    const guardianInput = document.querySelector<HTMLInputElement>('#f_guardian')!;
    const contactInput = document.querySelector<HTMLInputElement>('#f_contact')!;
    guardianInput.value = 'n/a';
    guardianInput.dispatchEvent(new Event('input'));
    contactInput.value = 'n/a';
    contactInput.dispatchEvent(new Event('input'));

    expect(guardianInput.value).toBe('N/A');
    expect(contactInput.value).toBe('N/A');
    expect(document.querySelectorAll('.not-available-hint')).toHaveLength(2);
    expect([...document.querySelectorAll('.not-available-hint')].map((hint) => hint.textContent))
      .toEqual(['N/A if not available', 'N/A if not available']);
    expect(normalizeNotAvailableInput('0917-123-4567')).toBe('0917-123-4567');
    expect(sentenceCaseName('N/A')).toBe('N/A');
    expect(sentenceCaseName('n / a')).toBe('N/A');
    document.body.innerHTML = '';
  });
});

describe('notification stack', () => {
  it('deduplicates repeated notifications and limits the stack to two items', () => {
    vi.useFakeTimers();
    document.querySelector('.toast-stack')?.remove();

    const first = showToast('Loading is taking longer than expected.', 'info', { title: 'Still loading' });
    expect(showToast('Loading is taking longer than expected.', 'info', { title: 'Still loading' })).toBe(first);
    showToast('Enrollment refreshed.', 'success');
    showToast('A new update is available.', 'info');

    const toasts = [...document.querySelectorAll('.toast-stack .toast')];
    expect(toasts).toHaveLength(2);
    expect(toasts.map((toast) => toast.textContent)).toEqual([
      'Enrollment refreshed.x',
      'A new update is available.x',
    ]);
    document.querySelector('.toast-stack')?.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

describe('learner list section filtering', () => {
  it('filters sections alongside grade and program filters', () => {
    LL.program = '';
    LL.programFilter = '';
    LL.gradeLevel = '';
    LL.section = 'diamond';
    LL.gender = '';
    LL.search = '';
    LL.page = 1;

    expect(filterDemoLearners().items.map(({ learnerId }) => learnerId))
      .toEqual(['LRN-0001', 'LRN-0007']);

    LL.gradeLevel = 'Grade 3';
    expect(filterDemoLearners().items.map(({ learnerId }) => learnerId))
      .toEqual(['LRN-0001', 'LRN-0007']);

    LL.program = '4Ps';
    expect(filterDemoLearners().items.map(({ learnerId }) => learnerId))
      .toEqual(['LRN-0001']);

    LL.program = '';
    LL.gradeLevel = '';
    LL.section = '';
  });
});

describe('learner inspection details', () => {
  it('shows an inspect action in the shared learner table and provides an accessible dialog', () => {
    sessionStorage.removeItem('lps_user_profile');
    document.body.innerHTML = '<table><tbody id="learnersTableBody"></tbody></table>';
    ensureLearnerInspectModal();
    renderLearnersTable([{
      learnerId: '123456789012',
      firstName: 'Alex',
      lastName: 'Reyes',
      gradeLevel: 'Grade 2',
      section: 'A',
    }]);

    const inspectButton = document.querySelector<HTMLButtonElement>('[data-inspect="123456789012"]');
    expect(inspectButton?.getAttribute('aria-label')).toBe('Inspect Alex Reyes');
    expect(inspectButton?.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('#learnerInspectBackdrop [role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  it('hides the inspect action when learner inspection is disabled in the user preferences', () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      teacherPrefs: { theme: 'Light', inspectLearner: false },
    }));
    document.body.innerHTML = '<table><tbody id="learnersTableBody"></tbody></table>';
    renderLearnersTable([{
      learnerId: '123456789012',
      firstName: 'Alex',
      lastName: 'Reyes',
      gradeLevel: 'Grade 2',
      section: 'A',
    }]);

    expect(document.querySelector('[data-inspect="123456789012"]')).toBeNull();
    sessionStorage.removeItem('lps_user_profile');
  });

  it('groups available learner information and includes custom fields and false program flags', () => {
    const sections = buildLearnerDetailSections({
      learnerId: '123456789012',
      firstName: 'Alex',
      gradeLevel: 'Grade 2',
      guardian: 'Jamie',
      is4Ps: false,
      bosyRMA: 'Proficient',
      bosyHeight: 120,
      math: 94,
      extra: { customNote: 'Needs reading support' },
    });

    expect(sections.find(({ title }) => title === 'Personal information')?.fields)
      .toContainEqual({ key: 'learnerId', label: 'Learner ID', value: '123456789012' });
    expect(sections.find(({ title }) => title === 'Programs')?.fields)
      .toContainEqual({ key: 'is4Ps', label: '4Ps beneficiary', value: 'No' });
    expect(sections.find(({ title }) => title === 'Learning assessments')?.fields)
      .toContainEqual({ key: 'bosyRMA', label: 'BOSY RMA', value: 'Proficient' });
    expect(sections.find(({ title }) => title === 'Nutrition')?.fields)
      .toContainEqual({ key: 'bosyHeight', label: 'BOSY Height', value: '120' });
    expect(sections.find(({ title }) => title === 'Academic grades')?.fields)
      .toContainEqual({ key: 'math', label: 'Math', value: '94' });
    expect(sections.find(({ title }) => title === 'Additional information')?.fields)
      .toContainEqual({ key: 'customNote', label: 'Custom Note', value: 'Needs reading support' });
  });

  it('formats serialized academic grades as readable term and subject grades', () => {
    const sections = buildLearnerDetailSections({
      gradesByTerm: JSON.stringify({
        final: { math: '94', english: '88', science: '' },
      }),
    });

    expect(sections.find(({ title }) => title === 'Academic grades')?.fields)
      .toContainEqual({
        key: 'gradesByTerm',
        label: 'Grades by term',
        value: 'Final Grade: Math: 94 • English: 88',
      });
  });

  it('escapes learner-provided values in the details panel', () => {
    document.body.innerHTML = renderLearnerDetailSections({
      firstName: '<img src=x onerror=alert(1)>',
      guardian: 'Jamie & Alex',
    });

    expect(document.querySelector('.learner-inspect-section img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.innerHTML).toContain('&lt;img');
    expect(document.body.innerHTML).toContain('Jamie &amp; Alex');
  });

  it('renders academic grades as readable term cards instead of a flattened string', () => {
    document.body.innerHTML = renderLearnerDetailSections({
      gradesByTerm: {
        quarter1: { eppTle: '90', math: '90', filipino: '90' },
        final: { math: '93' },
      },
      math: '93',
    });

    expect(document.querySelectorAll('.learner-inspect-grade-term')).toHaveLength(2);
    expect(document.querySelector('.learner-inspect-grade-term h5')?.textContent).toBe('1st Term');
    expect(document.querySelector('.learner-inspect-grade-list')?.textContent).toContain('EPP/TLE');
    expect(document.querySelector('.learner-inspect-grade-list')?.textContent).toContain('90');
    expect(document.querySelectorAll('.learner-inspect-field')).toHaveLength(0);
  });

  it('keeps legacy final grades visible alongside configured quarter grades', () => {
    document.body.innerHTML = renderLearnerDetailSections({
      gradesByTerm: { quarter1: { filipino: '90' } },
      math: '94',
    });

    expect([...document.querySelectorAll('.learner-inspect-grade-term h5')].map((heading) => heading.textContent))
      .toEqual(['1st Term', 'Final Grade']);
    expect(document.querySelectorAll('.learner-inspect-grade-row')).toHaveLength(2);
    expect(document.querySelectorAll('.learner-inspect-grade-row')[1].textContent).toContain('94');
  });
});
