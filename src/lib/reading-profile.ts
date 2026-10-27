// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { escapeHtml, renderShell, showToast, startExportIndicator } from './shell';
import { currentUserPreferences, restoreFilterControls, rememberFilterControls } from './preference-runtime';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { APP_CONFIG, appSchoolFilePrefix, paginationPageNumbers } from './app-config';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { debounce } from './learner-list';
import { CRLA_CATEGORIES, initProfileSectionTabs, matchesProfileAssessmentFilters, normalizeProfileGender, normalizeProfileGrade, PHIL_IRI_CATEGORIES, renderProfileDistributionCharts } from './profile-charts';
import { initGraphEnhancements } from './graph-enhancements';
import { compareLearnersBySurname } from './learner-sorting';

export let readingProfiles = [];
export let readingPage = 1;
export let readingSearch = "";
export let readingGrade = "";
export const READING_PAGE_SIZE = 10;
const readingFilterIds = ["readingPeriodFilter", "readingGradeFilter", "readingSexFilter", "readingStatusFilter", "readingSearch"];

export function readingClassificationOptions(grade = "") {
  const normalizedGrade = normalizeProfileGrade(grade);
  if (!normalizedGrade) return [...new Set([...CRLA_CATEGORIES, ...PHIL_IRI_CATEGORIES].map(({ label }) => label))];
  const isCrla = ["grade1", "grade2", "grade3"].includes(normalizedGrade);
  return isCrla
    ? CRLA_CATEGORIES.map(({ label }) => label)
    : PHIL_IRI_CATEGORIES.map(({ label }) => label);
}

export function updateReadingClassificationOptions() {
  const select = document.getElementById("readingStatusFilter");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">All Reading Classifications</option>${readingClassificationOptions(readingGrade).map((value) => `<option>${value}</option>`).join("")}`;
  select.value = readingClassificationOptions(readingGrade).includes(current) ? current : "";
}

export async function initReadingProfiles() {
  renderShell("reading", "Reading Profile");
  initGraphEnhancements();
  initProfileSectionTabs("reading");
  document.getElementById("exportReadingBtn").addEventListener("click", exportReadingExcel);
  updateReadingClassificationOptions();
  ["readingPeriodFilter", "readingGradeFilter", "readingSexFilter", "readingStatusFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", (event) => { if (id === "readingGradeFilter") { readingGrade = event.target.value; updateReadingClassificationOptions(); } readingPage = 1; renderFilteredReading(); }));
  document.getElementById("readingSearch")?.addEventListener("input", debounce((event) => { readingSearch = event.target.value.trim().toLowerCase(); readingPage = 1; renderFilteredReading(); }, 200));
  await initYearSwitcher(loadReadingProfiles);
}

export async function loadReadingProfiles(schoolYear) {
  restoreFilterControls(`reading:${schoolYear}`, readingFilterIds);
  readingSearch = document.getElementById("readingSearch")?.value.trim().toLowerCase() || "";
  readingPage = 1;
  readingGrade = document.getElementById("readingGradeFilter")?.value || "";
  updateReadingClassificationOptions();
  restoreFilterControls(`reading:${schoolYear}`, ["readingStatusFilter"]);
  const body = document.getElementById("readingTableBody");
  if (body) {
    body.innerHTML = `<tr><td colspan="7" class="state-row">Loading reading profiles…</td></tr>`;
  }
  try {
    const records = await LPSApi.getReadingProfiles(schoolYear);
    readingProfiles = records.sort(compareLearnersBySurname);
    renderFilteredReading();
  } catch (error) {
    readingProfiles = [];
    const summary = document.getElementById("readingSummary");
    if (summary) summary.innerHTML = "";
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="state-row error">${escapeHtml(error.message || "Unable to load reading profiles.")}<br><small>Add the CRLA and Phil-IRI BOSY/MOSY/EOSY columns to the selected Learners school-year tab.</small></td></tr>`;
    }
  }
}

export function renderFilteredReading() {
  rememberFilterControls(`reading:${getSelectedSchoolYear()}`, readingFilterIds);
  const period = document.getElementById("readingPeriodFilter")?.value || "";
  const grade = document.getElementById("readingGradeFilter")?.value || "";
  const sex = document.getElementById("readingSexFilter")?.value || "";
  const status = document.getElementById("readingStatusFilter")?.value || "";
  const chartCohort = readingProfiles.filter((record) => { const text = `${record.name || ""} ${record.learnerId || ""} ${record.gradeLevel || ""}`.toLowerCase(); return (!readingSearch || text.includes(readingSearch)) && (!sex || normalizeProfileGender(record.gender) === normalizeProfileGender(sex)); });
  const cohort = chartCohort.filter((record) => !grade || normalizeProfileGrade(record.gradeLevel) === normalizeProfileGrade(grade));
  const records = cohort.filter((record) => matchesProfileAssessmentFilters(record, period, status));
  renderReadingCharts(records);
  renderReadingSummary(records);
  records.sort(compareLearnersBySurname);
  renderReadingTable(records.slice((readingPage - 1) * currentUserPreferences().tablePageSize, readingPage * currentUserPreferences().tablePageSize));
  renderProfilePagination("reading", records.length, readingPage, (page) => { readingPage = page; renderFilteredReading(); });
}

export function renderReadingCharts(records = []) {
  const crlaRecords = records.filter((record) => ["grade1", "grade2", "grade3"].includes(normalizeProfileGrade(record?.gradeLevel)));
  const philIriRecords = records.filter((record) => ["grade4", "grade5", "grade6"].includes(normalizeProfileGrade(record?.gradeLevel)));
  renderProfileDistributionCharts(
    "readingProfileCharts",
    crlaRecords,
    "CRLA",
    CRLA_CATEGORIES,
    ["Grade 1", "Grade 2", "Grade 3"],
    ["Grade 1", "Grade 2", "Grade 3"],
    "Reading",
  );
  renderProfileDistributionCharts(
    "readingProfileChartsPhilIri",
    philIriRecords,
    "Phil-IRI",
    PHIL_IRI_CATEGORIES,
    ["Grade 4", "Grade 5", "Grade 6"],
    ["Grade 4", "Grade 5", "Grade 6"],
    "Reading",
  );
}

export function renderProfilePagination(prefix, total, page, onPageChange) {
  const pageCount = Math.max(1, Math.ceil(total / currentUserPreferences().tablePageSize));
  const info = document.getElementById(prefix + "PageInfo");
  const buttons = document.getElementById(prefix + "PagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(page - 1) * currentUserPreferences().tablePageSize + 1}-${Math.min(page * currentUserPreferences().tablePageSize, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(page, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${page === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === page ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${page === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => onPageChange(button.dataset.page ? Number(button.dataset.page) : index === 0 ? page - 1 : page + 1)); });
}

export function renderReadingSummary(records = []) {
  const summary = document.getElementById("readingSummary");
  if (!summary) return;
  const crla = records.filter((record) => String(record?.reference || "").toUpperCase() === "CRLA").length;
  const philIri = records.filter((record) => String(record?.reference || "").toUpperCase() === "PHILIRI").length;
  const changed = records.filter((record) => String(record?.change || "").toLowerCase() !== "no change recorded").length;
  summary.innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Learners tracked</div>
    <div class="stat-pill"><strong>${crla.toLocaleString()}</strong>CRLA</div>
    <div class="stat-pill"><strong>${philIri.toLocaleString()}</strong>Phil-IRI</div>
    <div class="stat-pill"><strong>${changed.toLocaleString()}</strong>Profile changes</div>`;
}

export function readingMeasure(record, stage) {
  const value = record?.[stage] == null ? "" : String(record[stage]).trim();
  const reference = record?.reference == null ? "" : String(record.reference).trim();
  return `<div class="reading-measure"><strong>${escapeHtml(value || "—")}</strong><span>${escapeHtml(reference || "—")}</span></div>`;
}

export function renderReadingTable(records = []) {
  const body = document.getElementById("readingTableBody");
  if (!body) return;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="7" class="state-row">No reading profiles found.</td></tr>`;
    return;
  }
  body.innerHTML = records.map((record) => `
    <tr><td class="cell-name">${escapeHtml(record?.name || "—")}</td><td>${escapeHtml(record?.gradeLevel || "—")}</td><td>${escapeHtml(record?.gender || "—")}</td>
      <td>${readingMeasure(record, "bosy")}</td><td>${readingMeasure(record, "mosy")}</td><td>${readingMeasure(record, "eosy")}</td><td><strong>${escapeHtml(record?.change || "No change recorded")}</strong></td></tr>`).join("");
}

export async function exportReadingExcel() {
  if (!readingProfiles.length) {
    showToast("There are no reading profiles to export.", "error");
    return;
  }
  const indicator = startExportIndicator("Preparing reading export...", document.getElementById("exportReadingBtn"));
  if (!indicator) return;
  try {
    indicator.update("Building reading workbook...", 45);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
  const year = getSelectedSchoolYear() || "Current";
  const headers = ["Learner ID", "Name", "Grade Level", "Gender", "Reference", "BOSY", "MOSY", "EOSY", "Change"];
  const cell = (value, isLearnerId = false) => `<td${isLearnerId ? " class=\"text-cell\"" : ""}>${escapeHtml(value == null ? "" : String(value))}</td>`;
  const rows = readingProfiles.map((record) => [record?.learnerId || "", record?.name || "", record?.gradeLevel || "", record?.gender || "", record?.reference || "", record?.bosy || "", record?.mosy || "", record?.eosy || "", record?.change || "No change recorded"]);
  const workbook = `<html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial}th,td{border:1px solid #b9c5d9;padding:6px 8px}th{background:#dfeaff}.text-cell{mso-number-format:'\\@';}</style></head><body><h1>${escapeHtml(APP_CONFIG.branding.schoolName)} Reading Profile - ${escapeHtml(year)}</h1><table><tr>${headers.map(cell).join("")}</tr>${rows.map((row) => `<tr>${row.map((value, index) => cell(value, index === 0)).join("")}</tr>`).join("")}</table></body></html>`;
  const url = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${appSchoolFilePrefix()}-reading-profile-${year.replace(/\s+/g, "")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  indicator.finish();
  showToast("Reading profile Excel report downloaded.", "success");
  } catch (error) {
    indicator.close();
    showToast(error.message || "Unable to export reading profile.", "error");
  }
}
