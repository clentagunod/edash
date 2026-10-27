// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { escapeHtml, renderShell, showToast, startExportIndicator } from './shell';
import { currentUserPreferences, restoreFilterControls, rememberFilterControls } from './preference-runtime';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { APP_CONFIG, appSchoolFilePrefix, paginationPageNumbers } from './app-config';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { debounce } from './learner-list';
import { isTeacher } from './app-config';
import { initProfileSectionTabs } from './profile-charts';
import { renderNutritionCharts } from './nutrition-charts';
import { initGraphEnhancements } from './graph-enhancements';
import { compareLearnersBySurname } from './learner-sorting';

export let nutritionRecords = [];
export let nutritionPage = 1;
export let nutritionSearch = "";
export const PROFILE_PAGE_SIZE = 10;
const nutritionFilterIds = ["nutritionPeriodFilter", "nutritionGradeFilter", "nutritionSexFilter", "nutritionStatusFilter", "nutritionSearch"];

export async function initNutritionPage() {
  renderShell("nutrition", "Nutritional Status");
  nutritionSearch = "";
  initProfileSectionTabs("nutrition");
  initGraphEnhancements();
  const search = document.getElementById("nutritionSearch");
  if (search) search.value = "";
  document.getElementById("exportNutritionBtn").addEventListener("click", exportNutritionExcel);
  const gradeFilter = document.getElementById("nutritionGradeFilter");
  if (isTeacher()) gradeFilter?.remove();
  ["nutritionPeriodFilter", "nutritionSexFilter", "nutritionStatusFilter", "nutritionGradeFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => { nutritionPage = 1; renderFilteredNutrition(); }));
  document.getElementById("nutritionSearch")?.addEventListener("input", debounce((event) => { nutritionSearch = event.target.value.trim().toLowerCase(); nutritionPage = 1; renderFilteredNutrition(); }, 200));
  await initYearSwitcher(loadNutritionStatus);
}

export async function loadNutritionStatus(schoolYear) {
  restoreFilterControls(`nutrition:${schoolYear}`, nutritionFilterIds);
  nutritionSearch = document.getElementById('nutritionSearch')?.value.trim().toLowerCase() || '';
  nutritionPage = 1;
  const table = document.getElementById("nutritionTableBody");
  const summary = document.getElementById("nutritionSummary");
  table.innerHTML = `<tr><td colspan="6" class="state-row">Loading nutritional records…</td></tr>`;
  try {
    const records = await LPSApi.getNutritionStatus(schoolYear);
    nutritionRecords = records.sort(compareLearnersBySurname);
    renderFilteredNutrition();
  } catch (error) {
    nutritionRecords = [];
    summary.innerHTML = "";
    renderNutritionCharts([]);
    table.innerHTML = `<tr><td colspan="6" class="state-row error">${escapeHtml(error.message)}<br><small>Add the nutritional headers to the selected Learners school-year tab.</small></td></tr>`;
  }
}

export function renderFilteredNutrition() {
  rememberFilterControls(`nutrition:${getSelectedSchoolYear()}`, nutritionFilterIds);
  const period = document.getElementById("nutritionPeriodFilter")?.value || "";
  const sex = document.getElementById("nutritionSexFilter")?.value || "";
  const status = document.getElementById("nutritionStatusFilter")?.value || "";
  const grade = document.getElementById("nutritionGradeFilter")?.value || "";
  const records = nutritionRecords.filter((record) => {
    const text = `${record.name || ""} ${record.learnerId || ""} ${record.gender || ""}`.toLowerCase();
    const hasSelectedStatus = !status || (period
      ? record[period + "NutritionalStatus"] === status
      : ["bosy", "mosy", "eosy"].some((key) => record[key + "NutritionalStatus"] === status));
    return (!nutritionSearch || text.includes(nutritionSearch)) && (!grade || record.gradeLevel === grade) && (!sex || record.gender === sex) && (!period || record[period + "NutritionalStatus"]) && hasSelectedStatus;
  }).sort(compareLearnersBySurname);
  renderNutritionSummary(records);
  renderNutritionCharts(records);
  renderNutritionTable(records.slice((nutritionPage - 1) * currentUserPreferences().tablePageSize, nutritionPage * currentUserPreferences().tablePageSize));
  renderProfilePagination("nutrition", records.length, nutritionPage, (page) => { nutritionPage = page; renderFilteredNutrition(); });
}

export function renderProfilePagination(prefix, total, page, onPageChange) {
  const pageCount = Math.max(1, Math.ceil(total / currentUserPreferences().tablePageSize));
  const info = document.getElementById(prefix + "PageInfo");
  const buttons = document.getElementById(prefix + "PagerBtns");
  if (!info || !buttons) return;
  const start = total ? (page - 1) * currentUserPreferences().tablePageSize + 1 : 0;
  info.textContent = total ? `${start}-${Math.min(page * currentUserPreferences().tablePageSize, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(page, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${page === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === page ? "is-active" : ""}" data-page="${value}" ${value === page ? "aria-current=\"page\"" : ""}>${value}</button>`).join("")}<button type="button" aria-label="Next page" ${page === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => onPageChange(button.dataset.page ? Number(button.dataset.page) : index === 0 ? page - 1 : page + 1)); });
}

export function renderNutritionSummary(records) {
  const endlineComplete = records.filter((record) => record.eosyNutritionalStatus).length;
  const changed = records.filter((record) => record.statusChange !== "No change recorded").length;
  const male = records.filter((record) => record.gender === "Male").length;
  const female = records.filter((record) => record.gender === "Female").length;
  document.getElementById("nutritionSummary").innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Learners tracked</div>
    <div class="stat-pill"><strong>${male.toLocaleString()}</strong>Male</div>
    <div class="stat-pill"><strong>${female.toLocaleString()}</strong>Female</div>
    <div class="stat-pill"><strong>${endlineComplete.toLocaleString()}</strong>Endline recorded</div>
    <div class="stat-pill"><strong>${changed.toLocaleString()}</strong>Status changes</div>`;
}

export function nutritionMeasure(record, period) {
  const height = record[period + "Height"];
  const weight = record[period + "Weight"];
  const bmi = record[period + "Bmi"];
  const status = record[period + "NutritionalStatus"];
  const heightMeters = height == null ? "—" : (height / 100).toFixed(2);
  return `<div class="nutrition-measure"><strong>${escapeHtml(status || "—")}</strong><span>${heightMeters} m / ${weight || "—"} kg${bmi ? ` · BMI ${bmi}` : ""}</span></div>`;
}

export function renderNutritionTable(records) {
  const body = document.getElementById("nutritionTableBody");
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="6" class="state-row">No nutritional records found.</td></tr>`;
    return;
  }
  body.innerHTML = records.map((record) => `
    <tr><td class="cell-name">${escapeHtml(record.name)}</td><td>${escapeHtml(record.gender || "—")}</td>
      <td>${nutritionMeasure(record, "bosy")}</td><td>${nutritionMeasure(record, "mosy")}</td><td>${nutritionMeasure(record, "eosy")}</td>
      <td><strong>${escapeHtml(record.statusChange)}</strong><small class="nutrition-delta">${record.heightChange == null ? "" : `Height ${record.heightChange >= 0 ? "+" : ""}${(record.heightChange / 100).toFixed(2)} m`}${record.weightChange == null ? "" : ` · Weight ${record.weightChange >= 0 ? "+" : ""}${record.weightChange} kg`}</small></td></tr>`).join("");
}

export async function exportNutritionExcel() {
  if (!nutritionRecords.length) {
    showToast("There are no nutritional records to export.", "error");
    return;
  }
  const indicator = startExportIndicator("Preparing nutrition export...", document.getElementById("exportNutritionBtn"));
  if (!indicator) return;
  try {
    indicator.update("Building nutrition workbook...", 45);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
  const yearLabel = getSelectedSchoolYear() || "Current";
  const headers = ["Name", "Gender", "Baseline Height (m)", "Baseline Weight (kg)", "Baseline BMI", "Baseline Status", "Midline Height (m)", "Midline Weight (kg)", "Midline BMI", "Midline Status", "Endline Height (m)", "Endline Weight (kg)", "Endline BMI", "Endline Status", "Height Change (m)", "Weight Change (kg)", "Status Change"];
  const rows = nutritionRecords.map((record) => [record.name, record.gender, record.bosyHeight == null ? "" : record.bosyHeight / 100, record.bosyWeight, record.bosyBmi, record.bosyNutritionalStatus, record.mosyHeight == null ? "" : record.mosyHeight / 100, record.mosyWeight, record.mosyBmi, record.mosyNutritionalStatus, record.eosyHeight == null ? "" : record.eosyHeight / 100, record.eosyWeight, record.eosyBmi, record.eosyNutritionalStatus, record.heightChange == null ? "" : record.heightChange / 100, record.weightChange, record.statusChange]);
  const cell = (value) => `<td>${escapeHtml(value == null ? "" : value)}</td>`;
  const workbook = `<html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial}th,td{border:1px solid #b9c5d9;padding:6px 8px}th{background:#dfeaff}</style></head><body><h1>${escapeHtml(APP_CONFIG.branding.schoolName)} Nutritional Status - ${escapeHtml(yearLabel)}</h1><table><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>${rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("")}</table></body></html>`;
  const url = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${appSchoolFilePrefix()}-nutritional-status-${yearLabel.replace(/\s+/g, "")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  indicator.finish();
  showToast("Nutrition Excel report downloaded.", "success");
  } catch (error) {
    indicator.close();
    showToast(error.message || "Unable to export nutrition report.", "error");
  }
}
