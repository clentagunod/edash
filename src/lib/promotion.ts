// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { APP_CONFIG, canManageLearners, isTeacher } from './app-config';
import { fsGetCardPrintingPreferences, fsGetPromotionConfiguration, fsGetSections } from './firestore-api';
import { collectLearnerCardFields, loadLearnerCardFields } from './learner-card-record';
import { collectDocumentStatusFields, DOCUMENT_STATUS_FIELDS, renderDocumentStatusFields } from './document-status';
import { LPSApi } from './sheets-api';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { appDateInputValue, escapeHtml, renderShell, showToast } from './shell';
import { Icon } from './icons';
import { paginationPageNumbers } from './app-config';
import { debounce } from './learner-list';
import { compareLearnersBySurname, formatLearnerName, formatLearnerNameSurnameFirst } from './learner-sorting';

export let promotionRecords = [];
export let promotionPage = 1;
export const PROMOTION_PAGE_SIZE = 15;
export let promotionTargetYears = [];
export let promotionAccessEnabled = true;
let promotionSections = [];
let promotionRecord = null;
let progressionMode = "promotion";

const PROMOTION_SYSTEM_FIELDS = new Set([
  "learnerId", "name", "gradeLevel", "section", "age", "schoolYear", "dateAdded",
  "enrollmentStatus", "eosyStatus", "transferType", "transferIn", "transferOut",
  "transferSchool", "transferSchoolId", "transferSchoolAddress", "transferSchoolZipCode", "transferDate", "transferReason", "transferNotes",
  "progressionSourceSchoolYear", "progressionType",
  "teacherComments", "attendance", "sf10Email",
  ...DOCUMENT_STATUS_FIELDS,
]);

export async function initPromotion() {
  progressionMode = "promotion";
  await initProgressionPage();
}

export async function initRetention() {
  progressionMode = "retention";
  await initProgressionPage();
}

async function initProgressionPage() {
  const isRetention = progressionMode === "retention";
  const label = isRetention ? "Retention" : "Promotion";
  renderShell(progressionMode, label);
  const notice = document.getElementById("promotionAccessNotice");
  const header = document.querySelector(".page-header h1");
  const description = document.querySelector(".page-header .desc");
  const panelHeader = document.querySelector(".panel-header h3");
  if (header) header.textContent = label;
  if (description) description.textContent = isRetention
    ? "Place retained learners in the same grade in a configured succeeding school year."
    : "Promote learners marked as promoted into a configured succeeding school year.";
  if (panelHeader) panelHeader.textContent = `${isRetention ? "Retained" : "Promoted"} learners`;
  const search = document.getElementById("promotionSearch");
  if (search) search.placeholder = "Search learner or LRN...";
  if (notice) {
    notice.hidden = true;
    notice.classList.remove("is-error");
  }
  promotionRecords = [];
  promotionAccessEnabled = canManageLearners();
  if (!promotionAccessEnabled) {
    notice.hidden = false;
    notice.textContent = `Your account does not have permission to use student ${isRetention ? "retention" : "promotion"}.`;
  }
  if (isTeacher()) {
    try {
      const configuration = await fsGetPromotionConfiguration();
      promotionAccessEnabled = configuration.canPromoteStudents;
      if (!promotionAccessEnabled) {
        notice.hidden = false;
        notice.textContent = `Student ${isRetention ? "retention" : "promotion"} is disabled for teachers. Contact the school administrator to enable it.`;
      }
    } catch (error) {
      promotionAccessEnabled = false;
      notice.hidden = false;
      notice.textContent = `Promotion and retention permission could not be verified: ${error.message || "Unknown error"}`;
      notice.classList.add("is-error");
    }
  }
  try {
    promotionTargetYears = (await LPSApi.getSchoolYears()).filter((year) => /^\d{4}-\d{4}$/.test(year.schoolYear));
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `School-year options could not be loaded: ${error.message || "Unknown error"}`;
    notice.classList.add("is-error");
    promotionTargetYears = [];
  }
  document.getElementById("promotionSearch")?.addEventListener("input", debounce(() => {
    promotionPage = 1;
    renderPromotion();
  }, 200));
  await initYearSwitcher(loadPromotion);
}

export async function loadPromotion(schoolYear) {
  const body = document.getElementById("promotionTableBody");
  if (body) body.innerHTML = `<tr><td colspan="6" class="state-row">Loading ${progressionMode === "retention" ? "retained" : "promoted"} learners…</td></tr>`;
  promotionPage = 1;
  try {
    promotionRecords = await LPSApi.getPromotionCandidates(schoolYear, progressionMode === "retention" ? "Retained" : "Promoted");
    renderPromotion();
  } catch (error) {
    promotionRecords = [];
    if (body) body.innerHTML = `<tr><td colspan="6" class="state-row error">${escapeHtml(error.message || `Unable to load ${progressionMode === "retention" ? "retained" : "promoted"} learners.`)}</td></tr>`;
    renderPromotionSummary([]);
  }
}

export function promotionFilteredRecords(records = promotionRecords) {
  const query = String(document.getElementById("promotionSearch")?.value || "").trim().toLowerCase();
  return records.filter((record) => !query || `${formatLearnerNameSurnameFirst(record)} ${formatLearnerName(record)} ${record.learnerId || ""} ${record.gradeLevel || ""} ${record.section || ""}`.toLowerCase().includes(query))
    .sort(compareLearnersBySurname);
}

export function renderPromotion() {
  const body = document.getElementById("promotionTableBody");
  if (!body) return;
  const records = promotionFilteredRecords();
  renderPromotionSummary(records);
  const resultCount = document.getElementById("promotionResultCount");
  if (resultCount) resultCount.textContent = `${records.length.toLocaleString()} learner${records.length === 1 ? "" : "s"}`;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="6" class="state-row">No ${progressionMode === "retention" ? "retained" : "promoted"} learners found for this school year.</td></tr>`;
    renderPromotionPagination(0);
    return;
  }
  const pageCount = Math.max(1, Math.ceil(records.length / PROMOTION_PAGE_SIZE));
  promotionPage = Math.min(promotionPage, pageCount);
  const pageRecords = records.slice((promotionPage - 1) * PROMOTION_PAGE_SIZE, promotionPage * PROMOTION_PAGE_SIZE);
  body.innerHTML = pageRecords.map((record) => `
    <tr>
      <td>${escapeHtml(record.learnerId || "—")}</td>
      <td class="cell-name">${escapeHtml(formatLearnerNameSurnameFirst(record, "—"))}</td>
      <td>${escapeHtml([record.gradeLevel, record.section].filter(Boolean).join(" · ") || "—")}</td>
      <td>${escapeHtml(record.age ?? "—")}</td>
      <td><strong>${escapeHtml(record.eosyStatus || (progressionMode === "retention" ? "Retained" : "Promoted"))}</strong></td>
      <td><button class="icon-btn" type="button" title="${progressionMode === "retention" ? "Place in succeeding school year" : "Add to succeeding school year"}" aria-label="${progressionMode === "retention" ? "Place learner in succeeding school year" : "Add learner to succeeding school year"}" data-promotion-select="${escapeHtml(record.learnerId)}" ${promotionAccessEnabled ? "" : "disabled"}>${Icon.arrowRight}</button></td>
    </tr>`).join("");
  body.querySelectorAll("[data-promotion-select]").forEach((button) => button.addEventListener("click", () => {
    const record = promotionRecords.find((item) => item.learnerId === button.dataset.promotionSelect);
    if (record) void openPromotionForm(record);
  }));
  renderPromotionPagination(records.length, pageCount);
}

export function renderPromotionSummary(records = []) {
  const summary = document.getElementById("promotionSummary");
  if (summary) summary.innerHTML = `<div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>${progressionMode === "retention" ? "Retained learners" : "Promoted learners"}</div>`;
}

export function renderPromotionPagination(total, pageCount = Math.max(1, Math.ceil(total / PROMOTION_PAGE_SIZE))) {
  const info = document.getElementById("promotionPageInfo");
  const buttons = document.getElementById("promotionPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(promotionPage - 1) * PROMOTION_PAGE_SIZE + 1}-${Math.min(promotionPage * PROMOTION_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pages = paginationPageNumbers(promotionPage, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${promotionPage === 1 ? "disabled" : ""}>‹</button>${pages.map((page) => `<button type="button" class="${page === promotionPage ? "is-active" : ""}" data-page="${page}">${page}</button>`).join("")}<button type="button" aria-label="Next page" ${promotionPage === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => {
    if (!button.disabled) button.addEventListener("click", () => {
      promotionPage = button.dataset.page ? Number(button.dataset.page) : index === 0 ? promotionPage - 1 : promotionPage + 1;
      renderPromotion();
    });
  });
}

export async function openPromotionForm(record) {
  const sourceYear = getSelectedSchoolYear();
  const sourceStartYear = Number(sourceYear.slice(0, 4));
  const laterYears = promotionTargetYears
    .map((year) => year.schoolYear)
    .filter((year) => Number(year.slice(0, 4)) > sourceStartYear)
    .sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));
  if (!laterYears.length) {
    showToast(`Create and configure a succeeding school year before ${progressionMode === "retention" ? "placing retained learners" : "promoting learners"}.`, "error");
    return;
  }

  promotionRecord = record;
  ensurePromotionModal();
  const targetYear = laterYears[0];
  const yearSelect = document.getElementById("promotionTargetYear");
  yearSelect.innerHTML = laterYears.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
  document.getElementById("promotionLearnerName").textContent = formatLearnerName(record, "Learner");
  document.getElementById("promotionLearnerId").textContent = record.learnerId || "";
  renderPromotionEditableFields(record);
  const cardFieldsRequest = loadLearnerCardFields(document.getElementById("promotionCardFields"), record, fsGetCardPrintingPreferences);
  renderDocumentStatusFields(document.getElementById('promotionDocumentFields'), {}, 'promotion');
  yearSelect.value = targetYear;
  await loadPromotionTargetStructure(targetYear, record);
  await cardFieldsRequest;
  const gradeLabel = document.querySelector('label[for="promotionGradeLevel"]');
  if (gradeLabel) gradeLabel.textContent = progressionMode === "retention" ? "Current grade (locked)" : "Target grade";
  document.getElementById("promotionModalTitle").textContent = progressionMode === "retention" ? "Retain learner" : "Promote learner";
  document.getElementById("promotionSubmit").textContent = progressionMode === "retention" ? "Retain learner" : "Promote learner";
  document.getElementById("promotionModalBackdrop").classList.add("is-open");
}

function ensurePromotionModal() {
  if (document.getElementById("promotionModalBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="promotionModalBackdrop">
      <div class="modal promotion-modal" role="dialog" aria-modal="true" aria-labelledby="promotionModalTitle">
        <div class="modal-header"><h3 id="promotionModalTitle">Promote learner</h3><button class="modal-close" type="button" id="promotionModalClose" aria-label="Close">×</button></div>
        <form id="promotionForm">
          <div class="modal-body">
            <div class="promotion-learner-heading"><strong id="promotionLearnerName"></strong><span id="promotionLearnerId"></span></div>
            <p id="promotionStructureNotice" class="form-alert" role="status" hidden></p>
            <div class="field-grid">
              <div class="field"><label for="promotionTargetYear">Succeeding school year</label><select id="promotionTargetYear" required></select></div>
              <div class="field"><label for="promotionGradeLevel">Target grade</label><select id="promotionGradeLevel" required></select></div>
              <div class="field"><label for="promotionSection">Target section</label><select id="promotionSection" required></select></div>
              <div class="field"><label for="promotionAge">Age</label><input id="promotionAge" type="number" min="0" max="120" step="1" required /></div>
            </div>
            <details class="promotion-details">
              <summary>Review or update learner details</summary>
              <p class="field-hint">The source-year record remains unchanged. Updates entered here apply only to the succeeding-year record.</p>
              <div class="field-grid" id="promotionEditableFields"></div>
            </details>
            <div class="promotion-details">
              <p class="field-hint">Teacher Comments and attendance are copied from the source year. Review or clear them for the succeeding school year before proceeding.</p>
              <div id="promotionCardFields"></div>
            </div>
            <div class="promotion-details" id="promotionDocumentFields"></div>
          </div>
          <div class="modal-footer"><button class="btn btn-secondary" type="button" id="promotionModalCancel">Cancel</button><button class="btn btn-primary" type="submit" id="promotionSubmit">Promote learner</button></div>
        </form>
      </div>
    </div>`);

  const close = () => document.getElementById("promotionModalBackdrop").classList.remove("is-open");
  document.getElementById("promotionModalClose").addEventListener("click", close);
  document.getElementById("promotionModalCancel").addEventListener("click", close);
  document.getElementById("promotionModalBackdrop").addEventListener("click", (event) => {
    if (event.target.id === "promotionModalBackdrop") close();
  });
  document.getElementById("promotionTargetYear").addEventListener("change", (event) => {
    void loadPromotionTargetStructure(event.currentTarget.value, promotionRecord);
  });
  document.getElementById("promotionGradeLevel").addEventListener("change", renderPromotionSectionOptions);
  document.getElementById("promotionForm").addEventListener("submit", submitPromotion);
}

function renderPromotionEditableFields(record) {
  const fieldsContainer = document.getElementById("promotionEditableFields");
  const fields = [...new Set([
    ...APP_CONFIG.firestore.learnerFields,
    ...Object.keys(record || {}),
  ])].filter((field) => !PROMOTION_SYSTEM_FIELDS.has(field));
  document.getElementById("promotionAge").value = record.age ?? "";
  fieldsContainer.innerHTML = fields.map((field) => {
    const value = field === "extra" ? (record.extra || {}) : record[field];
    const label = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^\w/, (letter) => letter.toUpperCase());
    const fieldId = `promotionField_${field.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    if (typeof value === "boolean") {
      return `<div class="field promotion-check-field"><label for="${escapeHtml(fieldId)}">${escapeHtml(label)}</label><input id="${escapeHtml(fieldId)}" data-promotion-field="${escapeHtml(field)}" type="checkbox" ${value ? "checked" : ""} /></div>`;
    }
    if (field.toLowerCase().includes("date")) {
      return `<div class="field"><label for="${escapeHtml(fieldId)}">${escapeHtml(label)}</label><input id="${escapeHtml(fieldId)}" data-promotion-field="${escapeHtml(field)}" type="date" value="${escapeHtml(appDateInputValue(value))}" /></div>`;
    }
    if (value && typeof value === "object") {
      const serialized = JSON.stringify(value);
      return `<div class="field span-2"><label for="${escapeHtml(fieldId)}">${escapeHtml(label)} (JSON)</label><textarea id="${escapeHtml(fieldId)}" data-promotion-field="${escapeHtml(field)}" data-promotion-json="true" rows="3">${escapeHtml(serialized)}</textarea></div>`;
    }
    const type = typeof value === "number" ? "number" : "text";
    const inputValue = value ?? "";
    return `<div class="field"><label for="${escapeHtml(fieldId)}">${escapeHtml(label)}</label><input id="${escapeHtml(fieldId)}" data-promotion-field="${escapeHtml(field)}" type="${type}" value="${escapeHtml(inputValue)}" /></div>`;
  }).join("");
}

async function loadPromotionTargetStructure(schoolYear, record) {
  const notice = document.getElementById("promotionStructureNotice");
  const gradeSelect = document.getElementById("promotionGradeLevel");
  const sectionSelect = document.getElementById("promotionSection");
  notice.hidden = true;
  gradeSelect.disabled = true;
  sectionSelect.disabled = true;
  try {
    promotionSections = await fsGetSections(schoolYear);
    const gradeLevels = [...new Set(promotionSections.map((section) => String(section.gradeLevel || "").trim()).filter(Boolean))];
    if (!gradeLevels.length) {
      notice.hidden = false;
      notice.textContent = `${schoolYear} has no configured grade and section structure. Ask an administrator to configure the school year first.`;
      gradeSelect.innerHTML = `<option value="">No configured grades</option>`;
      sectionSelect.innerHTML = `<option value="">No configured sections</option>`;
      return;
    }
    const suggestedGrade = suggestedPromotionGrade(record.gradeLevel);
    const retainedGrade = gradeLevels.find((grade) => normalizeGrade(grade) === normalizeGrade(record.gradeLevel));
    const selectedGrade = progressionMode === "retention"
      ? retainedGrade || ""
      : gradeLevels.includes(record.gradeLevel) ? record.gradeLevel
        : gradeLevels.includes(suggestedGrade) ? suggestedGrade : gradeLevels[0];
    gradeSelect.innerHTML = gradeLevels.map((grade) => `<option value="${escapeHtml(grade)}">${escapeHtml(grade)}</option>`).join("");
    if (selectedGrade) gradeSelect.value = selectedGrade;
    if (progressionMode === "retention" && !retainedGrade) {
      notice.hidden = false;
      notice.textContent = `The learner's current grade (${record.gradeLevel || "unknown"}) is not configured in ${schoolYear}. Configure that grade before assigning a section.`;
      gradeSelect.innerHTML = `<option value="">Current grade is not configured</option>`;
    }
    gradeSelect.disabled = progressionMode === "retention" || !selectedGrade;
    renderPromotionSectionOptions(record.section);
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `Unable to load target-year structure: ${error.message || "Unknown error"}`;
    notice.classList.add("is-error");
  }
}

function normalizeGrade(value) {
  const grade = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (["kinder", "kindergarten", "kg", "0"].includes(grade)) return "kinder";
  const match = grade.match(/^grade\s*(\d+)$/) || grade.match(/^(\d+)$/);
  return match ? `grade ${Number(match[1])}` : grade;
}

function suggestedPromotionGrade(value) {
  const grade = String(value || "").trim();
  if (/^kinder$/i.test(grade)) return "Grade 1";
  const match = grade.match(/^Grade\s+(\d+)$/i);
  return match ? `Grade ${Number(match[1]) + 1}` : "";
}

function renderPromotionSectionOptions(suggestedSection = "") {
  const grade = document.getElementById("promotionGradeLevel").value;
  const select = document.getElementById("promotionSection");
  const sections = promotionSections.filter((section) => normalizeGrade(section.gradeLevel) === normalizeGrade(grade));
  select.innerHTML = sections.length
    ? sections.map((section) => `<option value="${escapeHtml(section.section)}">${escapeHtml(section.section)}</option>`).join("")
    : `<option value="">No configured sections</option>`;
  if (sections.length && sections.some((section) => section.section === suggestedSection)) select.value = suggestedSection;
  select.disabled = !sections.length;
}

async function submitPromotion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!promotionRecord || !form.reportValidity()) return;
  const button = document.getElementById("promotionSubmit");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = progressionMode === "retention" ? "Retaining…" : "Promoting…";
  try {
    const updatedLearner = { ...promotionRecord, age: Number(document.getElementById("promotionAge").value) };
    document.querySelectorAll("[data-promotion-field]").forEach((input) => {
      const field = input.dataset.promotionField;
      if (input.type === "checkbox") updatedLearner[field] = input.checked;
      else if (input.dataset.promotionJson === "true") updatedLearner[field] = JSON.parse(input.value || "{}");
      else if (input.type === "number") updatedLearner[field] = input.value === "" ? "" : Number(input.value);
      else updatedLearner[field] = input.value;
    });
    Object.assign(updatedLearner, collectLearnerCardFields(document.getElementById("promotionCardFields")));
    Object.assign(updatedLearner, collectDocumentStatusFields(document.getElementById('promotionDocumentFields')));
    updatedLearner.gradeLevel = progressionMode === "retention"
      ? promotionRecord.gradeLevel
      : document.getElementById("promotionGradeLevel").value;
    updatedLearner.section = document.getElementById("promotionSection").value;
    await LPSApi.promoteLearner(getSelectedSchoolYear(), document.getElementById("promotionTargetYear").value, promotionRecord.learnerId, updatedLearner, progressionMode);
    document.getElementById("promotionModalBackdrop").classList.remove("is-open");
    showToast(`${formatLearnerName(promotionRecord)} was ${progressionMode === "retention" ? "retained in" : "promoted to"} ${updatedLearner.gradeLevel} · ${updatedLearner.section}.`, "success");
    await loadPromotion(getSelectedSchoolYear());
  } catch (error) {
    showToast(error.message || `Learner ${progressionMode} failed.`, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}
