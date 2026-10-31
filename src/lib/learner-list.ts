// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { currentUserPreferences, readRememberedView, rememberView } from './preference-runtime';
import { LPSApi } from './sheets-api';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { Icon } from './icons';
import { collectTransferSchoolInputs, ensureTransferSchoolInputs, loadTransferSchoolInputs, updateTransferSchoolInputs } from './learner-transfer';
import { canManageLearners, confirmDiscardChanges, formSnapshot, isSchoolAdmin, isTeacher, isVisitorSession, paginationPageNumbers, storedAppProfile, teacherAssignmentsForProfile } from './app-config';
import { escapeHtml, formatAppDate, programBadges, renderShell, showToast } from './shell';
import { DEMO_LEARNERS, isSheetsApiConfigured } from './demo-data';
import { fsAddLearner, fsDeleteLearner, fsDeleteLearners, fsGetCardPrintingPreferences, fsGetGradeLevelGradingConfigurations, fsGetGradeTermCount, fsGetLearner, fsGetLearnerPage, fsSubscribeLearners } from './firestore-api';
import { PHIL_IRI_CATEGORIES } from './profile-charts';
import { CURRICULUM_SUBJECTS, LEGACY_CURRICULUM_SUBJECT_IDS, curriculumSubjectIdsForGrade, normalizeCurriculumGrade, normalizeCurriculumSubjectPool } from './curriculum-subjects';
import { computeNumericalFinalGrades, DEFAULT_GRADE_TERM, FINAL_GRADE_TERM, GRADE_TERMS, gradeTermsForCount, gradesForTerm, mergeGradesForTerm } from './academic-grades';
import { DEFAULT_GRADE_LEVEL_GRADING, gradeLevelConfigKey, normalizeGradeLevelGrading } from './grading-config';
import { compareLearnersBySurname, formatLearnerName } from './learner-sorting';
import { ensureAnecdotalRecordsInput, organizeLearnerForm } from './learner-form-layout';
import { collectLearnerCardFields, loadLearnerCardFields, syncLearnerCardTerm } from './learner-card-record';
import { collectDocumentStatusFields, renderDocumentStatusFields } from './document-status';
import { sf10EmailDetails } from './sf10-email';

/**
 * ============================================================================
 * LEARNER-LIST.JS
 * Powers masterlist.html and all four program pages (program-4ps.html,
 * program-ip.html, program-sned.html, program-aral.html). Each of those
 * pages calls initLearnerListPage() with a fixed `program` filter — for the
 * masterlist that's "" (no filter, shows everyone).
 * ============================================================================
 */

export const PROGRAM_FIELD_MAP = { "4Ps": "is4Ps", IP: "isIP", SNED: "isSNED", ARAL: "isARAL", Muslim: "isMuslim" };
const CURRICULUM_SUBJECT_IDS = new Set(CURRICULUM_SUBJECTS.map(({ id }) => id));

export let LL = {
  program: "",
  page: 1,
  pageSize: 8,
  search: "",
  gradeLevel: "",
  section: "",
  sectionAssignmentKey: "",
  sortBy: "name-asc",
  gender: "",
  programFilter: "",
  editingId: null,
  deletingId: null,
  deletingName: "",
  selectedIds: new Set(),
  loadedSchoolYear: "",
  extraFieldHeaders: [], // custom columns detected in the current Sheet, e.g. ["MotherTongue", "Remarks"]
  loadToken: 0, // bumped on every loadLearners() call so stale responses can be discarded
  enrollmentSectionsByYear: {},
  enrollmentSectionsInflight: {},
  curriculumSubjects: [...CURRICULUM_SUBJECTS],
  gradeTerms: gradeTermsForCount(),
  gradeTermCountByYear: {},
  gradeTermCountRequestsByYear: {},
  sectionSchoolYear: "",
  extraSchemaByYear: {},
  curriculumSubjectsByYear: {},
  curriculumLoadedAtByYear: {},
  curriculumRequestsByYear: {},
  subjectRequestId: 0,
  activeSubjectIds: [],
  gradingByGradeByYear: {},
  gradingRequestsByYear: {},
  gradeGrading: { ...DEFAULT_GRADE_LEVEL_GRADING, letterScale: DEFAULT_GRADE_LEVEL_GRADING.letterScale.map((row) => ({ ...row })) },
  gradingConfigYear: "",
  gradingConfigGrade: "",
  gradingConfigReady: false,
  subjectConfigYear: "",
  subjectConfigGrade: "",
  subjectsLoading: false,
  editingLearnerOriginal: {},
  gradeTerm: DEFAULT_GRADE_TERM,
};
export let learnerModalBusy = false;
export let learnerMutationBusy = false;
export let learnerFormInitialSnapshot = "";
export let learnerListUnsubscribe = null;
let inspectReturnFocus = null;

const LEARNER_DETAIL_GROUPS = [
  { title: "Personal information", matches: (key) => ["learnerId", "firstName", "middleName", "lastName", "suffix", "name", "birthDate", "age", "gender"].includes(key) },
  { title: "Enrollment", matches: (key) => ["gradeLevel", "section", "schoolYear", "enrollmentStatus", "eosyStatus", "dateAdded"].includes(key) },
  { title: "Parent / guardian", matches: (key) => ["guardian", "contact"].includes(key) },
  { title: "Programs", matches: (key) => ["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim"].includes(key) },
  { title: "Learning assessments", matches: (key) => /^(bosy|mosy|eosy)(crla|philiri|rma)$/i.test(key) },
  { title: "Nutrition", matches: (key) => /^(bosy|mosy|eosy)(height|weight|nutritionalstatus)$/i.test(key) },
  { title: "Academic grades", matches: (key) => CURRICULUM_SUBJECT_IDS.has(key) || key === "gradesByTerm" },
  { title: "Transfer information", matches: (key) => ["transferType", "transferIn", "transferOut", "transferSchoolId", "transferSchool", "transferSchoolAddress", "transferSchoolZipCode", "transferDate", "transferReason", "transferNotes", "documentStatus", "documentStatusCustom", "documentStatusDates"].includes(key) },
  { title: "SF10 email", matches: (key) => key === "sf10Email" },
  { title: "Anecdotal Records", matches: (key) => key === "anecdotalRecords" },
];

const LEARNER_DETAIL_LABELS = {
  learnerId: "Learner ID",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  name: "Full name",
  birthDate: "Birthdate",
  gradeLevel: "Grade level",
  schoolYear: "School year",
  enrollmentStatus: "Enrollment status",
  eosyStatus: "EOSY status",
  guardian: "Parent / guardian",
  contact: "Contact number",
  is4Ps: "4Ps beneficiary",
  isIP: "IP learner",
  isSNED: "SNED learner",
  isARAL: "ARAL tagged",
  isMuslim: "Muslim learner",
  aralPan: "AralPan",
  esp: "ESP",
  pe: "PE",
  epp: "EPP",
  motherTongue: "Mother tongue",
  gradesByTerm: "Grades by term",
  transferIn: "Transfer in",
  transferOut: "Transfer out",
  transferSchoolId: "Transfer school ID",
  transferSchoolAddress: "Transfer school address",
  transferSchoolZipCode: "Transfer school ZIP code",
  anecdotalRecords: "Anecdotal Records",
  documentStatus: "Document Status",
  documentStatusCustom: "Custom Document Status",
  documentStatusDates: "Document Status dates",
  sf10Email: "Latest SF10 email",
  ...Object.fromEntries(CURRICULUM_SUBJECTS.map(({ id, label }) => [id, label])),
};

/**
 * Central teacher-coverage helpers. The single source of truth is
 * teacherAssignmentsForProfile() (app-config), which reads the signed-in
 * teacher's coverage from users/{uid}.teacherAssignments (falling back to the
 * legacy teacherAssignment field). Every add/edit modal instance — the
 * Masterlist and ALL program pages — shares these helpers, so a teacher
 * assigned to exactly one section is auto-registered without a picker, while a
 * teacher assigned to two or more sections gets a picker limited to their
 * coverage.
 */
export function teacherAssignmentKey(assignment) {
  return `${String(assignment?.gradeLevel || "").trim()}|${String(assignment?.section || "").trim()}`;
}

export function teacherAssignedGradeOptions() {
  return [...new Set(teacherAssignmentsForProfile()
    .filter((assignment) => assignment?.gradeLevel)
    .map((assignment) => String(assignment.gradeLevel).trim())
    .filter(Boolean))];
}

export function teacherAssignedSectionsForGrade(gradeLevel) {
  const target = String(gradeLevel || "").trim();
  return [...new Set(teacherAssignmentsForProfile()
    .filter((assignment) => String(assignment?.gradeLevel || "").trim() === target)
    .map((assignment) => String(assignment?.section || "").trim())
    .filter(Boolean))];
}

export function teacherAssignmentOptions() {
  return teacherAssignmentsForSelectedYear_()
    .filter((assignment) => assignment?.gradeLevel && assignment?.section)
    .map((assignment) => ({
      gradeLevel: String(assignment.gradeLevel).trim(),
      section: String(assignment.section).trim(),
      label: `${String(assignment.gradeLevel).trim()} · Section ${String(assignment.section).trim()}`,
      key: teacherAssignmentKey(assignment),
    }))
    .filter((assignment, index, all) => all.findIndex((item) => item.key === assignment.key) === index);
}

export function teacherLearnerScope() {
  if (!isTeacher()) return [];
  return teacherAssignmentsForSelectedYear_()
    .filter((assignment) => assignment?.gradeLevel && assignment?.section)
    .map((assignment) => ({ gradeLevel: assignment.gradeLevel, section: assignment.section }));
}

function teacherAssignmentsForSelectedYear_() {
  const selectedYear = String(getSelectedSchoolYear() || "").trim().replace(/[–—]/g, "-").replace(/\s*[\/-]\s*/g, "-").replace(/\s+/g, "");
  if (!selectedYear) return teacherAssignmentsForProfile();
  return teacherAssignmentsForProfile().filter((assignment) => {
    const assignmentYear = String(assignment?.schoolYear || "").trim().replace(/[–—]/g, "-").replace(/\s*[\/-]\s*/g, "-").replace(/\s+/g, "");
    return assignmentYear === selectedYear;
  });
}

export function applyTeacherLearnerScope() {
  const scope = teacherLearnerScope();
  const gradeFilter = document.getElementById("gradeFilter");
  const formGrade = document.getElementById("f_gradeLevel");
  const formSection = document.getElementById("f_section");
  const formAssignment = document.getElementById("f_teacherAssignment");
  if (!scope.length) return null;
  if (gradeFilter) {
    gradeFilter.value = "";
    gradeFilter.hidden = true;
    gradeFilter.disabled = true;
  }
  const teacherGrades = teacherAssignedGradeOptions();
  const assignmentOptions = teacherAssignmentOptions();

  // Two or more assignments: show a picker limited to the teacher's coverage.
  // Exactly one assignment: no picker — the learner is auto-registered to it.
  if (assignmentOptions.length > 1) {
    let assignmentSelect = formAssignment;
    if (!assignmentSelect) {
      const anchor = formGrade?.closest(".field") || formSection?.closest(".field") || document.querySelector("#learnerForm .field-grid");
      if (anchor) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        wrapper.innerHTML = `<label for="f_teacherAssignment">Assigned section</label><select id="f_teacherAssignment" aria-label="Assigned section"></select>`;
        anchor.parentNode.insertBefore(wrapper, anchor);
        assignmentSelect = document.getElementById("f_teacherAssignment");
      }
    }
    if (assignmentSelect) {
      const currentGrade = String(formGrade?.value || "").trim();
      const currentSection = String(formSection?.value || "").trim();
      const fallbackKey = assignmentOptions[0].key;
      const currentKey = currentGrade && currentSection ? teacherAssignmentKey({ gradeLevel: currentGrade, section: currentSection }) : fallbackKey;
      assignmentSelect.innerHTML = assignmentOptions
        .map((assignment) => `<option value="${escapeHtml(assignment.key)}">${escapeHtml(assignment.label)}</option>`)
        .join("");
      assignmentSelect.disabled = false;
      assignmentSelect.closest(".field")?.removeAttribute("hidden");
      assignmentSelect.value = assignmentOptions.some((assignment) => assignment.key === currentKey) ? currentKey : fallbackKey;
      if (assignmentSelect.dataset.scopeWired !== "true") {
        assignmentSelect.dataset.scopeWired = "true";
        assignmentSelect.addEventListener("change", () => {
          const selectedAssignment = assignmentOptions.find((assignment) => assignment.key === assignmentSelect.value);
          if (!selectedAssignment) return;
          if (formGrade) formGrade.value = selectedAssignment.gradeLevel;
          if (formSection) formSection.value = selectedAssignment.section;
          validateSectionInput();
        });
      }
      // Keep grade/section fields in sync with the selected assignment so a
      // submit always carries one of the teacher's exact coverage sections.
      const selectedAssignment = assignmentOptions.find((assignment) => assignment.key === assignmentSelect.value);
      if (selectedAssignment) {
        if (formGrade) formGrade.value = selectedAssignment.gradeLevel;
        if (formSection) formSection.value = selectedAssignment.section;
      }
    }
  } else if (formAssignment) {
    formAssignment.remove();
  }

  if (formGrade) {
    const currentValue = formGrade.value;
    formGrade.innerHTML = teacherGrades.length
      ? `<option value="">Select…</option>${teacherGrades.map((grade) => `<option value="${escapeHtml(grade)}">${escapeHtml(grade)}</option>`).join("")}`
      : `<option value="">Select…</option>`;
    if (scope.length === 1) {
      formGrade.value = scope[0].gradeLevel;
      formGrade.disabled = true;
      formGrade.closest(".field")?.setAttribute("hidden", "true");
    } else {
      const assignmentKey = document.getElementById("f_teacherAssignment")?.value;
      const selectedAssignment = assignmentKey ? assignmentOptions.find((assignment) => assignment.key === assignmentKey) : null;
      formGrade.value = selectedAssignment ? selectedAssignment.gradeLevel : (teacherGrades.includes(currentValue) ? currentValue : (teacherGrades[0] || ""));
      formGrade.disabled = true;
      formGrade.closest(".field")?.removeAttribute("hidden");
    }
  }

  if (formSection) {
    const selectedGrade = formGrade && formGrade.value ? formGrade.value : scope[0]?.gradeLevel || "";
    const allowedSections = selectedGrade ? teacherAssignedSectionsForGrade(selectedGrade) : [];
    if (scope.length === 1) {
      formSection.value = scope[0].section;
      formSection.disabled = true;
      formSection.closest(".field")?.setAttribute("hidden", "true");
    } else {
      const assignmentKey = document.getElementById("f_teacherAssignment")?.value;
      const selectedAssignment = assignmentKey ? assignmentOptions.find((assignment) => assignment.key === assignmentKey) : null;
      const currentValue = formSection.value;
      formSection.disabled = true;
      formSection.closest(".field")?.removeAttribute("hidden");
      if (selectedAssignment) {
        formSection.value = selectedAssignment.section;
      } else if (allowedSections.length) {
        formSection.value = allowedSections.includes(currentValue) ? currentValue : allowedSections[0];
      }
    }
  }
  validateSectionInput();
  return scope;
}

/**
 * Subscribes this page to live learner updates for the selected school year.
 * The snapshot callback coalesces bursts (e.g. batch writes) into one quiet
 * re-render that reuses the current filters/pagination — no loading row, no
 * selection reset, and it never wipes a working table with an error state.
 */
export function subscribeLearnersLive(schoolYear) {
  learnerListUnsubscribe?.();
  learnerListUnsubscribe = null;
  if (!schoolYear || isVisitorSession() || typeof fsSubscribeLearners !== "function") return;
  let refreshTimer = null;
  learnerListUnsubscribe = fsSubscribeLearners(schoolYear, () => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshLearnersFromLive, 250);
  }, () => { /* Keep showing the last known good table on transient errors. */ });
}

export async function refreshLearnersFromLive() {
  const year = getSelectedSchoolYear();
  if (!year || !document.getElementById("learnersTableBody")) return;
  const requestToken = ++LL.loadToken;
  try {
    const result = await loadSortedLearnerPage(learnerQueryOptions(year), requestToken);
    if (requestToken !== LL.loadToken || year !== getSelectedSchoolYear()) return;
    if (!result) return;
    renderLearnersTable(result.items);
    renderPagination(result.total, result.page, result.pageSize);
  } catch (error) {
    // Deliberately quiet: a live refresh must never replace a working table.
  }
}

export function humanizeHeader(header) {
  return String(header)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function renderExtraFieldInputs(existingExtra) {
  const container = document.getElementById("extraFieldsContainer");
  if (!container) return;

  LL.extraFieldHeaders = [];
  const section = container.closest("[data-learner-section='additional']");
  if (section) section.hidden = false;
  container.style.display = "grid";
  container.innerHTML = `<div class="field extra-fields-loading"><span class="inline-spinner" aria-hidden="true"></span> Loading additional fields…</div>`;
  try {
    if (isSheetsApiConfigured() && !LL.extraSchemaByYear[getSelectedSchoolYear()]) {
      const schema = await LPSApi.getLearnerSchema(getSelectedSchoolYear());
      LL.extraSchemaByYear[getSelectedSchoolYear()] = schema.extraFields || [];
    }
    LL.extraFieldHeaders = LL.extraSchemaByYear[getSelectedSchoolYear()] || [];
  } catch (e) {
    LL.extraFieldHeaders = [];
  }

  if (LL.extraFieldHeaders.length === 0) {
    if (section) section.hidden = true;
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "grid";
  container.innerHTML = LL.extraFieldHeaders
    .map(
      (header, i) => `
      <div class="field">
        <label for="extra_${i}">${escapeHtml(humanizeHeader(header))}</label>
        <input id="extra_${i}" value="${escapeHtml((existingExtra && existingExtra[header]) || "")}" />
      </div>`
    )
    .join("");
}

export function collectExtraFieldValues() {
  const extra = {};
  LL.extraFieldHeaders.forEach((header, i) => {
    const input = document.getElementById("extra_" + i);
    if (input) extra[header] = input.value.trim();
  });
  return extra;
}

function ensureAdminSectionFilter() {
  const gradeFilter = document.getElementById("gradeFilter");
  if (!gradeFilter || document.getElementById("sectionFilter")) return;
  gradeFilter.insertAdjacentHTML(
    "afterend",
    '<select class="select-filter" id="sectionFilter" aria-label="Filter by section"><option value="">All Sections</option></select>'
  );
}

function updateAdminSectionFilterOptions() {
  const select = document.getElementById("sectionFilter");
  if (!select) return;
  const grade = normalizeSectionGrade(document.getElementById("gradeFilter")?.value);
  const sections = (LL.enrollmentSectionsByYear[LL.sectionSchoolYear] || [])
    .filter((entry) => !grade || normalizeSectionGrade(entry.gradeLevel) === grade)
    .map((entry) => String(entry.section || "").trim())
    .filter(Boolean)
    .filter((section, index, all) => all.findIndex((value) => value.toLowerCase() === section.toLowerCase()) === index)
    .sort((left, right) => left.localeCompare(right));
  if (LL.section && !sections.some((section) => section.toLowerCase() === LL.section.toLowerCase())) {
    LL.section = "";
  }
  select.innerHTML = '<option value="">All Sections</option>'
    + sections.map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`).join("");
  select.value = LL.section;
}

function ensureTeacherSectionFilter() {
  const gradeFilter = document.getElementById("gradeFilter");
  const assignmentOptions = teacherAssignmentOptions();
  let select = document.getElementById("sectionFilter");
  if (!gradeFilter) return;
  if (assignmentOptions.length < 2) {
    select?.remove();
    LL.sectionAssignmentKey = "";
    return;
  }
  if (!select) {
    gradeFilter.insertAdjacentHTML(
      "afterend",
      '<select class="select-filter" id="sectionFilter" aria-label="Filter by assigned grade and section"><option value="">All Assigned Sections</option></select>'
    );
    select = document.getElementById("sectionFilter");
    select.addEventListener("change", (event) => {
      LL.sectionAssignmentKey = event.target.value;
      LL.page = 1;
      loadLearners();
    });
  }
  if (LL.sectionAssignmentKey && !assignmentOptions.some(({ key }) => key === LL.sectionAssignmentKey)) {
    LL.sectionAssignmentKey = "";
  }
  select.innerHTML = '<option value="">All Assigned Sections</option>'
    + assignmentOptions.map(({ key, label }) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("");
  select.value = LL.sectionAssignmentKey;
}

function ensureLearnerSortFilter() {
  const anchor = document.getElementById("sectionFilter") || document.getElementById("gradeFilter");
  if (!anchor || document.getElementById("learnerSortFilter")) return;
  anchor.insertAdjacentHTML(
    "afterend",
    '<select class="select-filter" id="learnerSortFilter" aria-label="Sort learners">'
      + '<option value="name-asc">Name (A-Z)</option>'
      + '<option value="name-desc">Name (Z-A)</option>'
      + '<option value="date-newest">Recently added</option>'
      + '<option value="date-oldest">Oldest added</option>'
      + '<option value="grade-section">Grade & section (Kinder to Grade 6)</option>'
      + '<option value="grade-asc">Grade level (low to high)</option>'
      + '<option value="grade-desc">Grade level (high to low)</option>'
      + '<option value="section-asc">Section (A-Z)</option>'
      + '<option value="section-desc">Section (Z-A)</option>'
      + '</select>'
  );
}

function ensureLearnerToolbarLayout() {
  const toolbar = document.querySelector(".learner-list-toolbar");
  if (!toolbar || toolbar.querySelector(".learner-filter-controls")) return;
  const heading = document.createElement("div");
  heading.className = "learner-toolbar-heading";
  heading.innerHTML = '<div><span class="learner-toolbar-eyebrow">LEARNER DIRECTORY</span><h2>Find learners</h2></div><p>Search and refine the current list</p>';
  const controls = document.createElement("div");
  controls.className = "learner-filter-controls";
  while (toolbar.firstChild) controls.appendChild(toolbar.firstChild);
  toolbar.append(heading, controls);
  toolbar.querySelector("#searchInput")?.setAttribute("aria-label", "Search learners by name or learner ID");
  toolbar.querySelector("#gradeFilter")?.setAttribute("aria-label", "Filter by grade level");
  toolbar.querySelector("#programFilter")?.setAttribute("aria-label", "Filter by program");
  toolbar.querySelector("#genderFilter")?.setAttribute("aria-label", "Filter by gender");
}

function selectedTeacherSectionAssignment() {
  return teacherAssignmentOptions().find(({ key }) => key === LL.sectionAssignmentKey) || null;
}

function learnerQueryOptions(schoolYear, page = LL.page, pageSize = LL.pageSize) {
  const assignment = isTeacher() ? selectedTeacherSectionAssignment() : null;
  return {
    program: LL.program || LL.programFilter,
    search: LL.search,
    gradeLevel: assignment?.gradeLevel || LL.gradeLevel,
    section: assignment?.section || LL.section,
    gender: LL.gender,
    page,
    pageSize,
    schoolYear,
  };
}

function learnerSortValue(learner, field) {
  if (field === "name") {
    return String(learner.name || [learner.firstName, learner.middleName, learner.lastName].filter(Boolean).join(" ") || learner.learnerId || "");
  }
  if (field === "grade") return String(learner.gradeLevel || "");
  return String(learner.section || "");
}

export function sortLearners(items, sortBy) {
  if (sortBy === "grade-section") {
    return items.slice().sort((left, right) => {
      const leftGrade = learnerGradeSortValue(left.gradeLevel);
      const rightGrade = learnerGradeSortValue(right.gradeLevel);
      return leftGrade.rank - rightGrade.rank
        || leftGrade.label.localeCompare(rightGrade.label, undefined, { numeric: true, sensitivity: "base" })
        || String(left.section || "").localeCompare(String(right.section || ""), undefined, { numeric: true, sensitivity: "base" });
    });
  }
  const [field, direction] = String(sortBy || "name-asc").split("-");
  const descending = field === "date" ? direction === "newest" : direction === "desc";
  return items.slice().sort((left, right) => {
    let comparison;
    if (field === "date") {
      const leftDate = Date.parse(String(left.dateAdded || left.createdAt || left.addedAt || ""));
      const rightDate = Date.parse(String(right.dateAdded || right.createdAt || right.addedAt || ""));
      comparison = (Number.isNaN(leftDate) ? 0 : leftDate) - (Number.isNaN(rightDate) ? 0 : rightDate);
    } else if (field === "name") {
      comparison = compareLearnersBySurname(left, right);
    } else {
      comparison = learnerSortValue(left, field).localeCompare(learnerSortValue(right, field), undefined, {
        numeric: field === "grade" || field === "section",
        sensitivity: "base",
      });
    }
    return descending ? -comparison : comparison;
  });
}

function learnerGradeSortValue(value) {
  const grade = normalizeSectionGrade(value);
  if (grade === "kinder") return { rank: 0, label: "" };
  const match = grade.match(/^grade (\d+)$/);
  if (match) return { rank: Number(match[1]), label: "" };
  return { rank: Number.MAX_SAFE_INTEGER, label: grade };
}

export function filterLearnersByTeacherScope(learners, scope) {
  return learners.filter((learner) => scope.some((assignment) =>
    normalizeSectionGrade(assignment.gradeLevel) === normalizeSectionGrade(learner.gradeLevel)
    && String(assignment.section || "").trim().toLowerCase() === String(learner.section || "").trim().toLowerCase()
  ));
}

async function loadSortedLearnerPage(options, requestToken) {
  let result = await LPSApi.getLearners({ ...options, page: 1, pageSize: 100 });
  if (requestToken !== LL.loadToken) return null;
  const items = [...(result.items || [])];
  let page = 2;
  const pageSize = Math.max(1, Number(result.pageSize) || 100);
  while (items.length < Number(result.total || 0)) {
    if (requestToken !== LL.loadToken) return null;
    const next = await LPSApi.getLearners({ ...options, page, pageSize });
    if (!next.items?.length) {
      throw new Error("Unable to load all learners to apply the selected sort order.");
    }
    items.push(...next.items);
    page += 1;
  }
  const sorted = sortLearners(items, LL.sortBy);
  const start = (LL.page - 1) * LL.pageSize;
  return {
    items: sorted.slice(start, start + LL.pageSize),
    total: sorted.length,
    page: LL.page,
    pageSize: LL.pageSize,
  };
}

const LEARNER_VIEW_FIELDS = { search: 'searchInput', gradeLevel: 'gradeFilter', section: 'sectionFilter', sortBy: 'learnerSortFilter', gender: 'genderFilter', programFilter: 'programFilter' };
function learnerViewKey(year) { return `learners:${LL.program || 'masterlist'}:${year}`; }
function restoreLearnerView(year) {
  const saved = readRememberedView(learnerViewKey(year));
  LL.page = 1;
  LL.pageSize = currentUserPreferences().tablePageSize;
  for (const [key, id] of Object.entries(LEARNER_VIEW_FIELDS)) {
    LL[key] = saved[key] || (key === 'sortBy' ? 'name-asc' : '');
    const input = document.getElementById(id);
    if (input && key !== 'section') {
      input.value = LL[key];
      if (input instanceof HTMLSelectElement) LL[key] = input.value;
    }
  }
  if (isTeacher()) LL.gradeLevel = '';
  LL.sectionAssignmentKey = saved.sectionAssignmentKey || '';
}
function rememberLearnerView(year) {
  rememberView(learnerViewKey(year), Object.fromEntries([...Object.keys(LEARNER_VIEW_FIELDS), 'sectionAssignmentKey'].map(key => [key, String(LL[key] || '')])));
}

export async function initLearnerListPage({ program, activeNavKey, title }) {
  await loadLearnerYearGradeTerms(getSelectedSchoolYear());
  LL.program = program || "";
  LL.sortBy = "name-asc";
  LL.pageSize = currentUserPreferences().tablePageSize;
  renderShell(activeNavKey, title);
  ensureLearnerToolbarLayout();
  ensureLearnerInspectModal();
  applyTeacherLearnerScope();
  const addLearnerButton = document.getElementById("addLearnerBtn");
  if (addLearnerButton && !canManageLearners()) addLearnerButton.remove();
  if (canManageLearners()) ensureLearnerBulkControls();
  initYearSwitcher(async (year) => {
    restoreLearnerView(year);
    LL.sectionSchoolYear = year;
    subscribeLearnersLive(year);
    if (isSchoolAdmin()) {
      await loadSectionOptions(year);
      updateAdminSectionFilterOptions();
    } else if (isTeacher()) {
      ensureTeacherSectionFilter();
    }
    ensureLearnerSortFilter();
    const sortFilter = document.getElementById("learnerSortFilter");
    if (sortFilter) sortFilter.value = LL.sortBy;
    return loadLearners(year);
  });

  document.getElementById("searchInput").addEventListener("input", debounce((e) => {
    LL.search = e.target.value.trim();
    LL.page = 1;
    loadLearners();
  }, 300));

  const gradeFilterEl = document.getElementById("gradeFilter");
  if (gradeFilterEl) {
    gradeFilterEl.addEventListener("change", (e) => {
      LL.gradeLevel = e.target.value;
      if (isSchoolAdmin()) updateAdminSectionFilterOptions();
      LL.page = 1;
      loadLearners();
    });
  }

  if (isSchoolAdmin()) {
    ensureAdminSectionFilter();
    updateAdminSectionFilterOptions();
    document.getElementById("sectionFilter")?.addEventListener("change", (event) => {
      LL.section = event.target.value;
      LL.page = 1;
      loadLearners();
    });
  } else if (isTeacher()) {
    ensureTeacherSectionFilter();
  }
  ensureLearnerSortFilter();
  const sortFilter = document.getElementById("learnerSortFilter");
  if (sortFilter) {
    sortFilter.value = LL.sortBy;
    sortFilter.addEventListener("change", (event) => {
      LL.sortBy = event.target.value;
      LL.page = 1;
      loadLearners();
    });
  }

  const genderFilterEl = document.getElementById("genderFilter");
  if (genderFilterEl) {
    genderFilterEl.addEventListener("change", (e) => { LL.gender = e.target.value; LL.page = 1; loadLearners(); });
  }

  const programFilterEl = document.getElementById("programFilter");
  if (programFilterEl) {
    programFilterEl.addEventListener("change", (e) => { LL.programFilter = e.target.value; LL.page = 1; loadLearners(); });
  }

  if (canManageLearners()) wireModal();
  // NOTE: no extra initial loadLearners() call here — initYearSwitcher()
  // above already triggers the first load via its onChange callback (with
  // the correct resolved year, or "" if the Sheets API isn't configured /
  // no years exist). Calling loadLearners() again here used to fire a
  // second, unguarded request for the backend's "current" year that raced
  // against the year-switcher's own request; whichever one's response came
  // back last would win, so the table could end up showing the wrong
  // school year's data (or the wrong empty/non-empty state) depending on
  // network timing.
}

export function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

export async function loadLearners(schoolYear = getSelectedSchoolYear()) {
  const tbody = document.getElementById("learnersTableBody");
  const demoBanner = document.getElementById("demoBanner");
  LL.loadedSchoolYear = schoolYear;
  rememberLearnerView(schoolYear);
  LL.selectedIds.clear();
  updateLearnerBulkControls();
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="state-row">Loading learners…</td></tr>`;

  // Guard against out-of-order responses: if the user switches the school
  // year (or a filter) again before this request finishes, an older,
  // slower response must not overwrite the table with stale data once it
  // finally arrives.
  const requestToken = ++LL.loadToken;

  try {
    let result;
    if (!isVisitorSession() && typeof fsGetLearnerPage === "function" && schoolYear) {
      const options = learnerQueryOptions(schoolYear);
      result = await loadSortedLearnerPage(options, requestToken);
    } else if (isSheetsApiConfigured()) {
      const options = learnerQueryOptions(schoolYear);
      result = await loadSortedLearnerPage(options, requestToken);
    } else {
      if (demoBanner) demoBanner.style.display = "flex";
      result = filterDemoLearners();
    }
    if (!result) return;
    if (requestToken !== LL.loadToken) return; // a newer request superseded this one
    if (demoBanner && (isSheetsApiConfigured() || typeof fsGetLearnerPage === "function")) demoBanner.style.display = "none";
    const totalPages = Math.max(1, Math.ceil(Number(result.total || 0) / Number(result.pageSize || LL.pageSize)));
    if (Number(result.page || LL.page) > totalPages && Number(result.total || 0) > 0) {
      LL.page = totalPages;
      return loadLearners(schoolYear);
    }
    renderLearnersTable(result.items);
    renderPagination(result.total, result.page, result.pageSize);
  } catch (err) {
    if (requestToken !== LL.loadToken) return;
    if (demoBanner) {
      demoBanner.style.display = "flex";
      demoBanner.innerHTML = isSheetsApiConfigured()
        ? `<span>Unable to load live data for ${escapeHtml(schoolYear || "the selected school year")}: ${escapeHtml(err.message || "Please try again.")}</span><button class="btn btn-secondary" type="button" id="retryLearnersBtn">Try again</button>`
        : `<span>Showing sample data. Connect your Google Sheet to see live enrollment data.</span>`;
      const retryButton = document.getElementById("retryLearnersBtn");
      if (retryButton) retryButton.addEventListener("click", () => loadLearners(schoolYear));
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="state-row error">Couldn't load learners: ${escapeHtml(err.message)}</td></tr>`;
    }
    const pageInfo = document.getElementById("pageInfo");
    if (pageInfo) pageInfo.textContent = "—";
    const pagerBtns = document.getElementById("pagerBtns");
    if (pagerBtns) pagerBtns.innerHTML = "";
  }
}

export function filterDemoLearners() {
  let items = DEMO_LEARNERS.slice();
  const activeProgram = LL.program || LL.programFilter;
  if (activeProgram && PROGRAM_FIELD_MAP[activeProgram]) {
    items = items.filter((l) => l[PROGRAM_FIELD_MAP[activeProgram]]);
  }
  if (isTeacher()) {
    items = filterLearnersByTeacherScope(items, teacherLearnerScope());
    const assignment = selectedTeacherSectionAssignment();
    if (assignment) {
      items = items.filter((learner) =>
        normalizeSectionGrade(learner.gradeLevel) === normalizeSectionGrade(assignment.gradeLevel)
        && String(learner.section || "").trim().toLowerCase() === String(assignment.section).trim().toLowerCase()
      );
    }
  }
  if (LL.gradeLevel) items = items.filter((l) => l.gradeLevel === LL.gradeLevel);
  if (LL.section) items = items.filter((l) => String(l.section || "").trim().toLowerCase() === LL.section.toLowerCase());
  if (LL.gender) items = items.filter((l) => l.gender === LL.gender);
  if (LL.search) {
    const q = LL.search.toLowerCase();
    items = items.filter((l) =>
      `${l.firstName} ${l.lastName} ${l.learnerId}`.toLowerCase().includes(q)
    );
  }
  items = sortLearners(items, LL.sortBy);
  const total = items.length;
  const start = (LL.page - 1) * LL.pageSize;
  const pageItems = items.slice(start, start + LL.pageSize);
  return { items: pageItems, total, page: LL.page, pageSize: LL.pageSize };
}

function formatLearnerDetailValue(key, value) {
  if (value === null || value === undefined) return "";
  if (key === 'sf10Email') return sf10EmailDetails(value).join(' · ') || 'No email details recorded';
  if (key === "gradesByTerm" && typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value && typeof value === "object") {
    if (key === "gradesByTerm") {
      const gradeEntries = Object.entries(value)
        .filter(([, termGrades]) => termGrades && typeof termGrades === "object" && !Array.isArray(termGrades))
        .map(([termKey, termGrades]) => {
          const termLabel = GRADE_TERMS.find(({ id }) => id === termKey)?.label || humanizeHeader(termKey);
          const subjectGrades = Object.entries(termGrades)
            .filter(([, grade]) => grade !== null && grade !== undefined && grade !== "")
            .map(([subjectKey, grade]) => `${learnerDetailLabel(subjectKey)}: ${String(grade)}`);
          return subjectGrades.length ? `${termLabel}: ${subjectGrades.join(" • ")}` : null;
        })
        .filter(Boolean);
      return gradeEntries.length ? gradeEntries.join("; ") : "No academic grades recorded.";
    }

    const objectEntries = Object.entries(value)
      .filter(([, objectValue]) => objectValue !== null && objectValue !== undefined && objectValue !== "")
      .map(([objectKey, objectValue]) => `${learnerDetailLabel(objectKey) || humanizeHeader(objectKey)}: ${formatLearnerDetailValue(objectKey, objectValue)}`);
    return objectEntries.length ? objectEntries.join("; ") : "No recorded details";
  }
  return String(value);
}

function learnerGradeTerms(learner) {
  let value = learner?.gradesByTerm;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const normalizedLearner = { ...learner, gradesByTerm: value };
  const finalGrades = gradesForTerm(normalizedLearner, FINAL_GRADE_TERM, CURRICULUM_SUBJECTS.map(({ id }) => id));
  const terms = Object.entries(value);
  if (Object.keys(finalGrades).length && !terms.some(([termId]) => termId === FINAL_GRADE_TERM)) {
    terms.push([FINAL_GRADE_TERM, finalGrades]);
  }
  return terms
    .filter(([, subjects]) => subjects && typeof subjects === "object" && !Array.isArray(subjects))
    .map(([termId, subjects]) => ({
      termId,
      label: GRADE_TERMS.find(({ id }) => id === termId)?.label || humanizeHeader(termId),
      subjects: Object.entries(termId === FINAL_GRADE_TERM ? finalGrades : subjects)
        .filter(([, grade]) => grade !== null && grade !== undefined && grade !== "")
        .map(([subjectId, grade]) => ({ label: learnerDetailLabel(subjectId), grade: String(grade) })),
    }))
    .filter(({ subjects }) => subjects.length);
}

export function buildLearnerDetailSections(learner = {}) {
  const values = { ...learner };
  const extras = values.extra && typeof values.extra === "object" && !Array.isArray(values.extra)
    ? values.extra
    : {};
  delete values.extra;
  Object.entries(extras).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) values[key] = value;
  });

  const entries = Object.entries(values)
    .filter(([key, value]) => key && !key.startsWith("__") && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({
      key,
      label: learnerDetailLabel(key),
      value: formatLearnerDetailValue(key, value),
    }));

  const assigned = new Set();
  const sections = LEARNER_DETAIL_GROUPS.map(({ title, matches }) => {
    const fields = entries.filter(({ key }) => matches(key));
    fields.forEach(({ key }) => assigned.add(key));
    return { title, fields };
  }).filter(({ fields }) => fields.length);
  const additionalFields = entries.filter(({ key }) => !assigned.has(key));
  if (additionalFields.length) sections.push({ title: "Additional information", fields: additionalFields });
  return sections;
}

export function learnerDetailLabel(key) {
  return LEARNER_DETAIL_LABELS[key] || humanizeHeader(key)
    .replace(/\bBosy\b/gi, "BOSY")
    .replace(/\bMosy\b/gi, "MOSY")
    .replace(/\bEosy\b/gi, "EOSY")
    .replace(/\bCrla\b/gi, "CRLA")
    .replace(/\bPhil Iri\b/gi, "Phil-IRI")
    .replace(/\bLrn\b/gi, "LRN");
}

export function renderLearnerDetailSections(learner = {}) {
  const sections = buildLearnerDetailSections(learner);
  if (!sections.length) {
    return `<div class="learner-inspect-empty">No learner details have been recorded.</div>`;
  }
  const gradeTerms = learnerGradeTerms(learner);
  const hasGradeTerms = gradeTerms.length > 0;
  return sections.map(({ title, fields }) => {
    const regularFields = title === "Academic grades"
      ? (hasGradeTerms
        ? fields.filter(({ key }) => key !== "gradesByTerm" && !CURRICULUM_SUBJECT_IDS.has(key))
        : fields)
      : fields.filter(({ key }) => key !== "gradesByTerm");
    const fieldsMarkup = regularFields.length ? `
      <dl>${regularFields.map(({ label, value }) => `
        <div class="learner-inspect-field">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>`).join("")}
      </dl>` : "";
    const gradesMarkup = title === "Academic grades" ? (hasGradeTerms ? `
      <div class="learner-inspect-grade-terms">
        ${gradeTerms.map(({ termId, label, subjects }) => `
          <section class="learner-inspect-grade-term" aria-label="${escapeHtml(label)} grades">
            <header class="learner-inspect-grade-term-header">
              <div><span class="learner-inspect-grade-term-label">Grade term</span><h5>${escapeHtml(label)}</h5></div>
              <span class="learner-inspect-grade-count">${subjects.length} ${subjects.length === 1 ? "subject" : "subjects"}</span>
            </header>
            <dl class="learner-inspect-grade-list">
              ${subjects.map(({ label: subject, grade }) => `
                <div class="learner-inspect-grade-row">
                  <dt>${escapeHtml(subject)}</dt>
                  <dd>${escapeHtml(grade)}</dd>
                </div>`).join("")}
            </dl>
          </section>`).join("")}
      </div>` : "") : "";
    if (!fieldsMarkup && !gradesMarkup) return "";
    return `
      <section class="learner-inspect-section${title === "Academic grades" ? " learner-inspect-section-grades" : ""}">
        <h4>${escapeHtml(title)}</h4>
        ${gradesMarkup}
        ${fieldsMarkup}
      </section>`;
  }).join("");
}

let learnerInspectRequestToken = 0;

export function ensureLearnerInspectModal() {
  if (document.getElementById("learnerInspectBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="learner-inspect-backdrop" id="learnerInspectBackdrop" aria-hidden="true">
      <section class="learner-inspect-dialog" role="dialog" aria-modal="true" aria-labelledby="learnerInspectName" aria-describedby="learnerInspectSubtitle" tabindex="-1">
        <header class="learner-inspect-header">
          <div class="learner-inspect-heading">
            <span class="learner-inspect-avatar" id="learnerInspectAvatar" aria-hidden="true"></span>
            <div class="learner-inspect-title">
              <span class="learner-inspect-eyebrow">Learner record</span>
              <h2 id="learnerInspectName">Learner details</h2>
              <p id="learnerInspectSubtitle">Complete student information</p>
            </div>
          </div>
          <button type="button" class="learner-inspect-close" id="learnerInspectClose" aria-label="Close learner details">${Icon.x}</button>
        </header>
        <div class="learner-inspect-content" id="learnerInspectContent" aria-live="polite"></div>
        <footer class="learner-inspect-footer">
          <span>Details are shown in read-only mode.</span>
          <button type="button" class="btn btn-secondary" id="learnerInspectDone">Close</button>
        </footer>
      </section>
    </div>`);

  const backdrop = document.getElementById("learnerInspectBackdrop");
  const close = () => closeLearnerInspectModal();
  document.getElementById("learnerInspectClose").addEventListener("click", close);
  document.getElementById("learnerInspectDone").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  document.addEventListener("keydown", (event) => {
    if (!backdrop.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...backdrop.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function closeLearnerInspectModal() {
  const backdrop = document.getElementById("learnerInspectBackdrop");
  if (!backdrop) return;
  learnerInspectRequestToken += 1;
  backdrop.classList.remove("is-open");
  backdrop.setAttribute("aria-hidden", "true");
  inspectReturnFocus?.focus();
  inspectReturnFocus = null;
}

export async function openLearnerInspectModal(learnerId, rowLearner = {}) {
  const backdrop = document.getElementById("learnerInspectBackdrop");
  if (!backdrop) return;
  const token = ++learnerInspectRequestToken;
  inspectReturnFocus = document.activeElement;
  backdrop.classList.add("is-open");
  backdrop.setAttribute("aria-hidden", "false");
  document.getElementById("learnerInspectName").textContent = formatLearnerName(rowLearner, "Learner details");
  document.getElementById("learnerInspectSubtitle").textContent = `LRN ${learnerId} · ${LL.loadedSchoolYear || getSelectedSchoolYear() || "School year not specified"}`;
  document.getElementById("learnerInspectAvatar").textContent = `${String(rowLearner.firstName || "").trim().charAt(0)}${String(rowLearner.lastName || "").trim().charAt(0)}`.toUpperCase() || "L";
  const content = document.getElementById("learnerInspectContent");
  content.innerHTML = `<div class="learner-inspect-loading"><span class="inline-spinner" aria-hidden="true"></span><span>Loading complete learner record…</span></div>`;
  document.getElementById("learnerInspectClose").focus();

  try {
    let learner = rowLearner;
    const schoolYear = getSelectedSchoolYear();
    if (!isVisitorSession() && schoolYear && (isSheetsApiConfigured() || typeof fsGetLearner === "function")) {
      const fullRecord = await LPSApi.getLearner(learnerId, schoolYear);
      if (!fullRecord) throw new Error("The learner record was not found for the selected school year.");
      learner = { ...rowLearner, ...fullRecord };
    }
    if (token !== learnerInspectRequestToken || !backdrop.classList.contains("is-open")) return;
    document.getElementById("learnerInspectName").textContent = formatLearnerName(learner, "Learner details");
    document.getElementById("learnerInspectSubtitle").textContent = `LRN ${learner.learnerId || learnerId} · ${learner.gradeLevel || "Grade not specified"}${learner.section ? ` · Section ${learner.section}` : ""} · ${LL.loadedSchoolYear || schoolYear || "School year not specified"}`;
    document.getElementById("learnerInspectAvatar").textContent = `${String(learner.firstName || learner.name || "").trim().charAt(0)}${String(learner.lastName || "").trim().charAt(0)}`.toUpperCase() || "L";
    content.innerHTML = renderLearnerDetailSections(learner);
  } catch (error) {
    if (token !== learnerInspectRequestToken || !backdrop.classList.contains("is-open")) return;
    content.innerHTML = `<div class="learner-inspect-error"><strong>Unable to load the complete learner record.</strong><span>${escapeHtml(error.message || "Please try again.")}</span></div>${renderLearnerDetailSections(rowLearner)}`;
  }
}

export function renderLearnersTable(items) {
  const tbody = document.getElementById("learnersTableBody");
  const hasManagementColumn = canManageLearners();
  const inspectLearner = storedAppProfile()?.teacherPrefs?.inspectLearner !== false;
  const columnCount = (hasManagementColumn ? 11 : 10) - currentUserPreferences().hiddenLearnerColumns.length;
  const table = tbody.closest('table');
  const columns = ['learnerId', 'name', 'birthDate', 'age', 'grade', 'gender', 'guardian', 'programs', 'dateAdded', 'actions'];
  table?.querySelectorAll('thead tr').forEach(row => [...row.children].forEach((cell, index) => {
    const key = columns[index - (hasManagementColumn ? 1 : 0)];
    if (key) cell.setAttribute('data-learner-column', key);
  }));
  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columnCount}" class="state-row">No learners match your search or filters.</td></tr>`;
    updateLearnerBulkControls();
    return;
  }
  tbody.innerHTML = items.map((l) => `
    <tr>
      ${hasManagementColumn ? `<td><input class="row-select learner-select" type="checkbox" value="${escapeHtml(l.learnerId)}" aria-label="Select ${escapeHtml(l.firstName)} ${escapeHtml(l.lastName)}" /></td>` : ""}
      <td>${escapeHtml(l.learnerId)}</td>
      <td class="cell-name">${escapeHtml(l.lastName)}, ${escapeHtml([l.firstName, l.middleName, l.suffix].filter(Boolean).join(" "))}${l.enrollmentStatus === "TRANSFERRED_OUT" || l.transferOut ? ' <span class="badge badge-transfer-out">Transferred out</span>' : ""}</td>
      <td>${escapeHtml(l.birthDate || "—")}</td>
      <td>${escapeHtml(l.age === "" || l.age == null ? "—" : l.age)}</td>
      <td>${escapeHtml(l.gradeLevel)} - ${escapeHtml(l.section)}</td>
      <td>${escapeHtml(l.gender || "—")}</td>
      <td>${escapeHtml(sentenceCaseName(l.guardian)) || "—"}</td>
      <td>${programBadges(l)}</td>
      <td>${escapeHtml(formatAppDate(l.dateAdded))}</td>
      <td>
        <div class="row-actions">
          ${inspectLearner ? `<button class="icon-btn inspect-learner-btn" type="button" title="Inspect learner" aria-label="Inspect ${escapeHtml(l.firstName)} ${escapeHtml(l.lastName)}" data-inspect="${escapeHtml(l.learnerId)}">${Icon.eye}</button>` : ""}
          ${canManageLearners() ? `<button class="icon-btn" title="Edit" data-edit="${escapeHtml(l.learnerId)}">${Icon.edit}</button><button class="icon-btn danger" title="Remove" data-delete="${escapeHtml(l.learnerId)}" data-name="${escapeHtml(l.firstName)} ${escapeHtml(l.lastName)}">${Icon.trash}</button>` : ""}
        </div>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll('tr').forEach(row => [...row.children].forEach((cell, index) => {
    const key = columns[index - (hasManagementColumn ? 1 : 0)];
    if (key) cell.setAttribute('data-learner-column', key);
  }));
  tbody.querySelectorAll(".learner-select").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) LL.selectedIds.add(checkbox.value);
    else LL.selectedIds.delete(checkbox.value);
    updateLearnerBulkControls();
  }));
  tbody.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEditModal(btn.getAttribute("data-edit")).catch((error) => {
      document.getElementById("learnerModalBackdrop")?.classList.remove("is-open");
      setLearnerModalLoading(false);
      learnerModalBusy = false;
      showToast(error.message || "Unable to load learner.", "error");
    })));
  tbody.querySelectorAll("[data-inspect]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const learner = items.find((item) => String(item.learnerId) === btn.getAttribute("data-inspect"));
      openLearnerInspectModal(btn.getAttribute("data-inspect"), learner || {}).catch((error) => {
        showToast(error.message || "Unable to inspect learner.", "error");
      });
    }));
  tbody.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => openDeleteModal(btn.getAttribute("data-delete"), btn.getAttribute("data-name"))));
  updateLearnerBulkControls();
}

export function ensureLearnerBulkControls() {
  const table = document.querySelector("#learnersTableBody")?.closest("table");
  if (!table || document.getElementById("learnerBulkToolbar")) return;
  const toolbar = document.createElement("div");
  toolbar.id = "learnerBulkToolbar";
  toolbar.className = "bulk-toolbar";
  toolbar.innerHTML = `<span class="bulk-selection-count">No learners selected</span><button class="btn btn-danger-outline" id="deleteSelectedLearnersBtn" type="button" disabled>Remove selected</button>`;
  table.parentElement.parentElement.insertBefore(toolbar, table.parentElement);
  table.querySelector("thead tr").insertAdjacentHTML("afterbegin", `<th class="select-column"><input id="selectAllLearners" class="row-select" type="checkbox" aria-label="Select all visible learners" /></th>`);
  document.getElementById("selectAllLearners").addEventListener("change", (event) => {
    table.querySelectorAll(".learner-select").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
      if (checkbox.checked) LL.selectedIds.add(checkbox.value);
      else LL.selectedIds.delete(checkbox.value);
    });
    updateLearnerBulkControls();
  });
  document.getElementById("deleteSelectedLearnersBtn").addEventListener("click", () => {
    const selected = [...LL.selectedIds];
    if (selected.length) openDeleteModal(selected, `${selected.length} selected learners`);
  });
}

export function updateLearnerBulkControls() {
  const count = LL.selectedIds.size;
  const countEl = document.querySelector("#learnerBulkToolbar .bulk-selection-count");
  const deleteBtn = document.getElementById("deleteSelectedLearnersBtn");
  const selectAll = document.getElementById("selectAllLearners");
  const visible = document.querySelectorAll(".learner-select");
  if (countEl) countEl.textContent = count ? `${count} learner${count === 1 ? "" : "s"} selected` : "No learners selected";
  if (deleteBtn) deleteBtn.disabled = count === 0;
  if (selectAll) {
    selectAll.checked = visible.length > 0 && [...visible].every((checkbox) => checkbox.checked);
    selectAll.indeterminate = count > 0 && !selectAll.checked;
  }
}

export function renderPagination(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const infoEl = document.getElementById("pageInfo");
  const startN = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endN = Math.min(page * pageSize, total);
  infoEl.textContent = `Showing ${startN}–${endN} of ${total} learners`;

  const btns = document.getElementById("pagerBtns");
  let html = `<button ${page <= 1 ? "disabled" : ""} data-page="${page - 1}">‹</button>`;
  paginationPageNumbers(page, totalPages).forEach((p) => {
    html += `<button class="${p === page ? "is-active" : ""}" data-page="${p}">${p}</button>`;
  });
  html += `<button ${page >= totalPages ? "disabled" : ""} data-page="${page + 1}">›</button>`;
  btns.innerHTML = html;
  btns.querySelectorAll("button[data-page]").forEach((b) =>
    b.addEventListener("click", () => { LL.page = Number(b.getAttribute("data-page")); loadLearners(); }));
}

/* ---- Add / edit modal ---------------------------------------------------- */
export function wireLearnerArrowNavigation(form) {
  if (!form || form.dataset.arrowNavigationWired === "true") return;
  form.dataset.arrowNavigationWired = "true";
  form.addEventListener("keydown", (event) => {
    if (!(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))) return;
    const target = event.target;
    if (!target || !["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    if (target.tagName === "TEXTAREA" && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
    const controls = [...form.querySelectorAll("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")]
      .filter((control) => control.offsetParent !== null);
    const index = controls.indexOf(target);
    if (index < 0) return;
    const columns = Math.max(1, Math.round(Math.sqrt(controls.length)));
    const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
    const next = controls[index + offset];
    if (!next) return;
    event.preventDefault();
    next.focus();
    if (typeof next.select === "function" && next.tagName === "INPUT") next.select();
  });
}

export function wireModal() {
  const backdrop = document.getElementById("learnerModalBackdrop");
  const addBtn = document.getElementById("addLearnerBtn");
  const closeBtn = document.getElementById("learnerModalClose");
  const cancelBtn = document.getElementById("learnerModalCancel");
  const form = document.getElementById("learnerForm");
  const modalTitle = document.getElementById("learnerModalTitle");

  if (modalTitle && !document.getElementById("learnerModalStatus")) {
    const status = document.createElement("span");
    status.id = "learnerModalStatus";
    status.className = "modal-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    modalTitle.parentElement.appendChild(status);
  }

  ensureNutritionInputs();
  updateNutritionPeriodLabels();
  ensureIdentityInputs();
  ensureSuffixInputs();
  ensureReadingInputs();
  ensureMathInputs();
  ensureSubjectInputs();
  ensureTransferInputs();
  ensureLearnerStatusInputs();
  ensureAnecdotalRecordsInput(form);
  ensureSectionInput();
  wireGuardianContactFields();
  normalizeHeightInputs();
  const learnerIdInput = document.getElementById("f_learnerId");
  if (learnerIdInput) {
    learnerIdInput.required = true;
    learnerIdInput.setAttribute("aria-required", "true");
    learnerIdInput.placeholder = "123456789012";
  }
  const genderInput = document.getElementById("f_gender");
  if (genderInput) {
    genderInput.required = true;
    genderInput.setAttribute("aria-required", "true");
  }
  const middleNameInput = document.getElementById("f_middleName");
  if (middleNameInput) middleNameInput.required = false;
  ["f_firstName", "f_middleName", "f_lastName", "f_guardian"].forEach((id) => {
    document.getElementById(id)?.addEventListener("blur", (event) => { event.target.value = sentenceCaseName(event.target.value); });
  });

  if (addBtn) addBtn.addEventListener("click", () => { if (!learnerModalBusy) openAddModal(); });
  [closeBtn, cancelBtn].forEach((b) => b && b.addEventListener("click", () => closeModal()));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

  form.addEventListener("submit", handleLearnerFormSubmit);
  form.addEventListener("change", (event) => {
    if (event.target?.id !== "f_gradeTerm") return;
    const nextTerm = event.target.value;
    const activeValues = collectSubjectGradeValues();
    LL.editingLearnerOriginal = applyAutomaticFinalGrades({
      ...LL.editingLearnerOriginal,
      ...mergeGradesForTerm(LL.editingLearnerOriginal, LL.gradeTerm, activeValues, LL.activeSubjectIds),
    });
    LL.gradeTerm = nextTerm;
    renderLearnerTermGrades(nextTerm);
  });
  document.getElementById("f_gradeLevel").addEventListener("change", updateReadingReferenceVisibility);
  document.getElementById("f_suffix")?.addEventListener("change", updateSuffixVisibility);
  document.getElementById("f_gradeLevel").addEventListener("change", updateSectionOptions);
  document.getElementById("f_gradeLevel").addEventListener("change", () => { void updateSubjectInputVisibility(getSelectedSchoolYear(), true); });
  document.getElementById("f_section").addEventListener("input", validateSectionInput);
  const transferTypeInput = document.getElementById("f_transferType");
  if (transferTypeInput) transferTypeInput.addEventListener("change", updateTransferVisibility);
  document.getElementById("f_birthDate")?.addEventListener("input", updateLearnerAge);
  document.getElementById("f_teacherAssignment")?.addEventListener("change", () => {
    const assignmentSelect = document.getElementById("f_teacherAssignment");
    const assignment = teacherAssignmentOptions().find((item) => item.key === assignmentSelect?.value);
    if (!assignment) return;
    if (document.getElementById("f_gradeLevel")) document.getElementById("f_gradeLevel").value = assignment.gradeLevel;
    if (document.getElementById("f_section")) document.getElementById("f_section").value = assignment.section;
    validateSectionInput();
    void updateSubjectInputVisibility(getSelectedSchoolYear(), true);
  });
  wireLearnerArrowNavigation(form);
  organizeLearnerForm(form);

  // Delete modal
  const delBackdrop = document.getElementById("deleteModalBackdrop");
  document.getElementById("deleteModalCancel").addEventListener("click", closeDeleteModal);
  delBackdrop.addEventListener("click", (e) => { if (e.target === delBackdrop) closeDeleteModal(); });
  document.getElementById("deleteModalConfirm").addEventListener("click", confirmDelete);
}

export async function openAddModal() {
  if (learnerModalBusy || document.getElementById("learnerModalBackdrop").classList.contains("is-open")) return;
  learnerModalBusy = true;
  LL.editingId = null;
  LL.editingLearnerOriginal = {};
  LL.gradeTerm = DEFAULT_GRADE_TERM;
  document.getElementById("learnerModalTitle").textContent = "Add Learner";
  document.getElementById("learnerForm").reset();
  renderDocumentStatusFields(document.getElementById("learnerForm"), {}, 'learner');
  updateSuffixVisibility();
  LL.gradeTerm = DEFAULT_GRADE_TERM;
    applyTeacherLearnerScope();
  const learnerIdInput = document.getElementById("f_learnerId");
  learnerIdInput.readOnly = false;
  learnerIdInput.value = "";
  learnerIdInput.maxLength = 12;
  learnerIdInput.pattern = "[0-9]{12}";
  learnerIdInput.inputMode = "numeric";
  learnerIdInput.placeholder = "123456789012";
  if (PROGRAM_FIELD_MAP[LL.program]) {
    document.getElementById("f_" + PROGRAM_FIELD_MAP[LL.program]).checked = true;
  }
  updateReadingReferenceVisibility();
  updateTransferVisibility();
  document.getElementById("learnerModalBackdrop").classList.add("is-open");
  setLearnerModalLoading(true, "Preparing fields");

  const schoolYear = getSelectedSchoolYear();
  LL.sectionSchoolYear = schoolYear;
  const metadataTasks = [
    loadLearnerCardFields(document.getElementById("learnerForm"), {}, fsGetCardPrintingPreferences),
    loadSectionOptions(schoolYear).then(updateSectionOptions),
    renderExtraFieldInputs({}),
    updateSubjectInputVisibility(schoolYear),
  ];
  await Promise.all(metadataTasks);
  organizeLearnerForm(document.getElementById("learnerForm"));
  renderLearnerTermGrades(LL.gradeTerm);
  learnerFormInitialSnapshot = formSnapshot(document.getElementById("learnerForm"));
  setLearnerModalLoading(false);
  learnerModalBusy = false;
}

export async function openEditModal(learnerId) {
  if (learnerModalBusy || document.getElementById("learnerModalBackdrop").classList.contains("is-open")) return;
  learnerModalBusy = true;
  const backdrop = document.getElementById("learnerModalBackdrop");
  LL.sectionSchoolYear = getSelectedSchoolYear();
  applyTeacherLearnerScope();
  document.getElementById("learnerModalTitle").textContent = "Loading Learner…";
  document.getElementById("learnerForm").reset();
  LL.gradeTerm = DEFAULT_GRADE_TERM;
  backdrop.classList.add("is-open");
  setLearnerModalLoading(true, "Loading learner");
  let learner;
  try {
    if (!isVisitorSession() && typeof fsGetLearner === "function" && getSelectedSchoolYear()) {
      const learnerRequest = LPSApi.getLearner(learnerId, getSelectedSchoolYear());
      const sectionRequest = loadSectionOptions(LL.sectionSchoolYear);
      const schemaRequest = renderExtraFieldInputs({});
      [learner] = await Promise.all([learnerRequest, sectionRequest, schemaRequest]);
    } else if (isSheetsApiConfigured()) {
      const learnerRequest = LPSApi.getLearner(learnerId, getSelectedSchoolYear());
      const sectionRequest = loadSectionOptions(LL.sectionSchoolYear);
      const schemaRequest = renderExtraFieldInputs({});
      [learner] = await Promise.all([learnerRequest, sectionRequest, schemaRequest]);
    } else {
      learner = DEMO_LEARNERS.find((l) => l.learnerId === learnerId);
    }
  } catch (err) {
    backdrop.classList.remove("is-open");
    setLearnerModalLoading(false);
    learnerModalBusy = false;
    showToast(err.message, "error");
    return;
  }
  if (!learner) {
    backdrop.classList.remove("is-open");
    setLearnerModalLoading(false);
    learnerModalBusy = false;
    return;
  }

  LL.editingId = learnerId;
  LL.editingLearnerOriginal = learner;
  const cardFieldsRequest = loadLearnerCardFields(document.getElementById("learnerForm"), learner, fsGetCardPrintingPreferences);
  LL.gradeTerm = learner.gradesByTerm ? DEFAULT_GRADE_TERM : FINAL_GRADE_TERM;
  const gradeTermSelect = document.getElementById("f_gradeTerm");
  if (gradeTermSelect) gradeTermSelect.value = LL.gradeTerm;
  document.getElementById("learnerModalTitle").textContent = "Edit Learner";
  const learnerIdInput = document.getElementById("f_learnerId");
  learnerIdInput.value = learner.learnerId || learnerId;
  learnerIdInput.maxLength = 12;
  learnerIdInput.pattern = "[0-9]{12}";
  learnerIdInput.inputMode = "numeric";
  learnerIdInput.readOnly = false;
  document.getElementById("f_firstName").value = learner.firstName || "";
  setLearnerFieldValue("f_middleName", learner.middleName);
  document.getElementById("f_lastName").value = learner.lastName || "";
  setLearnerFieldValue("f_suffix", ["Jr.", "II", "III"].includes(learner.suffix) ? learner.suffix : learner.suffix ? "custom" : "");
  setLearnerFieldValue("f_customSuffix", ["Jr.", "II", "III"].includes(learner.suffix) ? "" : learner.suffix);
  updateSuffixVisibility();
  setLearnerFieldValue("f_birthDate", learner.birthDate);
  setLearnerFieldValue("f_age", learner.age);
  document.getElementById("f_gradeLevel").value = learner.gradeLevel || "";
  const assignmentSelect = document.getElementById("f_teacherAssignment");
  if (assignmentSelect && teacherLearnerScope().length > 1) {
    const assignmentValue = teacherAssignmentOptions().find((assignment) =>
      normalizeSectionGrade(assignment.gradeLevel) === normalizeSectionGrade(learner.gradeLevel)
      && String(assignment.section).trim().toLowerCase() === String(learner.section || "").trim().toLowerCase()
    )?.key;
    if (assignmentValue) assignmentSelect.value = assignmentValue;
  }
  updateReadingReferenceVisibility();
  await loadSectionOptions(getSelectedSchoolYear());
  updateSectionOptions();
  const transferType = learner.transferType || (learner.transferIn ? "Transfer In" : (learner.transferOut ? "Transfer Out" : ""));
  setLearnerFieldValue("f_transferType", transferType);
  setLearnerFieldValue("f_transferSchool", learner.transferSchool);
  loadTransferSchoolInputs(document.getElementById('learnerForm'), learner);
  setLearnerFieldValue("f_transferDate", learner.transferDate);
  setLearnerFieldValue("f_transferReason", learner.transferReason);
  renderDocumentStatusFields(document.getElementById("learnerForm"), learner, 'learner');
  setLearnerFieldValue("f_anecdotalRecords", learner.anecdotalRecords);
  updateTransferVisibility();
  updateLearnerAge();
  document.getElementById("f_section").value = learner.section || "";
  validateSectionInput();
  setLearnerFieldValue("f_gender", learner.gender);
  setLearnerFieldValue("f_enrollmentStatus", ["INACTIVE", "TRANSFERRED_OUT", "DROPPED_OUT"].includes(String(learner.enrollmentStatus || '').toUpperCase()) || learner.transferOut ? "INACTIVE" : "ACTIVE");
  setLearnerFieldValue("f_eosyStatus", learner.eosyStatus);
  ["bosyHeight", "bosyWeight", "mosyHeight", "mosyWeight", "eosyHeight", "eosyWeight"].forEach((field) => {
    const value = field.endsWith("Height") && learner[field] !== "" && learner[field] != null
      ? Number(learner[field]) / 100 : learner[field];
    setLearnerFieldValue("f_" + field, value);
  });
  ["bosyNutritionalStatus", "mosyNutritionalStatus", "eosyNutritionalStatus"].forEach((field) => {
    setLearnerFieldValue("f_" + field, learner[field]);
  });
  setLearnerFieldValue("f_guardian", sentenceCaseName(learner.guardian));
  setLearnerFieldValue("f_contact", learner.contact);
  setLearnerFieldChecked("f_is4Ps", learner.is4Ps);
  setLearnerFieldChecked("f_isIP", learner.isIP);
  setLearnerFieldChecked("f_isSNED", learner.isSNED);
  setLearnerFieldChecked("f_isARAL", learner.isARAL);
  setLearnerFieldChecked("f_isMuslim", learner.isMuslim);
  ["filipino", "english", "math", "science", "aralPan", "esp", "music", "arts", "pe", "health", "epp", "motherTongue"]
    .forEach((field) => { setLearnerFieldValue("f_" + field, learner[field]); });
  ["bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"].forEach((field) => {
    const input = document.getElementById("f_" + field);
    if (input) input.value = learner[field] || "";
  });
  ["bosyRMA", "mosyRMA", "eosyRMA"].forEach((field) => {
    const input = document.getElementById("f_" + field);
    if (input) input.value = learner[field] || "";
  });
  await renderExtraFieldInputs(learner.extra || {});
  await updateSubjectInputVisibility(LL.sectionSchoolYear, true);
  await cardFieldsRequest;
  organizeLearnerForm(document.getElementById("learnerForm"));
  renderLearnerTermGrades(LL.gradeTerm);
  learnerFormInitialSnapshot = formSnapshot(document.getElementById("learnerForm"));
  setLearnerModalLoading(false);
  learnerModalBusy = false;
}

export function setLearnerModalLoading(isLoading, message = "") {
  const status = document.getElementById("learnerModalStatus");
  if (!status) return;
  status.innerHTML = isLoading ? `<span class="inline-spinner" aria-hidden="true"></span>${escapeHtml(message)}` : "";
  status.hidden = !isLoading;
}

export function getLearnerFieldValue(id) {
  return document.getElementById(id)?.value || "";
}

export function sentenceCaseName(value) {
  if (normalizeNotAvailableInput(value) === "N/A") return "N/A";
  const text = String(value || "").trim().toLowerCase();
  return text.replace(/(^|[\s.'])([a-zñ])/giu, (_, prefix, letter) => prefix + letter.toUpperCase());
}

export function normalizeNotAvailableInput(value) {
  return /^\s*n\s*\/\s*a\s*$/i.test(String(value || "")) ? "N/A" : value;
}

export function wireGuardianContactFields() {
  ["f_guardian", "f_contact"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    if (input.dataset.notAvailableWired !== "true") {
      input.addEventListener("input", () => {
        input.value = normalizeNotAvailableInput(input.value);
      });
      input.dataset.notAvailableWired = "true";
    }
    const field = input.closest(".field");
    if (field && !field.querySelector(".not-available-hint")) {
      const hint = document.createElement("small");
      hint.className = "field-hint not-available-hint";
      hint.textContent = "N/A if not available";
      input.insertAdjacentElement("afterend", hint);
    }
  });
}

export function ensureSuffixInputs() {
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid || document.getElementById("f_suffix")) return;
  const markup = `
    <div class="field"><label for="f_suffix">Suffix</label><select id="f_suffix"><option value="">None</option><option value="Jr.">Jr.</option><option value="II">II</option><option value="III">III</option><option value="custom">Please specify…</option></select></div>
    <div class="field" id="f_customSuffixWrap" hidden><label for="f_customSuffix">Please specify suffix</label><input id="f_customSuffix" maxlength="32" autocomplete="off" /></div>`;
  const lastNameField = document.getElementById("f_lastName")?.closest(".field");
  if (lastNameField) lastNameField.insertAdjacentHTML("afterend", markup);
  else formGrid.insertAdjacentHTML("beforeend", markup);
}

export function updateNutritionPeriodLabels() {
  const labels = { f_bosyHeight: "Baseline nutrition", f_mosyHeight: "Midline nutrition", f_eosyHeight: "Endline nutrition" };
  Object.entries(labels).forEach(([inputId, labelText]) => {
    const label = document.getElementById(inputId)?.closest(".nutrition-input-group")?.querySelector("label");
    if (label?.firstChild) label.firstChild.textContent = `${labelText} `;
  });
}

export function updateSuffixVisibility() {
  const select = document.getElementById("f_suffix");
  const wrapper = document.getElementById("f_customSuffixWrap");
  const customInput = document.getElementById("f_customSuffix");
  if (!select || !wrapper || !customInput) return;
  const isCustom = select.value === "custom";
  wrapper.hidden = !isCustom;
  customInput.required = isCustom;
  if (!isCustom) customInput.value = "";
}

export function setLearnerFieldValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || "";
}

export function setLearnerFieldChecked(id, checked) {
  const field = document.getElementById(id);
  if (field) field.checked = !!checked;
}

export function getHeightInCentimeters(id) {
  const value = Number(getLearnerFieldValue(id));
  return Number.isFinite(value) && value > 0 ? String(Math.round(value * 1000) / 10) : "";
}

export function closeModal(force = false) {
  if (!force && (learnerModalBusy || learnerMutationBusy)) return;
  if (!force && !confirmDiscardChanges(document.getElementById("learnerForm"), learnerFormInitialSnapshot, "learner form")) return;
  learnerModalBusy = false;
  document.getElementById("learnerModalBackdrop").classList.remove("is-open");
  learnerFormInitialSnapshot = "";
}

export async function handleLearnerFormSubmit(e) {
  e.preventDefault();
  if (learnerMutationBusy) return;
  const selectedGrade = normalizeCurriculumGrade(document.getElementById("f_gradeLevel")?.value);
  const selectedYear = String(getSelectedSchoolYear() || "").trim();
  if (LL.subjectConfigGrade !== selectedGrade || LL.subjectConfigYear !== selectedYear) {
    await updateSubjectInputVisibility(selectedYear);
    showToast("Subject fields were refreshed for the selected grade and school year. Review them before saving.", "info");
    return;
  }
  if (LL.subjectsLoading) {
    showToast("Wait for the grade's subject fields to finish loading before saving.", "error");
    return;
  }
  if (!LL.gradingConfigReady || LL.gradingConfigGrade !== selectedGrade || LL.gradingConfigYear !== selectedYear) {
    await updateSubjectInputVisibility(selectedYear);
    if (!LL.gradingConfigReady) {
      showToast("Grade-level grading settings could not be loaded. Please try again before saving.", "error");
      return;
    }
    showToast("Grade settings were refreshed. Review the grade fields before saving.", "info");
    return;
  }
  const form = document.getElementById("learnerForm");
  if (!form.reportValidity()) return;
  const learnerId = getLearnerFieldValue("f_learnerId").trim();
  if (!/^\d{12}$/.test(learnerId)) {
    document.getElementById("f_learnerId")?.setCustomValidity("Enter the learner's 12-digit LRN.");
    document.getElementById("f_learnerId")?.reportValidity();
    document.getElementById("f_learnerId")?.setCustomValidity("");
    return;
  }
  learnerMutationBusy = true;
  const schoolYear = getSelectedSchoolYear();
  const saveBtn = document.getElementById("learnerSaveBtn");
  saveBtn.disabled = true;
  saveBtn.classList.add("is-loading");
  saveBtn.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span> Saving…`;
  try {
    const teacherScope = teacherLearnerScope();
    const selectedAssignmentValue = document.getElementById("f_teacherAssignment")?.value || "";
    let selectedGrade = getLearnerFieldValue("f_gradeLevel");
    let selectedSection = getLearnerFieldValue("f_section").trim();
    if (teacherScope.length && selectedAssignmentValue) {
      const chosenAssignment = teacherAssignmentOptions().find((assignment) => assignment.key === selectedAssignmentValue);
      if (chosenAssignment) {
        selectedGrade = chosenAssignment.gradeLevel;
        selectedSection = chosenAssignment.section;
      }
    }
    if (teacherScope.length) {
      const isAllowed = teacherScope.some((assignment) =>
        normalizeSectionGrade(assignment.gradeLevel) === normalizeSectionGrade(selectedGrade)
        && String(assignment.section).trim().toLowerCase() === selectedSection.toLowerCase()
      );
      if (!isAllowed) {
        throw new Error("This learner must be assigned to one of your teacher coverage sections.");
      }
    } else {
      await loadSectionOptions(schoolYear);
      if (!validateSectionInput()) return;
    }
    const transferType = getLearnerFieldValue("f_transferType");
    const learner = {
    learnerId,
    firstName: sentenceCaseName(getLearnerFieldValue("f_firstName")),
    middleName: sentenceCaseName(getLearnerFieldValue("f_middleName")),
    lastName: sentenceCaseName(getLearnerFieldValue("f_lastName")),
    suffix: getLearnerFieldValue("f_suffix") === "custom"
      ? getLearnerFieldValue("f_customSuffix").trim()
      : getLearnerFieldValue("f_suffix"),
    birthDate: getLearnerFieldValue("f_birthDate"),
    age: getLearnerFieldValue("f_age"),
    gradeLevel: teacherScope.length === 1 ? teacherScope[0].gradeLevel : (selectedGrade || getLearnerFieldValue("f_gradeLevel")),
    section: teacherScope.length === 1 ? teacherScope[0].section : selectedSection,
    gender: getLearnerFieldValue("f_gender"),
    enrollmentStatus: getLearnerFieldValue("f_enrollmentStatus"),
    eosyStatus: getLearnerFieldValue("f_eosyStatus"),
    bosyHeight: getHeightInCentimeters("f_bosyHeight"),
    bosyWeight: getLearnerFieldValue("f_bosyWeight"),
    bosyNutritionalStatus: getLearnerFieldValue("f_bosyNutritionalStatus"),
    mosyHeight: getHeightInCentimeters("f_mosyHeight"),
    mosyWeight: getLearnerFieldValue("f_mosyWeight"),
    mosyNutritionalStatus: getLearnerFieldValue("f_mosyNutritionalStatus"),
    eosyHeight: getHeightInCentimeters("f_eosyHeight"),
    eosyWeight: getLearnerFieldValue("f_eosyWeight"),
    eosyNutritionalStatus: getLearnerFieldValue("f_eosyNutritionalStatus"),
    guardian: sentenceCaseName(getLearnerFieldValue("f_guardian")),
    contact: getLearnerFieldValue("f_contact").trim(),
    is4Ps: document.getElementById("f_is4Ps")?.checked || false,
    isIP: document.getElementById("f_isIP")?.checked || false,
    isSNED: document.getElementById("f_isSNED")?.checked || false,
    isARAL: document.getElementById("f_isARAL")?.checked || false,
    isMuslim: document.getElementById("f_isMuslim")?.checked || false,
    ...mergeGradesForTerm(
      LL.editingLearnerOriginal,
      LL.gradeTerm,
      collectSubjectGradeValues(),
      LL.curriculumSubjects.map(({ id }) => id),
    ),
    bosyCRLA: getLearnerFieldValue("f_bosyCRLA"),
    mosyCRLA: getLearnerFieldValue("f_mosyCRLA"),
    eosyCRLA: getLearnerFieldValue("f_eosyCRLA"),
    bosyPhilIRI: getLearnerFieldValue("f_bosyPhilIRI"),
    mosyPhilIRI: getLearnerFieldValue("f_mosyPhilIRI"),
    eosyPhilIRI: getLearnerFieldValue("f_eosyPhilIRI"),
    bosyRMA: getLearnerFieldValue("f_bosyRMA"),
    mosyRMA: getLearnerFieldValue("f_mosyRMA"),
    eosyRMA: getLearnerFieldValue("f_eosyRMA"),
    transferType: transferType,
    transferIn: transferType === "Transfer In",
    transferOut: transferType === "Transfer Out",
    ...collectTransferSchoolInputs(form),
    transferDate: getLearnerFieldValue("f_transferDate"),
    transferReason: getLearnerFieldValue("f_transferReason").trim(),
    transferNotes: LL.editingLearnerOriginal?.transferNotes || '',
    ...collectDocumentStatusFields(form),
    anecdotalRecords: getLearnerFieldValue("f_anecdotalRecords").trim(),
    ...collectLearnerCardFields(form),
    extra: collectExtraFieldValues(),
    };
    Object.assign(learner, applyAutomaticFinalGrades(learner, selectedGrade));
    if (!isSheetsApiConfigured() && typeof fsAddLearner !== "function") {
      throw new Error("Configure the data backend first — see SETUP_README.md. (Demo data can't be saved.)");
    }
    if (LL.editingId) {
      await LPSApi.updateLearner(LL.editingId, learner, schoolYear);
      showToast("Learner updated.", "success");
    } else {
      const result = await LPSApi.addLearner(learner, schoolYear);
      showToast(`Learner added. LRN: ${result.learnerId}`, "success");
    }
    learnerFormInitialSnapshot = formSnapshot(document.getElementById("learnerForm"));
    closeModal(true);
    void loadLearners(schoolYear);
  } catch (err) {
    showToast(err.message || "The learner could not be saved. Your changes are still here.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove("is-loading");
    saveBtn.textContent = "Save learner";
    learnerMutationBusy = false;
  }
}

/* ---- Delete modal --------------------------------------------------------- */

export function openDeleteModal(learnerId, name) {
  if (learnerMutationBusy) return;
  LL.deletingId = learnerId;
  LL.deletingName = name;
  document.getElementById("deleteLearnerName").textContent = name;
  document.getElementById("deleteModalConfirm").textContent = Array.isArray(learnerId) ? "Remove learners" : "Remove learner";
  document.getElementById("deleteModalBackdrop").classList.add("is-open");
}

export function closeDeleteModal(force = false) {
  if (!force && learnerMutationBusy) return;
  document.getElementById("deleteModalBackdrop").classList.remove("is-open");
}

export async function confirmDelete() {
  const btn = document.getElementById("deleteModalConfirm");
  if (learnerMutationBusy || !btn) return;
  learnerMutationBusy = true;
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span> Removing…`;
  try {
    const firestoreDeleteLearner = typeof fsDeleteLearner === "function";
    const firestoreDeleteLearners = typeof fsDeleteLearners === "function";
    const schoolYear = LL.loadedSchoolYear || getSelectedSchoolYear() || "";
    if (!schoolYear) {
      throw new Error("No school year is selected for this learner list.");
    }
    if (!isSheetsApiConfigured() && !firestoreDeleteLearner && !firestoreDeleteLearners) {
      throw new Error("Configure the data backend first — see SETUP_README.md.");
    }
    if (Array.isArray(LL.deletingId)) {
      if (firestoreDeleteLearners) {
        await fsDeleteLearners(schoolYear, LL.deletingId);
      } else {
        await LPSApi.deleteLearners(LL.deletingId, schoolYear);
      }
      showToast(`${LL.deletingId.length} learners were removed.`, "success");
    } else {
      if (firestoreDeleteLearner) {
        await fsDeleteLearner(schoolYear, LL.deletingId);
      } else {
        await LPSApi.deleteLearner(LL.deletingId, schoolYear);
      }
      showToast(`${LL.deletingName} was removed.`, "success");
    }
    LL.selectedIds.clear();
    closeDeleteModal(true);
    void loadLearners(schoolYear);
  } catch (err) {
    showToast(err.message || "The learner could not be removed. Nothing was changed.", "error");
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = Array.isArray(LL.deletingId) ? "Remove learners" : "Remove learner";
    learnerMutationBusy = false;
  }
}

export function ensureIdentityInputs() {
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid || document.getElementById("f_middleName")) return;
  const firstName = document.getElementById("f_firstName")?.closest(".field");
  const lastName = document.getElementById("f_lastName")?.closest(".field");
  if (!firstName || !lastName) return;
  firstName.insertAdjacentHTML("afterend", `<div class="field"><label for="f_middleName">Middle name (optional)</label><input id="f_middleName" /></div>`);
  lastName.insertAdjacentHTML("afterend", `<div class="field"><label for="f_birthDate">Birthdate</label><input id="f_birthDate" type="date" /><small class="field-hint">Age is calculated automatically.</small></div><div class="field"><label for="f_age">Age</label><input id="f_age" type="number" readonly tabindex="-1" placeholder="Automatic" /></div>`);
}

export function updateLearnerAge() {
  const birthDate = getLearnerFieldValue("f_birthDate");
  const age = document.getElementById("f_age");
  if (!age) return;
  if (!birthDate) { age.value = ""; return; }
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let value = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) value -= 1;
  age.value = value >= 0 ? value : "";
}

export function ensureNutritionInputs() {
  if (document.getElementById("f_bosyHeight")) return;
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  formGrid.insertAdjacentHTML("beforeend", `<div class="field span-2 nutrition-input-group"><label>Baseline nutrition <small>(optional)</small></label><div class="nutrition-inputs"><input type="number" min="0" step="0.1" id="f_bosyHeight" placeholder="Height (cm)" /><input type="number" min="0" step="0.1" id="f_bosyWeight" placeholder="Weight (kg)" /><select id="f_bosyNutritionalStatus"><option value="">Status</option><option>Normal</option><option>Severely Wasted</option><option>Wasted</option><option>Overweight</option><option>Obese</option></select></div></div><div class="field span-2 nutrition-input-group"><label>Midline nutrition <small>(leave blank until middle of year)</small></label><div class="nutrition-inputs"><input type="number" min="0" step="0.1" id="f_mosyHeight" placeholder="Height (cm)" /><input type="number" min="0" step="0.1" id="f_mosyWeight" placeholder="Weight (kg)" /><select id="f_mosyNutritionalStatus"><option value="">Status</option><option>Normal</option><option>Severely Wasted</option><option>Wasted</option><option>Overweight</option><option>Obese</option></select></div></div><div class="field span-2 nutrition-input-group"><label>Endline nutrition <small>(leave blank until end of year)</small></label><div class="nutrition-inputs"><input type="number" min="0" step="0.1" id="f_eosyHeight" placeholder="Height (cm)" /><input type="number" min="0" step="0.1" id="f_eosyWeight" placeholder="Weight (kg)" /><select id="f_eosyNutritionalStatus"><option value="">Status</option><option>Normal</option><option>Severely Wasted</option><option>Wasted</option><option>Overweight</option><option>Obese</option></select></div></div>`);
}

export function ensureReadingInputs() {
  if (document.getElementById("f_bosyCRLA")) return;
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  const crlaOptions = `<option value="">Level</option><option>Grade Ready</option><option>Transitioning</option><option>Developing</option><option>High Emerging</option><option>Low Emerging</option>`;
  const philIriOptions = `<option value="">Level</option>${PHIL_IRI_CATEGORIES.map(({ label }) => `<option>${label}</option>`).join("")}`;
  formGrid.insertAdjacentHTML("beforeend", `<div class="field span-2 reading-input-group"><label>Reading profile <small id="readingReferenceHint">Select a grade to show the appropriate reference</small></label><div class="reading-reference" id="crlaReadingFields"><strong>CRLA</strong><div class="reading-inputs"><label>BOSY<select id="f_bosyCRLA">${crlaOptions}</select></label><label>MOSY<select id="f_mosyCRLA">${crlaOptions}</select></label><label>EOSY<select id="f_eosyCRLA">${crlaOptions}</select></label></div></div><div class="reading-reference" id="philIriReadingFields"><strong>Phil-IRI</strong><div class="reading-inputs"><label>BOSY<select id="f_bosyPhilIRI">${philIriOptions}</select></label><label>MOSY<select id="f_mosyPhilIRI">${philIriOptions}</select></label><label>EOSY<select id="f_eosyPhilIRI">${philIriOptions}</select></label></div></div></div>`);
}

export function ensureMathInputs() {
  if (document.getElementById("f_bosyRMA")) return;
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  const options = `<option value="">Level</option><option>Not Proficient</option><option>Low Proficient</option><option>Nearly-Proficient</option><option>Proficient</option><option>Highly-Proficient</option>`;
  formGrid.insertAdjacentHTML("beforeend", `<div class="field span-2 math-input-group"><label>Math profile <small id="mathReferenceHint">Available for Grades 1-6 · select a grade to show RMA</small></label><div class="math-reference" id="rmaFields"><strong>RMA</strong><div class="math-inputs"><label>BOSY<select id="f_bosyRMA">${options}</select></label><label>MOSY<select id="f_mosyRMA">${options}</select></label><label>EOSY<select id="f_eosyRMA">${options}</select></label></div></div></div>`);
}

export function ensureSubjectInputs() {
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  let group = formGrid.querySelector(".subject-input-group");
  if (!group) {
    group = document.createElement("div");
    group.className = "field span-2 subject-input-group";
    group.innerHTML = `<div class="grade-term-entry"><label for="f_gradeTerm">Academic term</label><select id="f_gradeTerm">${LL.gradeTerms.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}</select><small>Enter grades and Teacher Comments for the selected term. Final Grade is entered manually.</small></div><label>Subject grades <small id="subjectReferenceHint">(optional, 60-100) · select a grade level</small></label><div class="subject-inputs"></div>`;
    formGrid.appendChild(group);
  }
  const termSelect = group.querySelector("#f_gradeTerm");
  if (termSelect) {
    const selectedTerm = termSelect.value || LL.gradeTerm;
    termSelect.innerHTML = LL.gradeTerms.map(({ id, label }) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
    termSelect.value = LL.gradeTerms.some(({ id }) => id === selectedTerm) ? selectedTerm : DEFAULT_GRADE_TERM;
    LL.gradeTerm = termSelect.value;
  }
  const termHint = group.querySelector(".grade-term-entry small");
  if (termHint) {
    termHint.textContent = LL.gradeGrading.gradingType === "numerical" && LL.gradeGrading.finalGradeMode === "automatic"
      ? "Final Grade is calculated automatically from entered terms."
      : "Enter grades and Teacher Comments for the selected term. Final Grade is entered manually.";
  }
  const inputs = group.querySelector(".subject-inputs");
  if (!inputs) return;
  const values = new Map([...inputs.querySelectorAll("input, select")].map((input) => [input.id.slice(2), input.value]));
  inputs.innerHTML = LL.curriculumSubjects.map(({ id, label }) => `
    <label for="f_${id}" data-subject-id="${escapeHtml(id)}" hidden>${escapeHtml(label)}
      ${LL.gradeGrading.gradingType === "letter"
        ? `<select id="f_${escapeHtml(id)}"><option value="">Select letter</option>${LL.gradeGrading.letterScale.map(({ letter }) => `<option value="${escapeHtml(letter)}">${escapeHtml(letter)}</option>`).join("")}</select>`
        : `<input id="f_${escapeHtml(id)}" type="number" min="60" max="100" step="0.01" placeholder="-" />`}
    </label>`).join("");
  LL.curriculumSubjects.forEach(({ id }) => {
    const input = document.getElementById(`f_${id}`);
    if (!input) return;
    const value = values.get(id) ?? String(gradesForTerm(LL.editingLearnerOriginal, LL.gradeTerm, [id])[id] ?? "");
    if (input.tagName === "SELECT" && value && ![...input.options].some((option) => option.value === value)) {
      input.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(value)}">Existing value: ${escapeHtml(value)}</option>`);
    }
    input.value = value;
  });
  syncLearnerCardTerm(document.getElementById("learnerForm"), LL.gradeTerm);
}

export function setLearnerCurriculumSubjects(subjects) {
  const normalizedSubjects = normalizeCurriculumSubjectPool(subjects);
  LL.curriculumSubjects = normalizedSubjects;
  CURRICULUM_SUBJECT_IDS.clear();
  normalizedSubjects.forEach(({ id, label }) => {
    CURRICULUM_SUBJECT_IDS.add(id);
    LEARNER_DETAIL_LABELS[id] = label;
  });
  ensureSubjectInputs();
}

export function collectSubjectGradeValues() {
  const activeIds = new Set(LL.activeSubjectIds);
  return Object.fromEntries(LL.curriculumSubjects.map(({ id }) => {
    const input = document.getElementById(`f_${id}`);
    const value = activeIds.has(id)
      ? String(input?.value || "").trim()
      : String(gradesForTerm(LL.editingLearnerOriginal, LL.gradeTerm, [id])[id] ?? "").trim();
    return [id, value];
  }));
}

export function renderLearnerTermGrades(term = LL.gradeTerm) {
  const termSelect = document.getElementById("f_gradeTerm");
  if (termSelect) termSelect.value = term;
  const form = document.getElementById("learnerForm");
  if (form) syncLearnerCardTerm(form, term);
  const subjectIds = LL.curriculumSubjects.map(({ id }) => id);
  const autoFinal = term === FINAL_GRADE_TERM
    && LL.gradingConfigReady
    && LL.gradeGrading.gradingType === "numerical"
    && LL.gradeGrading.finalGradeMode === "automatic";
  const values = autoFinal
    ? computeNumericalFinalGrades(LL.editingLearnerOriginal, subjectIds, LL.gradeTerms.length - 1)
    : gradesForTerm(LL.editingLearnerOriginal, term, subjectIds);
  LL.curriculumSubjects.forEach(({ id }) => {
    const input = document.getElementById(`f_${id}`);
    if (input) {
      input.value = String(values[id] ?? "");
      input.readOnly = autoFinal && input.tagName === "INPUT";
      input.disabled = autoFinal && input.tagName === "SELECT";
    }
  });
}

export async function loadLearnerYearGradeTerms(schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) {
    LL.gradeTerms = gradeTermsForCount();
    return LL.gradeTerms;
  }
  if (Number.isInteger(LL.gradeTermCountByYear[year])) {
    LL.gradeTerms = gradeTermsForCount(LL.gradeTermCountByYear[year]);
    ensureSubjectInputs();
    return LL.gradeTerms;
  }
  let request = LL.gradeTermCountRequestsByYear[year];
  if (!request) {
    request = fsGetGradeTermCount(year).then((count) => {
      LL.gradeTermCountByYear[year] = count;
      return count;
    });
    LL.gradeTermCountRequestsByYear[year] = request;
    request.finally(() => {
      if (LL.gradeTermCountRequestsByYear[year] === request) delete LL.gradeTermCountRequestsByYear[year];
    }).catch(() => {});
  }
  const count = await request;
  if (String(getSelectedSchoolYear() || year).trim() === year) {
    LL.gradeTerms = gradeTermsForCount(count);
    ensureSubjectInputs();
  }
  return gradeTermsForCount(count);
}

export function applyAutomaticFinalGrades(learner, gradeLevel = LL.gradingConfigGrade) {
  if (!LL.gradingConfigReady
    || LL.gradeGrading.gradingType !== "numerical"
    || LL.gradeGrading.finalGradeMode !== "automatic"
    || gradeLevelConfigKey(gradeLevel) !== gradeLevelConfigKey(LL.gradingConfigGrade)) {
    return learner;
  }
  const subjectIds = LL.curriculumSubjects.map(({ id }) => id);
  const finalGrades = computeNumericalFinalGrades(learner, subjectIds, LL.gradeTerms.length - 1);
  return {
    ...learner,
    ...mergeGradesForTerm(learner, FINAL_GRADE_TERM, finalGrades, subjectIds),
  };
}

export async function updateSubjectInputVisibility(schoolYear = getSelectedSchoolYear(), refreshGrading = false) {
  const group = document.querySelector(".subject-input-group");
  const hint = document.getElementById("subjectReferenceHint");
  const grade = normalizeCurriculumGrade(document.getElementById("f_gradeLevel")?.value);
  if (!group || !hint) return;
  const requestId = ++LL.subjectRequestId;
  LL.subjectsLoading = true;
  LL.gradingConfigReady = false;
  LL.activeSubjectIds = [];
  LL.curriculumSubjects.forEach(({ id }) => {
    const field = document.querySelector(`[data-subject-id="${id}"]`);
    if (field) field.hidden = true;
  });
  if (!grade) {
    hint.textContent = "Select a grade level to load its assigned subjects.";
    LL.subjectConfigYear = String(schoolYear || "").trim();
    LL.subjectConfigGrade = "";
    LL.gradingConfigYear = String(schoolYear || "").trim();
    LL.gradingConfigGrade = "";
    LL.gradingConfigReady = true;
    LL.subjectsLoading = false;
    return;
  }

  hint.textContent = `Loading assigned subjects for ${grade}…`;
  try {
    const year = String(schoolYear || "").trim();
    if (!year) throw new Error("Select a school year before loading grade settings.");
    await loadLearnerYearGradeTerms(year);
    if (requestId !== LL.subjectRequestId) return;
    if (refreshGrading) {
      delete LL.gradingByGradeByYear[year];
      delete LL.gradingRequestsByYear[year];
    }
    if (!LL.gradingByGradeByYear[year]) {
      let request = LL.gradingRequestsByYear[year];
      if (!request) {
        request = fsGetGradeLevelGradingConfigurations(year).then((result) => {
          const gradeLevels = result.gradeLevels || {};
          if (LL.gradingRequestsByYear[year] === request) {
            LL.gradingByGradeByYear[year] = gradeLevels;
          }
          return gradeLevels;
        });
        LL.gradingRequestsByYear[year] = request;
        request.finally(() => {
          if (LL.gradingRequestsByYear[year] === request) delete LL.gradingRequestsByYear[year];
        }).catch(() => {});
      }
      await request;
    }
    if (requestId !== LL.subjectRequestId) return;
    const storedGrading = LL.gradingByGradeByYear[year]?.[gradeLevelConfigKey(grade)];
    LL.gradeGrading = normalizeGradeLevelGrading(storedGrading);
    LL.gradingConfigYear = year;
    LL.gradingConfigGrade = grade;
    LL.gradingConfigReady = true;
    ensureSubjectInputs();
    let assignments;
    let useLegacySubjects = false;
    if (typeof LPSApi.getGradeSubjectAssignments !== "function") {
      assignments = { [grade]: { configured: false, subjectIds: LEGACY_CURRICULUM_SUBJECT_IDS } };
      useLegacySubjects = true;
      hint.textContent = `Curriculum settings are not available here; showing the existing subject fields for ${grade}.`;
    } else {
      const year = String(schoolYear || "").trim();
      if (!year) throw new Error("Select a school year before loading its curriculum.");
      let request = LL.curriculumRequestsByYear[year];
      if (!request) {
        request = LPSApi.getGradeSubjectAssignments(year).then((result) => {
          LL.curriculumSubjectsByYear[year] = result?.grades || {};
          LL.curriculumLoadedAtByYear[year] = Date.now();
          if (result?.subjects) setLearnerCurriculumSubjects(result.subjects);
          return LL.curriculumSubjectsByYear[year];
        });
        LL.curriculumRequestsByYear[year] = request;
        request.finally(() => {
          if (LL.curriculumRequestsByYear[year] === request) delete LL.curriculumRequestsByYear[year];
        }).catch(() => {});
      }
      assignments = await request;
    }
    if (requestId !== LL.subjectRequestId) return;
    LL.activeSubjectIds = curriculumSubjectIdsForGrade(assignments, grade, useLegacySubjects, LL.curriculumSubjects);
    const activeIds = new Set(LL.activeSubjectIds);
    LL.curriculumSubjects.forEach(({ id }) => {
      const field = document.querySelector(`[data-subject-id="${id}"]`);
      if (field) field.hidden = !activeIds.has(id);
    });
    const gradingHint = LL.gradeGrading.gradingType === "letter"
      ? `letter grade equivalencies: ${LL.gradeGrading.letterScale.map(({ letter, min, max }) => `${letter} ${min}–${max}`).join(", ")}`
      : "numerical grades, 60-100";
    hint.textContent = LL.activeSubjectIds.length
      ? `${grade} · ${LL.activeSubjectIds.length} assigned subject${LL.activeSubjectIds.length === 1 ? "" : "s"} (optional ${gradingHint}).`
      : `No subjects are assigned to ${grade} for this school year. Ask the School Admin to configure its curriculum.`;
  } catch (error) {
    if (requestId !== LL.subjectRequestId) return;
    hint.textContent = `Unable to load grade settings or subjects for ${grade}: ${error.message || "Unknown error"}. Existing grades will be preserved when editing.`;
  } finally {
    if (requestId === LL.subjectRequestId) {
      LL.subjectConfigYear = String(schoolYear || "").trim();
      LL.subjectConfigGrade = grade;
      LL.subjectsLoading = false;
    }
  }
}

export function updateReadingReferenceVisibility() {
  const grade = document.getElementById("f_gradeLevel").value;
  const isKinder = /^Kinder$/i.test(grade);
  const isCrla = /^Grade [1-3]$/.test(grade);
  const crla = document.getElementById("crlaReadingFields");
  const philIri = document.getElementById("philIriReadingFields");
  const hint = document.getElementById("readingReferenceHint");
  const rma = document.getElementById("rmaFields");
  const mathHint = document.getElementById("mathReferenceHint");
  if (!crla || !philIri) return;
  crla.hidden = isKinder || !isCrla;
  philIri.hidden = isKinder || !grade || isCrla;
  const hiddenGroup = isCrla ? philIri : crla;
  if (hiddenGroup) hiddenGroup.querySelectorAll("select").forEach((select) => { select.value = ""; });
  if (rma) {
    rma.hidden = isKinder || !/^Grade [1-6]$/.test(grade);
    if (rma.hidden) rma.querySelectorAll("select").forEach((select) => { select.value = ""; });
  }
  if (mathHint) mathHint.textContent = /^Grade [1-6]$/.test(grade) ? "RMA reference · BOSY, MOSY, and EOSY are optional" : "Available for Grades 1-6 · select a grade to show RMA";
  hint.textContent = isKinder ? "Not applicable for Kinder" : !grade ? "Select a grade to show the appropriate reference" : (isCrla ? "CRLA reference · BOSY, MOSY, and EOSY are optional" : "Phil-IRI reference · BOSY, MOSY, and EOSY are optional");
}

export function ensureTransferInputs() {
  if (document.getElementById("f_transferType")) { ensureTransferSchoolInputs(document.getElementById('learnerForm')); return; }
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  formGrid.insertAdjacentHTML("beforeend", `
    <div class="field span-2 transfer-input-group">
      <label>Transfer information <small>(optional)</small></label>
      <div class="transfer-select-wrap">
        <select id="f_transferType">
          <option value="">No transfer record</option>
          <option value="Transfer In">Transfer In</option>
          <option value="Transfer Out">Transfer Out</option>
        </select>
      </div>
      <div class="transfer-detail-row" id="transferDetailRow" hidden>
        <div class="field">
          <label for="f_transferSchool" id="transferSchoolLabel">Transfer school</label>
          <input id="f_transferSchool" placeholder="School name" />
        </div>
        <div class="field">
          <label for="f_transferDate">Transfer date</label>
          <input id="f_transferDate" type="date" />
        </div>
        <div class="field span-2">
          <label for="f_transferReason">Transfer reason</label>
          <input id="f_transferReason" placeholder="e.g. family relocation, school transfer" />
        </div>
      </div>
      <div class="field span-2 document-status-fields" data-document-status-fields></div>
    </div>`);
  renderDocumentStatusFields(document.getElementById("learnerForm"), {}, 'learner');
  ensureTransferSchoolInputs(document.getElementById('learnerForm'));
  updateTransferSchoolInputs(document.getElementById('learnerForm'));
}

export function ensureLearnerStatusInputs() {
  const formGrid = document.querySelector("#learnerForm .field-grid");
  if (!formGrid) return;
  if (!document.getElementById('f_enrollmentStatus')) formGrid.insertAdjacentHTML('beforeend', '<div class="field"><label for="f_enrollmentStatus">Enrollment status</label><select id="f_enrollmentStatus"></select></div>');
  const enrollment = document.getElementById('f_enrollmentStatus');
  const previous = enrollment.value;
  enrollment.innerHTML = '<option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>';
  enrollment.value = ['INACTIVE', 'TRANSFERRED_OUT', 'DROPPED_OUT'].includes(previous) ? 'INACTIVE' : 'ACTIVE';
  if (!document.getElementById('f_eosyStatus')) formGrid.insertAdjacentHTML('beforeend', '<div class="field"><label for="f_eosyStatus">EOSY status</label><select id="f_eosyStatus"><option value="">Not recorded</option><option>Promoted</option><option>Retained</option><option>Dropped Out</option></select></div>');
}

export function updateTransferVisibility() {
  updateTransferSchoolInputs(document.getElementById('learnerForm'));
  const type = document.getElementById("f_transferType")?.value || "";
  const detailRow = document.getElementById("transferDetailRow");
  if (!detailRow) return;
  const isVisible = !!type;
  detailRow.hidden = !isVisible;
  if (!isVisible) {
    detailRow.querySelectorAll("input, textarea").forEach((field) => { field.value = ""; });
  }
}

export function normalizeSectionGrade(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const key = text.toLowerCase();
  if (key === "0" || key === "kinder" || key === "kindergarten" || key === "kg") return "kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? "grade " + match[1] : key;
}

export function ensureSectionInput() {
  const input = document.getElementById("f_section");
  if (!input) return;
  input.setAttribute("list", "sectionOptions");
  input.setAttribute("autocomplete", "off");
  if (!input.placeholder) input.placeholder = "Select a section";
  if (!document.getElementById("sectionOptions")) {
    input.insertAdjacentHTML("afterend", `<datalist id="sectionOptions"></datalist>`);
  }
  if (!document.getElementById("sectionValidationMessage")) {
    input.insertAdjacentHTML("afterend", `<small id="sectionValidationMessage" class="field-hint"></small>`);
  }
}

export async function loadSectionOptions(schoolYear) {
  if (!schoolYear || typeof LPSApi === "undefined" || typeof LPSApi.getEnrollmentSections !== "function") return;
  if (Object.prototype.hasOwnProperty.call(LL.enrollmentSectionsByYear, schoolYear)) return;
  if (LL.enrollmentSectionsInflight[schoolYear]) return LL.enrollmentSectionsInflight[schoolYear];
  LL.enrollmentSectionsInflight[schoolYear] = LPSApi.getEnrollmentSections(schoolYear)
    .then((result) => { LL.enrollmentSectionsByYear[schoolYear] = Array.isArray(result) ? result : []; })
    .catch((error) => {
      delete LL.enrollmentSectionsByYear[schoolYear];
      showToast(error.message || "Unable to load enrollment sections.", "error");
    })
    .finally(() => { delete LL.enrollmentSectionsInflight[schoolYear]; });
  return LL.enrollmentSectionsInflight[schoolYear];
}

export function updateSectionOptions() {
  const year = LL.sectionSchoolYear || getSelectedSchoolYear();
  const datalist = document.getElementById("sectionOptions");
  const input = document.getElementById("f_section");
  const grade = normalizeSectionGrade(document.getElementById("f_gradeLevel")?.value);
  const teacherScope = teacherLearnerScope();
  const allowedSectionsForGrade = grade && teacherScope.length ? teacherAssignedSectionsForGrade(document.getElementById("f_gradeLevel")?.value || grade) : [];
  const entries = (LL.enrollmentSectionsByYear[year] || []).filter((entry) => {
    if (!grade || normalizeSectionGrade(entry.gradeLevel) !== grade) return false;
    if (!teacherScope.length) return true;
    return !allowedSectionsForGrade.length || allowedSectionsForGrade.some((section) => String(section).trim().toLowerCase() === String(entry.section).trim().toLowerCase());
  });
  if (datalist) {
    datalist.innerHTML = "";
    [...new Map(entries.map((entry) => [String(entry.section).trim().toLowerCase(), entry])).values()].forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.section;
      datalist.appendChild(option);
    });
  }
  if (input && entries.length && input.value.trim() && !entries.some((entry) => String(entry.section).trim().toLowerCase() === input.value.trim().toLowerCase())) {
    input.value = "";
  }
  if (input) input.placeholder = entries.length ? "Select a section" : "Add sections in Enrollment Data first";
  validateSectionInput();
}

export function validateSectionInput() {
  const input = document.getElementById("f_section");
  const message = document.getElementById("sectionValidationMessage");
  if (!input) return true;
  const year = getSelectedSchoolYear();
  const entries = LL.enrollmentSectionsByYear[year];
  const grade = normalizeSectionGrade(document.getElementById("f_gradeLevel")?.value);
  const section = input.value.trim().toLowerCase();
  const teacherScope = teacherLearnerScope();
  const allowedSectionsForGrade = grade && teacherScope.length ? teacherAssignedSectionsForGrade(document.getElementById("f_gradeLevel")?.value || grade).map((value) => value.trim().toLowerCase()) : [];
  const valid = !!section && (
    !teacherScope.length
      ? Array.isArray(entries) && entries.some((entry) => normalizeSectionGrade(entry.gradeLevel) === grade && String(entry.section).trim().toLowerCase() === section)
      : allowedSectionsForGrade.includes(section)
  );
  input.setCustomValidity(valid ? "" : "Choose an assigned section for the selected grade and school year.");
  if (message) message.textContent = valid || !section ? "" : "This section is not in your assigned grade and section coverage.";
  return valid;
}

export function normalizeHeightInputs() {
  ["bosyHeight", "mosyHeight", "eosyHeight"].forEach((field) => {
    const input = document.getElementById("f_" + field);
    if (!input) return;
    input.min = "0.3";
    input.max = "2.5";
    input.step = "0.001";
    input.placeholder = "Height (m)";
  });
}
