// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { APP_CONFIG, isSchoolAdmin } from './app-config';
import { clearButtonLoading, escapeHtml, setButtonLoading, showToast } from './shell';
import { Icon } from './icons';
import { downloadFirestoreBackup, importFirestoreBackupFile, updateFirestoreBackupModeWarning } from './firestore-backup';
import { CURRICULUM_GRADE_LEVELS, CURRICULUM_SUBJECTS, isCustomCurriculumSubjectId, normalizeCurriculumSubjectIds, normalizeCurriculumSubjectPool } from './curriculum-subjects';
import { DEFAULT_GRADE_TERM_COUNT, MAX_GRADE_TERM_COUNT, MIN_GRADE_TERM_COUNT } from './academic-grades';
import { fsGetCardPrintingPreferences, fsGetGradeLevelGradingConfigurations, fsGetGradeTermCount, fsGetParentAccessConfiguration, fsGetPassingThreshold, fsGetPromotionConfiguration, fsGetRoundType, fsSetCanPromoteStudents, fsSetCardPrintingPreferences, fsSetGradeLevelGradingConfiguration, fsSetGradeTermCount, fsSetParentAccessEnabled, fsSetPassingThreshold, fsSetRoundType } from './firestore-api';
import { DEFAULT_LETTER_GRADE_SCALE, DEFAULT_PASSING_THRESHOLD, gradeLevelConfigKey, normalizeGradeLevelGrading, normalizePassingThreshold } from './grading-config';

/* Admin Console: school years and dynamic section directory. */

export const ADMIN_OPTIONS = { years: [], sections: [], selectedYear: "", gradeTermCount: DEFAULT_GRADE_TERM_COUNT, passingThreshold: DEFAULT_PASSING_THRESHOLD, gradeTermsSaving: false, gradeTermsRequestId: 0, passingThresholdSaving: false, parentAccessEnabled: true, parentAccessLoaded: false, parentAccessSaving: false, parentAccessRequestId: 0, canPromoteStudents: false, promotionAccessLoaded: false, promotionAccessSaving: false, promotionAccessRequestId: 0, gradingByGrade: {}, gradingRequestId: 0, gradingSaving: false, editingSection: null, curricula: {}, curriculumDrafts: {}, curriculumSubjects: [...CURRICULUM_SUBJECTS], curriculumRequestId: 0, curriculumSaving: false, curriculumLoadError: false, addingCurriculumSubject: false, deletingCurriculumSubject: false };

export function adminOptionEscape(value) {
  return typeof escapeHtml === "function" ? escapeHtml(String(value ?? "")) : String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
}

export function adminGradeLabel(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(text)) return "Kinder";
  const match = text.match(/^grade\s*(\d+)$/) || text.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : String(value || "Unassigned").trim() || "Unassigned";
}

export function initializeSheetsBackupLink() {
  const link = document.getElementById("openSheetsBackupBtn");
  const status = document.getElementById("sheetsBackupStatus");
  if (!link || !status) return false;

  const configuredUrl = APP_CONFIG.backupSpreadsheetUrl || "";
  if (!configuredUrl) {
    link.hidden = true;
    status.textContent = "Google Sheets backup is not configured for this school.";
    return false;
  }

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    link.hidden = true;
    status.textContent = "The configured Google Sheets backup link is invalid.";
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !url.pathname.startsWith("/spreadsheets/")) {
    link.hidden = true;
    status.textContent = "The configured Google Sheets backup link is invalid.";
    return false;
  }

  link.href = url.toString();
  link.hidden = false;
  status.textContent = "The configured school backup spreadsheet is ready to open.";
  return true;
}

function adminCurriculumDraftKey(schoolYear, gradeLevel) {
  return `${schoolYear}::${gradeLevel}`;
}

export async function initAdminOptions() {
  if (!isSchoolAdmin()) return;
  initializeSheetsBackupLink();
  document.getElementById("openYearModalBtn")?.addEventListener("click", openAdminYearModal);
  document.getElementById("openSectionModalBtn")?.addEventListener("click", () => openAdminSectionModal());
  document.getElementById("adminYearSelect")?.addEventListener("change", (event) => loadAdminSections(event.target.value));
  document.getElementById("adminGradingGrade")?.addEventListener("change", renderAdminGradeGradingEditor);
  document.getElementById("adminGradingType")?.addEventListener("change", updateAdminLetterScaleVisibility);
  document.getElementById("adminAutomaticFinalGrade")?.addEventListener("change", updateAdminLetterScaleVisibility);
  document.getElementById("addLetterScaleRowBtn")?.addEventListener("click", addAdminLetterScaleRow);
  document.getElementById("adminLetterScaleRows")?.addEventListener("click", removeAdminLetterScaleRow);
  document.getElementById("saveGradeGradingBtn")?.addEventListener("click", saveAdminGradeGrading);
  document.getElementById("saveAdminCardPreferencesBtn")?.addEventListener("click", saveAdminCardPreferences);
  document.getElementById("adminCurriculumGrade")?.addEventListener("change", renderAdminCurriculumEditor);
  document.getElementById("saveCurriculumSubjectsBtn")?.addEventListener("click", saveAdminCurriculumSubjects);
  document.getElementById("addCurriculumSubjectBtn")?.addEventListener("click", addAdminCurriculumSubject);
  document.getElementById("newCurriculumSubjectName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void addAdminCurriculumSubject();
    }
  });
  document.getElementById("makeCurrentYearBtn")?.addEventListener("click", makeAdminYearCurrent);
  document.getElementById("adminGradeTermCount")?.addEventListener("change", saveAdminGradeTermCount);
  document.getElementById("adminRoundType")?.addEventListener("change", saveAdminRoundType);
  document.getElementById("savePassingThresholdBtn")?.addEventListener("click", saveAdminPassingThreshold);
  document.getElementById("adminParentAccessToggle")?.addEventListener("change", saveAdminParentAccessToggle);
  document.getElementById("adminPromotionAccessToggle")?.addEventListener("change", saveAdminPromotionAccessToggle);
  document.getElementById("downloadFirestoreBackupBtn")?.addEventListener("click", () => { void downloadFirestoreBackup(); });
  const importMode = document.getElementById("firestoreBackupMode");
  if (importMode) {
    updateFirestoreBackupModeWarning(importMode.value);
    importMode.addEventListener("change", (event) => updateFirestoreBackupModeWarning(event.currentTarget.value));
  }
  const importButton = document.getElementById("importFirestoreBackupBtn");
  const importInput = document.getElementById("firestoreBackupFile");
  importButton?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file) await importFirestoreBackupFile(file, importMode?.value || "replace");
    input.value = "";
  });
  await Promise.all([loadAdminStructure(), loadAdminParentAccess(), loadAdminPromotionAccess(), loadAdminRoundType(), loadAdminCardPreferences()]);
  ensureAdminModals();
}

export async function loadAdminCardPreferences() {
  const state = document.getElementById("adminCardPreferencesState");
  if (!state) return;
  state.classList.remove("is-error", "is-success", "is-saving");
  try {
    const preferences = await fsGetCardPrintingPreferences();
    const template = document.getElementById("adminCardTemplate");
    if (template) template.value = preferences.activeTemplate;
    const monthInput = document.getElementById("adminCardAttendanceMonths");
    if (monthInput) monthInput.value = preferences.attendanceMonths.join(", ");
    const labelFields = { classDays: "adminCardClassDaysLabel", daysPresent: "adminCardPresentLabel", daysAbsent: "adminCardAbsentLabel" };
    preferences.attendanceRows.forEach(({ id, label }) => {
      const input = document.getElementById(labelFields[id]);
      if (input) input.value = label;
    });
    const gradeAssignments = document.getElementById("adminCardGradeTemplates");
    if (gradeAssignments) gradeAssignments.innerHTML = CURRICULUM_GRADE_LEVELS.map((grade) => {
      const key = gradeLevelConfigKey(grade);
      return `<label class="admin-card-grade-template"><span>${adminOptionEscape(grade)}</span><select data-card-grade-template="${adminOptionEscape(key)}" aria-label="Card template for ${adminOptionEscape(grade)}"><option value="sf9">Current learner card template</option></select></label>`;
    }).join("");
    gradeAssignments?.querySelectorAll("[data-card-grade-template]").forEach((select) => { select.value = preferences.gradeTemplates[select.dataset.cardGradeTemplate] || preferences.activeTemplate; });
    state.textContent = "Card Printing preferences loaded.";
    state.classList.remove("is-error");
  } catch (error) {
    state.textContent = `Unable to load Card Printing preferences: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
  }
}

export async function saveAdminCardPreferences() {
  const state = document.getElementById("adminCardPreferencesState");
  const button = document.getElementById("saveAdminCardPreferencesBtn");
  const monthInput = document.getElementById("adminCardAttendanceMonths");
  if (!state || !button || !monthInput) return;
  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";
  button.setAttribute("aria-busy", "true");
  state.classList.remove("is-error", "is-success");
  state.classList.add("is-saving");
  state.textContent = "Saving Card Printing preferences…";
  try {
    const gradeTemplates = Object.fromEntries([...document.querySelectorAll("[data-card-grade-template]")].map((select) => [select.dataset.cardGradeTemplate, select.value]));
    const labelFields = { classDays: "adminCardClassDaysLabel", daysPresent: "adminCardPresentLabel", daysAbsent: "adminCardAbsentLabel" };
    const attendanceRows = Object.entries(labelFields).map(([id, fieldId]) => ({ id, label: document.getElementById(fieldId)?.value.trim() || "" }));
    const attendanceMonths = monthInput.value.split(/[\n,]/).map((month) => month.trim()).filter(Boolean);
    const preferences = await fsSetCardPrintingPreferences({
      activeTemplate: document.getElementById("adminCardTemplate")?.value || "sf9",
      gradeTemplates,
      attendanceMonths,
      attendanceRows,
    });
    monthInput.value = preferences.attendanceMonths.join(", ");
    state.textContent = "Card Printing preferences saved.";
    state.classList.remove("is-saving");
    state.classList.add("is-success");
  } catch (error) {
    state.textContent = `Unable to save Card Printing preferences: ${error.message || "Unknown error"}`;
    state.classList.remove("is-saving", "is-success");
    state.classList.add("is-error");
    showToast(error.message || "Unable to save Card Printing preferences.", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalButtonText;
    button.removeAttribute("aria-busy");
  }
}

export async function loadAdminRoundType() {
  const select = document.getElementById("adminRoundType");
  const state = document.getElementById("adminRoundTypeState");
  if (!select || !state) return;
  select.disabled = true;
  try {
    const roundType = await fsGetRoundType();
    select.value = roundType;
    state.textContent = `Saved setting: ${roundType === "none" ? "decimal results are preserved" : "nearest whole number, with .5 rounded up"}.`;
    state.classList.remove("is-error");
  } catch (error) {
    state.textContent = `Unable to load rounding settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
  } finally {
    select.disabled = false;
  }
}

export async function saveAdminRoundType(event) {
  const select = event?.currentTarget || document.getElementById("adminRoundType");
  const state = document.getElementById("adminRoundTypeState");
  if (!select || !state) return;
  select.disabled = true;
  try {
    const roundType = await fsSetRoundType(select.value);
    state.textContent = `Saved: ${roundType === "none" ? "decimal results are preserved" : "nearest whole number, with .5 rounded up"}.`;
    state.classList.remove("is-error");
  } catch (error) {
    state.textContent = `Unable to save rounding settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to save rounding settings.", "error");
    await loadAdminRoundType();
  } finally {
    select.disabled = false;
  }
}

export async function loadAdminPromotionAccess() {
  const toggle = document.getElementById("adminPromotionAccessToggle");
  const state = document.getElementById("adminPromotionAccessState");
  if (!toggle || !state) return;
  const requestId = ++ADMIN_OPTIONS.promotionAccessRequestId;
  toggle.disabled = true;
  state.classList.remove("is-error");
  state.textContent = "Loading Promotion & Retention setting…";
  ADMIN_OPTIONS.promotionAccessLoaded = false;
  try {
    const configuration = await fsGetPromotionConfiguration();
    if (requestId !== ADMIN_OPTIONS.promotionAccessRequestId) return;
    ADMIN_OPTIONS.canPromoteStudents = configuration.canPromoteStudents;
    ADMIN_OPTIONS.promotionAccessLoaded = true;
    toggle.checked = configuration.canPromoteStudents;
    state.textContent = configuration.configured
      ? `Teacher promotion and retention are ${configuration.canPromoteStudents ? "on" : "off"}.`
      : "Teacher promotion and retention are off by default. Save the switch to create settings/toggles/canPromoteStudents.";
  } catch (error) {
    if (requestId !== ADMIN_OPTIONS.promotionAccessRequestId) return;
    state.textContent = `Unable to load Promotion & Retention setting: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
  } finally {
    if (requestId === ADMIN_OPTIONS.promotionAccessRequestId) toggle.disabled = !ADMIN_OPTIONS.promotionAccessLoaded;
  }
}

export async function saveAdminPromotionAccessToggle(event) {
  const toggle = event?.currentTarget || document.getElementById("adminPromotionAccessToggle");
  const state = document.getElementById("adminPromotionAccessState");
  if (!toggle || !state || !ADMIN_OPTIONS.promotionAccessLoaded || ADMIN_OPTIONS.promotionAccessSaving) return;
  const nextValue = toggle.checked;
  ADMIN_OPTIONS.promotionAccessSaving = true;
  toggle.disabled = true;
  state.classList.remove("is-error");
  state.textContent = "Saving Promotion & Retention setting…";
  try {
    await fsSetCanPromoteStudents(nextValue);
    ADMIN_OPTIONS.canPromoteStudents = nextValue;
    state.textContent = `Teacher promotion and retention are now ${nextValue ? "on" : "off"}.`;
  } catch (error) {
    toggle.checked = ADMIN_OPTIONS.canPromoteStudents;
    state.textContent = `Unable to save Promotion & Retention setting: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to update Promotion & Retention access.", "error");
  } finally {
    ADMIN_OPTIONS.promotionAccessSaving = false;
    toggle.disabled = false;
  }
}

export async function loadAdminParentAccess() {
  const toggle = document.getElementById("adminParentAccessToggle");
  const state = document.getElementById("adminParentAccessState");
  if (!toggle || !state) return;
  const requestId = ++ADMIN_OPTIONS.parentAccessRequestId;
  toggle.disabled = true;
  state.classList.remove("is-error");
  state.textContent = "Loading Parent Access setting…";
  ADMIN_OPTIONS.parentAccessLoaded = false;
  try {
    const configuration = await fsGetParentAccessConfiguration();
    if (requestId !== ADMIN_OPTIONS.parentAccessRequestId) return;
    ADMIN_OPTIONS.parentAccessEnabled = configuration.canParentAccess;
    ADMIN_OPTIONS.parentAccessLoaded = true;
    toggle.checked = configuration.canParentAccess;
    state.textContent = configuration.configured
      ? `Parent Portal access is ${configuration.canParentAccess ? "on" : "off"}.`
      : "Parent Portal access is on by default. Save the switch to create settings/toggles.";
  } catch (error) {
    if (requestId !== ADMIN_OPTIONS.parentAccessRequestId) return;
    state.textContent = `Unable to load Parent Access setting: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
  } finally {
    if (requestId === ADMIN_OPTIONS.parentAccessRequestId) toggle.disabled = !ADMIN_OPTIONS.parentAccessLoaded;
  }
}

export async function saveAdminParentAccessToggle(event) {
  const toggle = event?.currentTarget || document.getElementById("adminParentAccessToggle");
  const state = document.getElementById("adminParentAccessState");
  if (!toggle || !state || !ADMIN_OPTIONS.parentAccessLoaded || ADMIN_OPTIONS.parentAccessSaving) return;
  const nextValue = toggle.checked;
  ADMIN_OPTIONS.parentAccessSaving = true;
  toggle.disabled = true;
  state.classList.remove("is-error");
  state.textContent = "Saving Parent Access setting…";
  try {
    await fsSetParentAccessEnabled(nextValue);
    ADMIN_OPTIONS.parentAccessEnabled = nextValue;
    state.textContent = `Parent Portal access is now ${nextValue ? "on" : "off"}.`;
  } catch (error) {
    toggle.checked = ADMIN_OPTIONS.parentAccessEnabled;
    state.textContent = `Unable to save Parent Access setting: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to update Parent Access.", "error");
  } finally {
    ADMIN_OPTIONS.parentAccessSaving = false;
    toggle.disabled = false;
  }
}

export async function loadAdminGradeTerms(schoolYear = ADMIN_OPTIONS.selectedYear) {
  const select = document.getElementById("adminGradeTermCount");
  const state = document.getElementById("adminGradeTermsState");
  const thresholdInput = document.getElementById("adminPassingThreshold");
  const thresholdState = document.getElementById("adminPassingThresholdState");
  if (!select || !state) return;
  const requestId = ++ADMIN_OPTIONS.gradeTermsRequestId;
  select.disabled = true;
  state.textContent = schoolYear ? `Loading grade term settings for ${schoolYear}…` : "Select a school year to configure grade terms.";
  if (!schoolYear) {
    select.value = String(DEFAULT_GRADE_TERM_COUNT);
    select.disabled = true;
    ADMIN_OPTIONS.passingThreshold = DEFAULT_PASSING_THRESHOLD;
    if (thresholdInput) {
      thresholdInput.value = String(DEFAULT_PASSING_THRESHOLD);
      thresholdInput.disabled = true;
    }
    if (thresholdState) thresholdState.textContent = "Create or select a school year to configure the passing threshold.";
    return;
  }
  if (thresholdInput) thresholdInput.disabled = true;
  state.classList.remove("is-error");
  try {
    const [count, threshold] = await Promise.all([
      fsGetGradeTermCount(schoolYear),
      fsGetPassingThreshold(schoolYear),
    ]);
    if (requestId !== ADMIN_OPTIONS.gradeTermsRequestId) return;
    ADMIN_OPTIONS.gradeTermCount = count;
    ADMIN_OPTIONS.passingThreshold = threshold;
    select.value = String(ADMIN_OPTIONS.gradeTermCount);
    if (thresholdInput) thresholdInput.value = String(threshold);
    state.textContent = `${schoolYear}: ${ADMIN_OPTIONS.gradeTermCount} grade term${ADMIN_OPTIONS.gradeTermCount === 1 ? "" : "s"} plus Final Grade.`;
    if (thresholdState) {
      thresholdState.classList.remove("is-error");
      thresholdState.textContent = `${schoolYear}: grades of ${threshold} or higher pass.`;
    }
  } catch (error) {
    if (requestId !== ADMIN_OPTIONS.gradeTermsRequestId) return;
    state.textContent = `Unable to load grade term settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    if (thresholdState) {
      thresholdState.textContent = `Unable to load passing threshold: ${error.message || "Unknown error"}`;
      thresholdState.classList.add("is-error");
    }
  } finally {
    if (requestId === ADMIN_OPTIONS.gradeTermsRequestId) {
      select.disabled = false;
      if (thresholdInput) thresholdInput.disabled = false;
    }
  }
}

export async function saveAdminGradeTermCount(event) {
  const select = event?.currentTarget || document.getElementById("adminGradeTermCount");
  const state = document.getElementById("adminGradeTermsState");
  if (!select || !state || ADMIN_OPTIONS.gradeTermsSaving) return;
  const requestedCount = Number(select.value);
  if (!Number.isInteger(requestedCount) || requestedCount < MIN_GRADE_TERM_COUNT || requestedCount > MAX_GRADE_TERM_COUNT) {
    select.value = String(ADMIN_OPTIONS.gradeTermCount);
    state.textContent = `Choose between ${MIN_GRADE_TERM_COUNT} and ${MAX_GRADE_TERM_COUNT} grade terms.`;
    state.classList.add("is-error");
    return;
  }
  const previousCount = ADMIN_OPTIONS.gradeTermCount;
  const schoolYear = ADMIN_OPTIONS.selectedYear;
  if (!schoolYear) return;
  ADMIN_OPTIONS.gradeTermsSaving = true;
  select.disabled = true;
  state.textContent = "Saving grade term settings…";
  state.classList.remove("is-error");
  try {
    const savedCount = await fsSetGradeTermCount(requestedCount, schoolYear);
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.gradeTermCount = savedCount;
    state.textContent = `Saved for ${schoolYear}: ${requestedCount} grade term${requestedCount === 1 ? "" : "s"} plus Final Grade.`;
  } catch (error) {
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.gradeTermCount = previousCount;
    select.value = String(previousCount);
    state.textContent = `Unable to save grade term settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to save grade term settings.", "error");
  } finally {
    ADMIN_OPTIONS.gradeTermsSaving = false;
    if (schoolYear === ADMIN_OPTIONS.selectedYear) select.disabled = false;
  }
}

export async function saveAdminPassingThreshold() {
  const input = document.getElementById("adminPassingThreshold");
  const state = document.getElementById("adminPassingThresholdState");
  const button = document.getElementById("savePassingThresholdBtn");
  if (!input || !state || !button || ADMIN_OPTIONS.passingThresholdSaving) return;
  const schoolYear = ADMIN_OPTIONS.selectedYear;
  if (!schoolYear) return;
  let requestedThreshold;
  try {
    requestedThreshold = normalizePassingThreshold(input.value);
  } catch (error) {
    input.value = String(ADMIN_OPTIONS.passingThreshold);
    state.textContent = error.message;
    state.classList.add("is-error");
    return;
  }
  const previousThreshold = ADMIN_OPTIONS.passingThreshold;
  ADMIN_OPTIONS.passingThresholdSaving = true;
  input.disabled = true;
  button.disabled = true;
  state.textContent = "Saving passing threshold…";
  state.classList.remove("is-error");
  try {
    const savedThreshold = await fsSetPassingThreshold(requestedThreshold, schoolYear);
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.passingThreshold = savedThreshold;
    input.value = String(savedThreshold);
    state.textContent = `Saved for ${schoolYear}: grades of ${savedThreshold} or higher pass.`;
  } catch (error) {
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.passingThreshold = previousThreshold;
    input.value = String(previousThreshold);
    state.textContent = `Unable to save passing threshold: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to save passing threshold.", "error");
  } finally {
    ADMIN_OPTIONS.passingThresholdSaving = false;
    if (schoolYear === ADMIN_OPTIONS.selectedYear) {
      input.disabled = false;
      button.disabled = false;
    }
  }
}

export async function loadAdminGradeGrading(schoolYear = ADMIN_OPTIONS.selectedYear) {
  const state = document.getElementById("adminGradingState");
  const gradeSelect = document.getElementById("adminGradingGrade");
  const typeSelect = document.getElementById("adminGradingType");
  const finalGradeToggle = document.getElementById("adminAutomaticFinalGrade");
  const saveButton = document.getElementById("saveGradeGradingBtn");
  if (!state || !gradeSelect || !typeSelect || !saveButton) return;
  const requestId = ++ADMIN_OPTIONS.gradingRequestId;
  [gradeSelect, typeSelect, finalGradeToggle, saveButton].filter(Boolean).forEach((control) => { control.disabled = true; });
  let loaded = false;
  state.classList.remove("is-error");
  state.textContent = schoolYear ? `Loading grading settings for ${schoolYear}…` : "Select a school year to configure grading.";
  if (!schoolYear) {
    ADMIN_OPTIONS.gradingByGrade = {};
    renderAdminGradeGradingEditor();
    return;
  }
  try {
    const result = await fsGetGradeLevelGradingConfigurations(schoolYear);
    if (requestId !== ADMIN_OPTIONS.gradingRequestId) return;
    ADMIN_OPTIONS.gradingByGrade = result.gradeLevels || {};
    state.textContent = `Grading settings loaded for ${schoolYear}. Unconfigured grade levels use Numerical Grade.`;
    renderAdminGradeGradingEditor();
    loaded = true;
  } catch (error) {
    if (requestId !== ADMIN_OPTIONS.gradingRequestId) return;
    state.textContent = `Unable to load grading settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
  } finally {
    if (requestId === ADMIN_OPTIONS.gradingRequestId) {
      [gradeSelect, typeSelect, finalGradeToggle, saveButton].filter(Boolean).forEach((control) => { control.disabled = !loaded; });
      if (loaded) updateAdminLetterScaleVisibility();
    }
  }
}

export function renderAdminGradeGradingEditor() {
  const gradeSelect = document.getElementById("adminGradingGrade");
  const typeSelect = document.getElementById("adminGradingType");
  const finalGradeToggle = document.getElementById("adminAutomaticFinalGrade");
  const rows = document.getElementById("adminLetterScaleRows");
  if (!gradeSelect || !typeSelect || !rows) return;
  if (!gradeSelect.options.length) {
    gradeSelect.innerHTML = CURRICULUM_GRADE_LEVELS.map((grade) => `<option value="${adminOptionEscape(grade)}">${adminOptionEscape(grade)}</option>`).join("");
  }
  const gradeKey = gradeLevelConfigKey(gradeSelect.value || CURRICULUM_GRADE_LEVELS[0]);
  const finalGradeLevelLabel = document.getElementById("adminFinalGradeLevelLabel");
  if (finalGradeLevelLabel) finalGradeLevelLabel.value = gradeSelect.value || CURRICULUM_GRADE_LEVELS[0];
  const configuration = ADMIN_OPTIONS.gradingByGrade[gradeKey] || {
    gradingType: "numerical",
    letterScale: DEFAULT_LETTER_GRADE_SCALE.map((row) => ({ ...row })),
    finalGradeMode: "automatic",
  };
  typeSelect.value = configuration.gradingType === "letter" ? "letter" : "numerical";
  if (finalGradeToggle) finalGradeToggle.checked = configuration.finalGradeMode !== "manual";
  rows.innerHTML = configuration.letterScale.map((row, index) => renderAdminLetterScaleRow(row, index)).join("");
  updateAdminLetterScaleVisibility();
}

function renderAdminLetterScaleRow(row = {}, index) {
  return `<tr>
    <td><input aria-label="Letter grade ${index + 1}" maxlength="8" value="${adminOptionEscape(row.letter || "")}" data-scale-field="letter" /></td>
    <td><input aria-label="Minimum numeric grade for row ${index + 1}" type="number" min="0" max="100" step="0.01" value="${Number.isFinite(Number(row.min)) ? adminOptionEscape(row.min) : ""}" data-scale-field="min" /></td>
    <td><input aria-label="Maximum numeric grade for row ${index + 1}" type="number" min="0" max="100" step="0.01" value="${Number.isFinite(Number(row.max)) ? adminOptionEscape(row.max) : ""}" data-scale-field="max" /></td>
    <td><button class="icon-btn admin-letter-scale-remove" type="button" data-remove-scale-row="${index}" aria-label="Remove letter grade row ${index + 1}" title="Remove row">×</button></td>
  </tr>`;
}

function currentAdminLetterScaleRows() {
  return [...(document.getElementById("adminLetterScaleRows")?.querySelectorAll("tr") || [])].map((row) => ({
    letter: row.querySelector('[data-scale-field="letter"]')?.value || "",
    min: row.querySelector('[data-scale-field="min"]')?.value ?? "",
    max: row.querySelector('[data-scale-field="max"]')?.value ?? "",
  }));
}

export function updateAdminLetterScaleVisibility() {
  const editor = document.getElementById("adminLetterScaleEditor");
  const isLetter = document.getElementById("adminGradingType")?.value === "letter";
  const finalGradeToggle = document.getElementById("adminAutomaticFinalGrade");
  const formula = document.getElementById("adminFinalGradeFormula");
  if (editor) editor.hidden = !isLetter;
  if (finalGradeToggle) finalGradeToggle.disabled = isLetter;
  if (formula) formula.textContent = isLetter
    ? "Automatic Final Grade is only available when this grade level uses Numerical Grade."
    : finalGradeToggle?.checked
      ? "Computes the mean of entered configured terms (for example, (T1 + T2 + T3) / 3)."
      : "Automatic computation is off; teachers enter Final Grade manually.";
}

export function addAdminLetterScaleRow() {
  const rows = currentAdminLetterScaleRows();
  rows.push({ letter: "", min: "", max: "" });
  const container = document.getElementById("adminLetterScaleRows");
  if (container) container.innerHTML = rows.map((row, index) => renderAdminLetterScaleRow(row, index)).join("");
}

export function removeAdminLetterScaleRow(event) {
  const removeButton = event.target.closest("[data-remove-scale-row]");
  if (!removeButton) return;
  const index = Number(removeButton.dataset.removeScaleRow);
  const rows = currentAdminLetterScaleRows();
  rows.splice(index, 1);
  const container = document.getElementById("adminLetterScaleRows");
  if (container) container.innerHTML = rows.map((row, rowIndex) => renderAdminLetterScaleRow(row, rowIndex)).join("");
}

export async function saveAdminGradeGrading() {
  if (ADMIN_OPTIONS.gradingSaving) return;
  const gradeLevel = document.getElementById("adminGradingGrade")?.value || "";
  const gradingType = document.getElementById("adminGradingType")?.value || "";
  const finalGradeMode = document.getElementById("adminAutomaticFinalGrade")?.checked ? "automatic" : "manual";
  const state = document.getElementById("adminGradingState");
  const button = document.getElementById("saveGradeGradingBtn");
  const schoolYear = ADMIN_OPTIONS.selectedYear;
  if (!state || !button || !schoolYear) return;
  const current = ADMIN_OPTIONS.gradingByGrade[gradeLevelConfigKey(gradeLevel)] || {
    letterScale: DEFAULT_LETTER_GRADE_SCALE.map((row) => ({ ...row })),
    finalGradeMode: "automatic",
  };
  const configuration = {
    gradingType,
    letterScale: gradingType === "letter" ? currentAdminLetterScaleRows() : current.letterScale,
    finalGradeMode: gradingType === "letter" ? current.finalGradeMode : finalGradeMode,
  };
  ADMIN_OPTIONS.gradingSaving = true;
  setButtonLoading(button, "Saving…");
  state.classList.remove("is-error");
  state.textContent = `Saving grading settings for ${gradeLevel}…`;
  try {
    const result = await fsSetGradeLevelGradingConfiguration(schoolYear, gradeLevel, configuration);
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.gradingByGrade[result.gradeKey] = result.configuration;
    state.textContent = `Saved for ${schoolYear} · ${gradeLevel}: ${gradingType === "letter" ? "Letter Grade" : "Numerical Grade"}${gradingType === "letter" ? "" : ` · Final Grade ${finalGradeMode === "automatic" ? "computed automatically" : "entered manually"}`}.`;
    renderAdminGradeGradingEditor();
  } catch (error) {
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    state.textContent = `Unable to save grading settings: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to save grade-level grading settings.", "error");
  } finally {
    ADMIN_OPTIONS.gradingSaving = false;
    clearButtonLoading(button);
  }
}

export async function loadAdminStructure() {
  const state = document.getElementById("adminSectionsState");
  try {
    ADMIN_OPTIONS.years = await LPSApi.getSchoolYears();
    ADMIN_OPTIONS.years = (ADMIN_OPTIONS.years || []).filter((year) => /^\d{4}-\d{4}$/.test(String(year.schoolYear || "")));
    const current = ADMIN_OPTIONS.years.find((year) => year.isCurrent) || ADMIN_OPTIONS.years[0];
    ADMIN_OPTIONS.selectedYear = current?.schoolYear || "";
    renderAdminYearSelect();
    await loadAdminSections(ADMIN_OPTIONS.selectedYear);
    void Promise.resolve(LPSApi.refreshPublicStats?.()).catch(() => {});
  } catch (error) {
    if (state) state.innerHTML = `<span class="state-row error">Unable to load school structure: ${adminOptionEscape(error.message)}</span>`;
  }
}

export function renderAdminYearSelect() {
  const select = document.getElementById("adminYearSelect");
  const count = document.getElementById("adminYearCount");
  if (count) {
    count.classList.remove("admin-loading-value");
    count.textContent = `${ADMIN_OPTIONS.years.length} configured`;
  }
  if (!select) return;
  select.innerHTML = ADMIN_OPTIONS.years.length
    ? ADMIN_OPTIONS.years.map((year) => `<option value="${adminOptionEscape(year.schoolYear)}">${adminOptionEscape(year.schoolYear)}${year.isCurrent ? " · Current" : ""}</option>`).join("")
    : `<option value="">No school years</option>`;
  select.value = ADMIN_OPTIONS.selectedYear;
  updateMakeCurrentYearButton();
}

export function updateMakeCurrentYearButton() {
  const button = document.getElementById("makeCurrentYearBtn");
  if (!button) return;
  const currentYear = ADMIN_OPTIONS.years.find((year) => year.isCurrent)?.schoolYear || "";
  const isCurrent = ADMIN_OPTIONS.selectedYear === currentYear;
  button.disabled = !ADMIN_OPTIONS.selectedYear || isCurrent;
  button.title = isCurrent ? "This is already the current school year." : "";
}

export async function loadAdminSections(schoolYear) {
  ADMIN_OPTIONS.selectedYear = schoolYear || "";
  updateMakeCurrentYearButton();
  await Promise.all([
    loadAdminGradeTerms(ADMIN_OPTIONS.selectedYear),
    loadAdminGradeGrading(ADMIN_OPTIONS.selectedYear),
  ]);
  const state = document.getElementById("adminSectionsState");
  const grid = document.getElementById("adminSectionGrid");
  if (!state || !grid) return;
  state.innerHTML = schoolYear ? `<span class="admin-spinner" aria-hidden="true"></span><span>Loading sections for ${adminOptionEscape(schoolYear)}</span>` : "Create a school year to begin.";
  state.className = schoolYear ? "admin-loading-state" : "state-row";
  grid.innerHTML = "";
  try {
    ADMIN_OPTIONS.sections = schoolYear ? await LPSApi.getSections(schoolYear) : [];
    ADMIN_OPTIONS.sections.sort((left, right) => `${adminGradeLabel(left.gradeLevel)} ${left.section}`.localeCompare(`${adminGradeLabel(right.gradeLevel)} ${right.section}`));
    const sectionCount = document.getElementById("adminSectionCount");
    if (sectionCount) {
      sectionCount.classList.remove("admin-loading-value");
      sectionCount.textContent = `${ADMIN_OPTIONS.sections.length} configured`;
    }
    state.textContent = ADMIN_OPTIONS.sections.length ? "" : "No sections configured for this year yet.";
    renderAdminSections();
  } catch (error) {
    state.innerHTML = `<span class="state-row error">Unable to load sections: ${adminOptionEscape(error.message)}</span>`;
  }
  await loadAdminCurricula(schoolYear);
}

export async function loadAdminCurricula(schoolYear) {
  const requestId = ++ADMIN_OPTIONS.curriculumRequestId;
  const gradeSelect = document.getElementById("adminCurriculumGrade");
  const state = document.getElementById("adminCurriculumState");
  if (!gradeSelect || !state) return;
  gradeSelect.innerHTML = CURRICULUM_GRADE_LEVELS.map((grade) => `<option value="${adminOptionEscape(grade)}">${adminOptionEscape(grade)}</option>`).join("");
  gradeSelect.disabled = !schoolYear;
  ADMIN_OPTIONS.curricula = {};
  ADMIN_OPTIONS.curriculumLoadError = false;
  state.textContent = "Loading the shared subject pool…";
  state.className = "admin-curriculum-state";
  try {
    if (typeof LPSApi.getCurriculumSubjectPool !== "function") {
      throw new Error("The shared subject pool requires the Firestore data service.");
    }
    ADMIN_OPTIONS.curriculumSubjects = normalizeCurriculumSubjectPool(await LPSApi.getCurriculumSubjectPool());
    if (requestId !== ADMIN_OPTIONS.curriculumRequestId) return;
    if (!schoolYear) {
      state.textContent = "Pool ready. Create a school year to assign subjects.";
      renderAdminCurriculumEditor();
      return;
    }
    if (typeof LPSApi.getGradeSubjectAssignments !== "function") {
      throw new Error("Curriculum subject settings require the Firestore data service.");
    }
    const result = await LPSApi.getGradeSubjectAssignments(schoolYear);
    if (requestId !== ADMIN_OPTIONS.curriculumRequestId) return;
    ADMIN_OPTIONS.curricula = result?.grades || {};
    ADMIN_OPTIONS.curriculumSubjects = normalizeCurriculumSubjectPool(result?.subjects || ADMIN_OPTIONS.curriculumSubjects);
    state.textContent = "Select subjects from the pool below.";
    renderAdminCurriculumEditor();
  } catch (error) {
    if (requestId !== ADMIN_OPTIONS.curriculumRequestId) return;
    ADMIN_OPTIONS.curriculumLoadError = true;
    state.innerHTML = `Unable to load subject assignments: ${adminOptionEscape(error.message || "Unknown error")} <button class="link-btn" id="retryAdminCurriculumBtn" type="button">Retry</button>`;
    state.classList.add("is-error");
    document.getElementById("retryAdminCurriculumBtn")?.addEventListener("click", () => loadAdminCurricula(ADMIN_OPTIONS.selectedYear));
    renderAdminCurriculumEditor();
  }
}

export function renderAdminCurriculumEditor() {
  const grade = document.getElementById("adminCurriculumGrade")?.value || CURRICULUM_GRADE_LEVELS[0];
  const container = document.getElementById("adminCurriculumSubjects");
  const summary = document.getElementById("adminCurriculumSummary");
  const saveButton = document.getElementById("saveCurriculumSubjectsBtn");
  if (!container || !summary || !saveButton) return;
  const assignment = ADMIN_OPTIONS.curricula[grade];
  const draftKey = adminCurriculumDraftKey(ADMIN_OPTIONS.selectedYear, grade);
  const selectedIds = new Set(normalizeCurriculumSubjectIds(ADMIN_OPTIONS.curriculumDrafts[draftKey] || assignment?.subjectIds || [], ADMIN_OPTIONS.curriculumSubjects));
  container.innerHTML = ADMIN_OPTIONS.curriculumSubjects.map(({ id, label }) => `
    <div class="admin-subject-option">
      <label class="admin-subject-option-label">
        <input type="checkbox" value="${adminOptionEscape(id)}" ${selectedIds.has(id) ? "checked" : ""} ${ADMIN_OPTIONS.curriculumSaving || ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.deletingCurriculumSubject ? "disabled" : ""} />
        <span>${adminOptionEscape(label)}</span>
      </label>
      ${isCustomCurriculumSubjectId(id) ? `<button class="admin-subject-delete" type="button" data-subject-id="${adminOptionEscape(id)}" aria-label="Remove ${adminOptionEscape(label)} from the shared subject pool" title="Remove custom subject" ${ADMIN_OPTIONS.curriculumSaving || ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.deletingCurriculumSubject ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button>` : ""}
    </div>`).join("");
  const isConfigured = assignment?.configured === true;
  const hasDraft = Object.prototype.hasOwnProperty.call(ADMIN_OPTIONS.curriculumDrafts, draftKey);
  summary.textContent = hasDraft
    ? `${selectedIds.size} subject${selectedIds.size === 1 ? "" : "s"} selected for ${grade}. Save to apply.`
    : isConfigured
    ? `${selectedIds.size} subject${selectedIds.size === 1 ? "" : "s"} assigned to ${grade}.`
    : `No subjects assigned to ${grade} yet.`;
  saveButton.disabled = !ADMIN_OPTIONS.selectedYear || ADMIN_OPTIONS.curriculumSaving || ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.deletingCurriculumSubject || ADMIN_OPTIONS.curriculumLoadError;
  container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const checkedIds = [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      ADMIN_OPTIONS.curriculumDrafts[draftKey] = checkedIds;
      const count = checkedIds.length;
      summary.textContent = `${count} subject${count === 1 ? "" : "s"} selected for ${grade}. Save to apply.`;
    });
  });
  container.querySelectorAll(".admin-subject-delete").forEach((button) => {
    button.addEventListener("click", () => void removeAdminCurriculumSubject(button.dataset.subjectId));
  });
}

export async function addAdminCurriculumSubject() {
  if (ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.deletingCurriculumSubject || ADMIN_OPTIONS.curriculumSaving) return;
  const input = document.getElementById("newCurriculumSubjectName");
  const state = document.getElementById("adminCurriculumState");
  const label = String(input?.value || "").trim().replace(/\s+/g, " ");
  if (!label || !state) return;
  if (label.length > 80) {
    state.textContent = "Subject names must be 80 characters or fewer.";
    state.classList.add("is-error");
    return;
  }
  ADMIN_OPTIONS.addingCurriculumSubject = true;
  const button = document.getElementById("addCurriculumSubjectBtn");
  if (button) button.disabled = true;
  renderAdminCurriculumEditor();
  state.textContent = "Adding subject to the shared pool…";
  state.classList.remove("is-error");
  try {
    if (typeof LPSApi.addCurriculumSubject !== "function") {
      throw new Error("Adding shared subjects requires the Firestore data service.");
    }
    const result = await LPSApi.addCurriculumSubject(label);
    ADMIN_OPTIONS.curriculumSubjects = normalizeCurriculumSubjectPool(result?.subjects);
    if (input) input.value = "";
    state.textContent = `Added ${result.subject.label} to the shared pool.`;
    showToast(`${result.subject.label} added to the shared subject pool.`, "success");
    renderAdminCurriculumEditor();
  } catch (error) {
    state.textContent = error.message || "Unable to add subject to the shared pool.";
    state.classList.add("is-error");
    showToast(error.message || "Unable to add subject to the shared pool.", "error");
  } finally {
    ADMIN_OPTIONS.addingCurriculumSubject = false;
    if (button) button.disabled = false;
    renderAdminCurriculumEditor();
  }
}

export async function removeAdminCurriculumSubject(subjectId) {
  if (ADMIN_OPTIONS.deletingCurriculumSubject || ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.curriculumSaving) return;
  const subject = ADMIN_OPTIONS.curriculumSubjects.find(({ id }) => id === subjectId);
  if (!subject || !isCustomCurriculumSubjectId(subjectId)) return;
  if (!window.confirm(`Remove “${subject.label}” from the shared subject pool?\n\nIt will no longer be available for assignment to any grade in this school. Existing learner records will not be deleted.`)) return;

  ADMIN_OPTIONS.deletingCurriculumSubject = true;
  const addButton = document.getElementById("addCurriculumSubjectBtn");
  if (addButton) addButton.disabled = true;
  const state = document.getElementById("adminCurriculumState");
  if (state) {
    state.textContent = `Removing ${subject.label} from the shared subject pool…`;
    state.classList.remove("is-error");
  }
  renderAdminCurriculumEditor();
  try {
    if (typeof LPSApi.removeCurriculumSubject !== "function") {
      throw new Error("Removing shared subjects requires the Firestore data service.");
    }
    await LPSApi.removeCurriculumSubject(subjectId);
    if (state) state.textContent = `${subject.label} was removed from the shared subject pool.`;
    showToast(`${subject.label} removed from the shared subject pool.`, "success");
    await loadAdminCurricula(ADMIN_OPTIONS.selectedYear);
  } catch (error) {
    if (state) {
      state.textContent = error.message || "Unable to remove subject from the shared subject pool.";
      state.classList.add("is-error");
    }
    showToast(error.message || "Unable to remove subject from the shared subject pool.", "error");
  } finally {
    ADMIN_OPTIONS.deletingCurriculumSubject = false;
    if (addButton) addButton.disabled = false;
    renderAdminCurriculumEditor();
  }
}

export async function saveAdminCurriculumSubjects() {
  if (ADMIN_OPTIONS.curriculumSaving || ADMIN_OPTIONS.addingCurriculumSubject || ADMIN_OPTIONS.deletingCurriculumSubject) return;
  const schoolYear = ADMIN_OPTIONS.selectedYear;
  const gradeLevel = document.getElementById("adminCurriculumGrade")?.value;
  const container = document.getElementById("adminCurriculumSubjects");
  const state = document.getElementById("adminCurriculumState");
  if (!schoolYear || !gradeLevel || !container || !state || ADMIN_OPTIONS.curriculumLoadError) return;
  const subjectIds = [...container.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => checkbox.value);
  const button = document.getElementById("saveCurriculumSubjectsBtn");
  ADMIN_OPTIONS.curriculumSaving = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Saving…";
  }
  state.textContent = `Saving ${gradeLevel} subject assignments…`;
  state.classList.remove("is-error");
  renderAdminCurriculumEditor();
  try {
    if (typeof LPSApi.saveGradeSubjectAssignment !== "function") {
      throw new Error("Curriculum subject settings require the Firestore data service.");
    }
    const saved = await LPSApi.saveGradeSubjectAssignment(schoolYear, gradeLevel, subjectIds);
    if (schoolYear !== ADMIN_OPTIONS.selectedYear) return;
    ADMIN_OPTIONS.curricula[gradeLevel] = { configured: true, subjectIds: saved.subjectIds || subjectIds };
    delete ADMIN_OPTIONS.curriculumDrafts[adminCurriculumDraftKey(schoolYear, gradeLevel)];
    state.textContent = `Subject assignments for ${gradeLevel} were saved.`;
    showToast(`Subject assignments for ${gradeLevel} saved.`, "success");
  } catch (error) {
    state.textContent = `Unable to save subject assignments: ${error.message || "Unknown error"}`;
    state.classList.add("is-error");
    showToast(error.message || "Unable to save subject assignments.", "error");
  } finally {
    ADMIN_OPTIONS.curriculumSaving = false;
    if (button) button.textContent = "Save grade subjects";
    renderAdminCurriculumEditor();
  }
}

export function renderAdminSections() {
  const grid = document.getElementById("adminSectionGrid");
  if (!grid) return;
  const groups = new Map();
  ADMIN_OPTIONS.sections.forEach((section) => {
    const grade = adminGradeLabel(section.gradeLevel);
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push(section);
  });
  grid.innerHTML = [...groups.entries()].map(([grade, sections]) => `
    <section class="admin-grade-group">
      <div class="admin-grade-heading"><h4>${adminOptionEscape(grade)}</h4><span>${sections.length} section${sections.length === 1 ? "" : "s"}</span></div>
      <div class="admin-section-list">${sections.map((section) => `
        <div class="admin-section-row">
          <div><strong>${adminOptionEscape(section.section)}</strong><span>${adminOptionEscape(section.adviser || "No teacher assigned")}</span></div>
          <div class="row-actions"><button class="icon-btn" type="button" data-admin-edit-section="${adminOptionEscape(section.id)}" title="Edit section" aria-label="Edit section">${Icon.edit}</button><button class="icon-btn danger" type="button" data-admin-delete-section="${adminOptionEscape(section.id)}" title="Delete section" aria-label="Delete section">${Icon.trash}</button></div>
        </div>`).join("")}</div>
    </section>`).join("");
  grid.querySelectorAll("[data-admin-edit-section]").forEach((button) => button.addEventListener("click", () => openAdminSectionModal(button.dataset.adminEditSection)));
  grid.querySelectorAll("[data-admin-delete-section]").forEach((button) => button.addEventListener("click", () => deleteAdminSection(button.dataset.adminDeleteSection, button)));
}

export function ensureAdminModals() {
  if (document.getElementById("adminYearModalBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="adminYearModalBackdrop"><div class="modal admin-modal">
      <div class="modal-header"><div><span class="eyebrow-label">Academic setup</span><h3>Add school year</h3></div><button class="modal-close" type="button" data-admin-close="adminYearModalBackdrop" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <form id="adminYearForm"><div class="modal-body"><div class="field"><label for="adminYearInput">School year</label><input id="adminYearInput" placeholder="2027-2028" pattern="\\d{4}-\\d{4}" required /><p id="adminYearError" class="admin-year-error" role="alert" hidden></p></div><label class="admin-check"><input id="adminYearCurrent" type="checkbox" /> Make this the current school year</label><p class="field-hint">Only future, consecutive school years can be created. Sections, configured curriculum subjects, teacher assignments, grade terms, and grade-level grading settings copy from the current year as editable starting templates. Teacher assignment history is retained by year.</p></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-admin-close="adminYearModalBackdrop">Cancel</button><button class="btn btn-primary" type="submit">Create school year</button></div></form>
    </div></div>
    <div class="modal-backdrop" id="adminSectionModalBackdrop"><div class="modal admin-modal">
      <div class="modal-header"><div><span class="eyebrow-label">School structure</span><h3 id="adminSectionModalTitle">Add section</h3></div><button class="modal-close" type="button" data-admin-close="adminSectionModalBackdrop" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <form id="adminSectionForm"><div class="modal-body"><div class="field"><label for="adminSectionGrade">Grade level</label><select id="adminSectionGrade" required><option value="Kinder">Kinder</option>${[1, 2, 3, 4, 5, 6].map((grade) => `<option>Grade ${grade}</option>`).join("")}</select></div><div class="field"><label for="adminSectionName">Section name</label><input id="adminSectionName" placeholder="Diamond" required /></div><div class="field"><label for="adminSectionTeacher">Teacher / adviser</label><input id="adminSectionTeacher" placeholder="Full name" /></div></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-admin-close="adminSectionModalBackdrop">Cancel</button><button class="btn btn-primary" type="submit">Save section</button></div></form>
    </div></div>`);
  document.querySelectorAll("[data-admin-close]").forEach((button) => button.addEventListener("click", () => closeAdminModal(button.dataset.adminClose)));
  document.querySelectorAll(".modal-backdrop[id^=admin]").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeAdminModal(backdrop.id); }));
  document.getElementById("adminYearForm").addEventListener("submit", createAdminYear);
  document.getElementById("adminYearInput").addEventListener("input", () => {
    const error = document.getElementById("adminYearError");
    error.hidden = true;
    error.textContent = "";
  });
  document.getElementById("adminSectionForm").addEventListener("submit", saveAdminSection);
}

export function openAdminYearModal() { ensureAdminModals(); document.getElementById("adminYearForm").reset(); document.getElementById("adminYearModalBackdrop").classList.add("is-open"); document.getElementById("adminYearInput").focus(); }
export function closeAdminModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

export async function createAdminYear(event) {
  event.preventDefault();
  const input = document.getElementById("adminYearInput");
  const errorElement = document.getElementById("adminYearError");
  const showYearError = (message) => {
    errorElement.textContent = message;
    errorElement.hidden = false;
  };
  errorElement.hidden = true;
  errorElement.textContent = "";
  const schoolYear = input.value.trim().replace(/[–—/]/g, "-").replace(/\s+/g, "");
  if (!/^\d{4}-\d{4}$/.test(schoolYear)) { showYearError("Use the format YYYY-YYYY."); return; }
  const [startYear, endYear] = schoolYear.split("-").map(Number);
  const latestYear = ADMIN_OPTIONS.years.reduce((latest, year) => {
    const yearStart = Number(String(year.schoolYear || "").slice(0, 4));
    return Number.isFinite(yearStart) ? Math.max(latest, yearStart) : latest;
  }, 0);
  if (endYear !== startYear + 1 || startYear <= latestYear) {
    showYearError(`Enter a future consecutive year after ${ADMIN_OPTIONS.years[0]?.schoolYear || "the latest configured year"}.`);
    return;
  }
  const button = event.submitter;
  setButtonLoading(button, "Creating year…");
  try {
    const currentYear = ADMIN_OPTIONS.years.find((year) => year.isCurrent)?.schoolYear || ADMIN_OPTIONS.years[0]?.schoolYear || "";
    const result = await LPSApi.createSchoolYear(schoolYear, document.getElementById("adminYearCurrent").checked, currentYear);
    const assignmentNotice = result.isCurrent
      ? ` ${result.preservedTeacherAssignments} teacher assignment${result.preservedTeacherAssignments === 1 ? "" : "s"} preserved in year history.`
      : "";
    const copyNotice = [
      result.copiedSections ? `${result.copiedSections} unassigned section templates` : "",
      result.copiedCurriculumGrades ? `${result.copiedCurriculumGrades} curriculum grade configurations` : "",
      result.copiedTeacherAssignments ? `${result.copiedTeacherAssignments} teacher assignment templates` : "",
      "grade-term settings",
      result.copiedGradingLevels ? `${result.copiedGradingLevels} grade-level grading profiles` : "",
    ].filter(Boolean).join(", ");
    showToast(`${schoolYear} created with ${copyNotice}.${assignmentNotice}`, "success");
    closeAdminModal("adminYearModalBackdrop");
    await loadAdminStructure();
  } catch (error) {
    const message = error?.code === "permission-denied" || String(error?.code || "").endsWith("/permission-denied")
      ? "Firestore denied the school-year setup. Sign in with an active School Admin account and deploy the latest firestore.rules to this school's Firebase project."
      : error?.message || "School year could not be created. Check your connection and try again.";
    showYearError(message);
    console.error("Create school year failed", error);
  }
  finally { clearButtonLoading(button); }
}

export function openAdminSectionModal(sectionId = "") {
  ensureAdminModals();
  if (!ADMIN_OPTIONS.selectedYear) { showToast("Create or select a school year first.", "error"); return; }
  const section = ADMIN_OPTIONS.sections.find((item) => item.id === sectionId);
  ADMIN_OPTIONS.editingSection = section || null;
  document.getElementById("adminSectionModalTitle").textContent = section ? "Edit section" : "Add section";
  document.getElementById("adminSectionGrade").value = section?.gradeLevel || "Kinder";
  document.getElementById("adminSectionName").value = section?.section || "";
  document.getElementById("adminSectionTeacher").value = section?.adviser || "";
  document.getElementById("adminSectionModalBackdrop").classList.add("is-open");
  document.getElementById("adminSectionName").focus();
}

export async function saveAdminSection(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button, "Saving section…");
  try {
    await LPSApi.saveSection({ id: ADMIN_OPTIONS.editingSection?.id, schoolYear: ADMIN_OPTIONS.selectedYear, gradeLevel: document.getElementById("adminSectionGrade").value, section: document.getElementById("adminSectionName").value.trim(), adviser: document.getElementById("adminSectionTeacher").value.trim() });
    void Promise.resolve(LPSApi.refreshPublicStats?.()).catch(() => {});
    showToast("Section saved.", "success");
    closeAdminModal("adminSectionModalBackdrop");
    await loadAdminSections(ADMIN_OPTIONS.selectedYear);
  } catch (error) { showToast(error.message || "Section could not be saved.", "error"); }
  finally { clearButtonLoading(button); }
}

export async function deleteAdminSection(sectionId, button) {
  const section = ADMIN_OPTIONS.sections.find((item) => item.id === sectionId);
  if (!section || !window.confirm(`Remove ${section.gradeLevel} · ${section.section}?`)) return;
  setButtonLoading(button, "Removing…");
  try { await LPSApi.deleteSection(sectionId); void Promise.resolve(LPSApi.refreshPublicStats?.()).catch(() => {}); showToast("Section removed.", "success"); await loadAdminSections(ADMIN_OPTIONS.selectedYear); }
  catch (error) { showToast(error.message || "Section could not be removed.", "error"); }
  finally { clearButtonLoading(button); }
}

export async function makeAdminYearCurrent() {
  if (!ADMIN_OPTIONS.selectedYear) return;
  const button = document.getElementById("makeCurrentYearBtn");
  setButtonLoading(button, "Updating…");
  try {
    const result = await LPSApi.setCurrentSchoolYear(ADMIN_OPTIONS.selectedYear);
    showToast(`${ADMIN_OPTIONS.selectedYear} is now current. ${result.preservedTeacherAssignments} teacher assignment${result.preservedTeacherAssignments === 1 ? "" : "s"} preserved in year history.`, "success");
    await loadAdminStructure();
  }
  catch (error) { showToast(error.message || "Current school year could not be changed.", "error"); }
  finally { clearButtonLoading(button); }
}
