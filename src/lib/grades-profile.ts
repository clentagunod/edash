// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { enrollmentGradeLabel } from './enrollment-data';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { escapeHtml, renderShell, showToast, startExportIndicator } from './shell';
import { APP_CONFIG, appSchoolFilePrefix, paginationPageNumbers } from './app-config';
import { CURRICULUM_GRADE_LEVELS, CURRICULUM_SUBJECTS, LEGACY_CURRICULUM_SUBJECT_IDS, curriculumSubjectIdsForGrade, normalizeCurriculumGrade, normalizeCurriculumSubjectPool } from './curriculum-subjects';
import { DEFAULT_GRADE_TERMS, FINAL_GRADE_TERM, gradeTermsForCount, gradeForTerm } from './academic-grades';
import { fsGetGradeLevelGradingConfigurations, fsGetGradeTermCount } from './firestore-api';
import { gradeLevelConfigKey } from './grading-config';
import { compareLearnersBySurname, formatLearnerName } from './learner-sorting';

export let gradesProfiles = [];
export let gradesLearnerRecords = [];
export let gradesSelectedTerm = FINAL_GRADE_TERM;
export let gradesTerms = DEFAULT_GRADE_TERMS;
export let gradesRequestId = 0;
export let gradesSortField = "name";
export let gradesSortDirection = "asc";
export let gradesFilteredProfiles = [];
export let gradesPage = 1;
export const GRADES_PAGE_SIZE = 10;
export let gradesCurriculumAssignments = {};
export let gradesCurriculumAvailable = false;
export let gradesCurriculumSubjects = [...CURRICULUM_SUBJECTS];
export let gradesGradingByGrade = {};

export async function initGradesProfile() {
  renderShell("grades", "Grades Profile");
  gradesTerms = gradeTermsForCount(await fsGetGradeTermCount());
  if (!gradesTerms.some(({ id }) => id === gradesSelectedTerm)) gradesSelectedTerm = FINAL_GRADE_TERM;
  renderGradesTermNavigation();
  document.getElementById("exportGradesBtn").addEventListener("click", exportGradesExcel);
  document.getElementById("printStudentCardBtn").addEventListener("click", openStudentCardWorkspace);
  document.getElementById("gradesSort").addEventListener("change", (event) => { gradesSortField = event.target.value; renderGradesTable(gradesFilteredProfiles); });
  document.getElementById("gradesSortDirection").addEventListener("change", (event) => { gradesSortDirection = event.target.value; renderGradesTable(gradesFilteredProfiles); });
  document.getElementById("gradesSort").value = gradesSortField;
  document.getElementById("gradesSortDirection").value = gradesSortDirection;
  ["gradesSearch", "gradesGradeFilter", "gradesProgramFilter", "gradesGenderFilter"].forEach((id) => document.getElementById(id).addEventListener("input", () => { gradesPage = 1; filterGradesProfiles(); }));
  ["gradesGradeFilter", "gradesProgramFilter", "gradesGenderFilter"].forEach((id) => document.getElementById(id).addEventListener("change", () => { gradesPage = 1; filterGradesProfiles(); }));
  document.getElementById("gradesTermNavigation")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grade-term]");
    if (button) selectGradesTerm(button.dataset.gradeTerm);
  });
  initYearSwitcher(loadGradesProfiles);
}

export function openStudentCardWorkspace() {
  const schoolYear = getSelectedSchoolYear();
  const query = schoolYear ? `?schoolYear=${encodeURIComponent(schoolYear)}` : "";
  const cardWindow = window.open(`/pages/print-card.html${query}`, "_blank");
  if (!cardWindow) showToast("Allow pop-ups to open the Student Card workspace.", "error");
}

export function renderGradesTermNavigation() {
  const navigation = document.getElementById("gradesTermNavigation");
  if (!navigation) return;
  navigation.innerHTML = gradesTerms.map(({ id, label }) => `
    <button type="button" data-grade-term="${id}" class="${id === gradesSelectedTerm ? "is-active" : ""}" aria-pressed="${id === gradesSelectedTerm}">
      ${escapeHtml(label)}
    </button>`).join("");
}

export async function loadGradesProfiles(schoolYear) {
  const body = document.getElementById("gradesTableBody");
  const requestId = ++gradesRequestId;
  gradesCurriculumAssignments = {};
  gradesCurriculumAvailable = true;
  renderGradesTableHeader();
  document.getElementById("gradesCurriculumState").textContent = "";
  body.innerHTML = `<tr><td colspan="4" class="state-row">Loading grades...</td></tr>`;
  try {
    const [records, curriculum, grading] = await Promise.all([
      loadGradesProfileData(schoolYear),
      loadGradesCurriculum(schoolYear),
      fsGetGradeLevelGradingConfigurations(schoolYear),
    ]);
    if (requestId !== gradesRequestId) return;
    gradesCurriculumAssignments = curriculum.assignments;
    gradesCurriculumAvailable = curriculum.available;
    gradesCurriculumSubjects = normalizeCurriculumSubjectPool(curriculum.subjects || gradesCurriculumSubjects);
    gradesGradingByGrade = grading.gradeLevels || {};
    gradesLearnerRecords = records || [];
    gradesProfiles = gradesLearnerRecords.map((record) => createGradeProfileFromLearner(
      record,
      getGradeSubjectIds(record.gradeLevel),
      gradesCurriculumSubjects,
      gradesSelectedTerm,
      gradesGradingByGrade[gradeLevelConfigKey(record.gradeLevel)]?.gradingType || "numerical",
    ));
    updateGradesCurriculumState();
    filterGradesProfiles();
  } catch (error) {
    if (requestId !== gradesRequestId) return;
    gradesProfiles = [];
    gradesLearnerRecords = [];
    gradesFilteredProfiles = [];
    document.getElementById("gradesSummary").innerHTML = "";
    body.innerHTML = `<tr><td colspan="${4 + getVisibleGradeSubjects().length}" class="state-row error">${escapeHtml(error.message || "Unable to load grades.")}</td></tr>`;
  }
}

export async function loadGradesCurriculum(schoolYear) {
  if (typeof LPSApi.getGradeSubjectAssignments !== "function") {
    return { assignments: {}, available: false, subjects: [...CURRICULUM_SUBJECTS] };
  }
  if (!schoolYear) return { assignments: {}, available: true, subjects: [...CURRICULUM_SUBJECTS] };
  const result = await LPSApi.getGradeSubjectAssignments(schoolYear);
  return { assignments: result?.grades || {}, available: true, subjects: result?.subjects || [...CURRICULUM_SUBJECTS] };
}

export function gradeSubjectIdsFor(gradeLevel, assignments, curriculumAvailable, subjects = gradesCurriculumSubjects) {
  if (!curriculumAvailable) return [...LEGACY_CURRICULUM_SUBJECT_IDS];
  return curriculumSubjectIdsForGrade(assignments, gradeLevel, false, subjects);
}

export function getGradeSubjectIds(gradeLevel) {
  return gradeSubjectIdsFor(gradeLevel, gradesCurriculumAssignments, gradesCurriculumAvailable, gradesCurriculumSubjects);
}

export function gradeSubjectsForFilter(gradeLevel, assignments, curriculumAvailable) {
  const visibleIds = gradeLevel
    ? gradeSubjectIdsFor(gradeLevel, assignments, curriculumAvailable, gradesCurriculumSubjects)
    : CURRICULUM_GRADE_LEVELS.flatMap((grade) => gradeSubjectIdsFor(grade, assignments, curriculumAvailable, gradesCurriculumSubjects));
  const visible = new Set(visibleIds);
  return gradesCurriculumSubjects.filter(({ id }) => visible.has(id));
}

export function getVisibleGradeSubjects() {
  const selectedGrade = document.getElementById("gradesGradeFilter")?.value || "";
  return gradeSubjectsForFilter(selectedGrade, gradesCurriculumAssignments, gradesCurriculumAvailable);
}

export function updateGradesCurriculumState() {
  const state = document.getElementById("gradesCurriculumState");
  if (!state) return;
  const selectedGrade = document.getElementById("gradesGradeFilter")?.value || "";
  if (!gradesCurriculumAvailable) {
    state.textContent = "Showing the existing subject set; grade-specific curriculum assignments are available with Firestore.";
    return;
  }
  if (selectedGrade && getGradeSubjectIds(selectedGrade).length === 0) {
    state.textContent = `No subjects are assigned to ${normalizeCurriculumGrade(selectedGrade)} for this school year. Configure this grade in Admin Console → School structure.`;
    return;
  }
  const visibleSubjects = getVisibleGradeSubjects();
  state.textContent = visibleSubjects.length
    ? selectedGrade
      ? `Showing subjects assigned to ${normalizeCurriculumGrade(selectedGrade)} for this school year.`
      : `Showing subjects assigned to any grade for this school year. Select a grade to see its curriculum only.`
    : "No subjects are assigned for this school year. Configure grade curricula in Admin Console → School structure.";
}

export async function loadGradesProfileData(schoolYear) {
  try {
    return await LPSApi.getGradesProfiles(schoolYear);
  } catch (error) {
    if (!/unknown action|getGradesProfiles/i.test(error.message || "")) throw error;
    const learners = [];
    let page = 1;
    let total = Infinity;
    while (learners.length < total) {
      const result = await LPSApi.getLearnerPage({ schoolYear, page, pageSize: 100 });
      learners.push(...(result.items || []));
      total = Number(result.total || 0);
      if (!result.items?.length || learners.length >= total) break;
      page += 1;
    }
    return learners;
  }
}

export function createGradeProfileFromLearner(learner, subjectIds = LEGACY_CURRICULUM_SUBJECT_IDS, subjects = gradesCurriculumSubjects, term = gradesSelectedTerm, gradingType = "numerical") {
  const extra = learner.extra || {};
  const extraByKey = {};
  Object.keys(extra).forEach((key) => { extraByKey[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = extra[key]; });
  const profile = {
    learnerId: learner.learnerId, name: formatLearnerName(learner), firstName: learner.firstName,
    middleName: learner.middleName, lastName: learner.lastName, suffix: learner.suffix,
    gradeLevel: learner.gradeLevel, section: learner.section, gender: learner.gender,
    is4Ps: learner.is4Ps, isIP: learner.isIP, isSNED: learner.isSNED, isARAL: learner.isARAL, isMuslim: learner.isMuslim,
  };
  let sum = 0;
  let count = 0;
  subjects.forEach(({ id: key }) => {
    const value = gradeForTerm(learner, term, key) ?? extraByKey[key.toLowerCase()];
    const normalizedValue = value == null ? "" : String(value).trim();
    profile[key] = normalizedValue;
    if (subjectIds.includes(key) && normalizedValue !== "" && Number.isFinite(Number(normalizedValue))) {
      sum += Number(normalizedValue);
      count += 1;
    }

  });
  profile.average = gradingType === "letter" ? "" : count ? Math.round((sum / count) * 100) / 100 : "";
  return profile;
}

export function selectGradesTerm(term) {
  if (!gradesTerms.some((entry) => entry.id === term) || term === gradesSelectedTerm) return;
  gradesSelectedTerm = term;
  gradesPage = 1;
  gradesProfiles = gradesLearnerRecords.map((record) => createGradeProfileFromLearner(
    record,
    getGradeSubjectIds(record.gradeLevel),
    gradesCurriculumSubjects,
    term,
    gradesGradingByGrade[gradeLevelConfigKey(record.gradeLevel)]?.gradingType || "numerical",
  ));
  document.querySelectorAll("[data-grade-term]").forEach((button) => {
    const selected = button.dataset.gradeTerm === term;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  filterGradesProfiles();
}

export function filterGradesProfiles() {
  const search = document.getElementById("gradesSearch").value.trim().toLowerCase();
  const grade = document.getElementById("gradesGradeFilter").value;
  const program = document.getElementById("gradesProgramFilter").value;
  const gender = document.getElementById("gradesGenderFilter").value;
  gradesFilteredProfiles = gradesProfiles.filter((record) => {
    const searchable = `${record.name || ""} ${record.learnerId || ""}`.toLowerCase();
    return (!search || searchable.includes(search)) && (!grade || enrollmentGradeLabel(record.gradeLevel) === enrollmentGradeLabel(grade)) && (!gender || record.gender === gender) && (!program || record[{ "4Ps": "is4Ps", IP: "isIP", SNED: "isSNED", ARAL: "isARAL", Muslim: "isMuslim" }[program]]);
  });
  renderGradesSummary(gradesFilteredProfiles);
  updateGradesCurriculumState();
  renderGradesTable(gradesFilteredProfiles);
}

export function renderGradesSummary(records) {
  const withAverage = records.filter((record) => record.average !== "" && record.average != null);
  const average = withAverage.length ? withAverage.reduce((sum, record) => sum + Number(record.average), 0) / withAverage.length : 0;
  document.getElementById("gradesSummary").innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Learners tracked</div>
    <div class="stat-pill"><strong>${withAverage.length.toLocaleString()}</strong>With grades</div>
    <div class="stat-pill"><strong>${average ? average.toFixed(2) : "—"}</strong>Class average</div>`;
}

export function gradeCell(value) {
  return value === "" || value == null ? `<span class="grade-empty">—</span>` : `<strong>${escapeHtml(value)}</strong>`;
}

export function renderGradesTable(records) {
  const body = document.getElementById("gradesTableBody");
  const subjects = getVisibleGradeSubjects();
  const colspan = 4 + subjects.length;
  renderGradesTableHeader(subjects);
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="${colspan}" class="state-row">No grade profiles found.</td></tr>`;
    renderGradesPagination(0, 1);
    return;
  }
  const sortedRecords = records.slice().sort(compareGradeProfiles);
  const pageCount = Math.max(1, Math.ceil(sortedRecords.length / GRADES_PAGE_SIZE));
  gradesPage = Math.min(gradesPage, pageCount);
  const pageRecords = sortedRecords.slice((gradesPage - 1) * GRADES_PAGE_SIZE, gradesPage * GRADES_PAGE_SIZE);
  body.innerHTML = pageRecords.map((record) => `<tr>
    <td class="cell-name">${escapeHtml(record.name || "—")}</td><td>${escapeHtml(record.gradeLevel || "—")}</td><td>${escapeHtml(record.section || "—")}</td>
    ${subjects.map(({ id }) => `<td class="grade-cell">${getGradeSubjectIds(record.gradeLevel).includes(id) ? gradeCell(record[id]) : `<span class="grade-empty">—</span>`}</td>`).join("")}
    <td class="average-cell">${gradeCell(record.average)}</td>
  </tr>`).join("");
  renderGradesPagination(sortedRecords.length, pageCount);
}

export function renderGradesTableHeader(subjects = getVisibleGradeSubjects()) {
  const tableHead = document.getElementById("gradesTableHead");
  if (tableHead) {
    tableHead.innerHTML = `<th>Learner</th><th>Grade</th><th>Section</th>${subjects.map(({ label }) => `<th>${escapeHtml(label)}</th>`).join("")}<th>Average</th>`;
  }
}

export function renderGradesPagination(total, pageCount) {
  const info = document.getElementById("gradesPageInfo");
  const buttons = document.getElementById("gradesPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(gradesPage - 1) * GRADES_PAGE_SIZE + 1}-${Math.min(gradesPage * GRADES_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(gradesPage, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${gradesPage === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === gradesPage ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${gradesPage === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => { gradesPage = button.dataset.page ? Number(button.dataset.page) : index === 0 ? gradesPage - 1 : gradesPage + 1; renderGradesTable(gradesFilteredProfiles); }); });
}

export function compareGradeProfiles(first, second) {
  if (gradesSortField === "name") {
    const nameComparison = compareLearnersBySurname(first, second);
    return gradesSortDirection === "asc" ? nameComparison : -nameComparison;
  }
  const firstValue = first[gradesSortField];
  const secondValue = second[gradesSortField];
  let comparison;
  if (gradesSortField === "average") {
    const firstAverage = firstValue === "" || firstValue == null ? -Infinity : Number(firstValue);
    const secondAverage = secondValue === "" || secondValue == null ? -Infinity : Number(secondValue);
    comparison = firstAverage - secondAverage;
  } else if (gradesSortField === "gradeLevel") {
    const order = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
    comparison = order.indexOf(enrollmentGradeLabel(firstValue)) - order.indexOf(enrollmentGradeLabel(secondValue));
  } else {
    comparison = String(firstValue || "").localeCompare(String(secondValue || ""), undefined, { numeric: true, sensitivity: "base" });
  }
  if (comparison === 0) comparison = String(first.learnerId || "").localeCompare(String(second.learnerId || ""), undefined, { numeric: true });
  return gradesSortDirection === "asc" ? comparison : -comparison;
}

export async function exportGradesExcel() {
  if (!gradesFilteredProfiles.length) {
    showToast("There are no grade profiles to export.", "error");
    return;
  }
  const indicator = startExportIndicator("Preparing grades export...", document.getElementById("exportGradesBtn"));
  if (!indicator) return;
  try {
    indicator.update("Building grades workbook...", 45);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
  const year = getSelectedSchoolYear() || "Current";
  const subjects = getVisibleGradeSubjects();
  const termLabel = gradesTerms.find(({ id }) => id === gradesSelectedTerm)?.label || "Final Grade";
  const headers = ["Learner ID", "Name", "Grade Level", "Section", ...subjects.map(({ label }) => label), "Average"];
  const values = gradesFilteredProfiles.slice().sort(compareGradeProfiles).map((record) => [
    record.learnerId, record.name, record.gradeLevel, record.section,
    ...subjects.map(({ id }) => getGradeSubjectIds(record.gradeLevel).includes(id) ? record[id] : ""),
    record.average,
  ]);
  const cell = (value, isLearnerId = false) => `<td${isLearnerId ? " class=\"text-cell\"" : ""}>${escapeHtml(value == null ? "" : String(value))}</td>`;
  const workbook = `<html><head><meta charset="UTF-8"><style>.text-cell{mso-number-format:'\\@';}</style></head><body><h1>${escapeHtml(APP_CONFIG.branding.schoolName)} Grades Profile - ${escapeHtml(termLabel)} - ${escapeHtml(year)}</h1><table border="1"><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>${values.map((row) => `<tr>${row.map((value, index) => cell(value, index === 0)).join("")}</tr>`).join("")}</table></body></html>`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" }));
  link.download = `${appSchoolFilePrefix()}-grades-profile-${year.replace(/\s+/g, "")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  indicator.finish();
  showToast("Grades profile Excel report downloaded.", "success");
  } catch (error) {
    indicator.close();
    showToast(error.message || "Unable to export grades profile.", "error");
  }
}
