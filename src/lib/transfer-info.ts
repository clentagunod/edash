// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { Icon } from './icons';
import { escapeHtml, formatAppDate, renderShell } from './shell';
import { debounce } from './learner-list';
import { cancelLearnerMovement, deleteArchiveRecord, openArchiveEditor } from './archive-editor';
import { compareLearnersBySurname, formatLearnerNameSurnameFirst } from './learner-sorting';
import { paginationPageNumbers } from './app-config';
import { documentStatusLabel } from './document-status';

export let transferRecords = [];
export let transferSearch = "";
export let transferPage = 1;
export const TRANSFER_PAGE_SIZE = 15;

export async function initTransferInfo() {
  renderShell("transfer-info", "Transfer Info");
  ["transferTypeFilter", "transferGradeFilter", "transferGenderFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => { transferPage = 1; loadTransferInfo(getSelectedSchoolYear()); }));
  document.getElementById("transferSearch")?.addEventListener("input", debounce((event) => { transferSearch = event.target.value.trim().toLowerCase(); transferPage = 1; renderTransferTable(filterTransferRecords(transferRecords)); }, 200));
  await initYearSwitcher(loadTransferInfo);
}

export async function loadTransferInfo(schoolYear) {
  const body = document.getElementById("transferTableBody");
  if (body) {
    body.innerHTML = `<tr><td colspan="10" class="state-row">Loading transfer records…</td></tr>`; // Loading message
  }
  transferPage = 1;
  try {
    const records = await LPSApi.getTransferRecords(schoolYear, document.getElementById("transferTypeFilter")?.value || "all", document.getElementById("transferGradeFilter")?.value || "", document.getElementById("transferGenderFilter")?.value || "");
    transferRecords = records;
    renderTransferSummary(transferRecords);
    renderTransferTable(filterTransferRecords(transferRecords));
  } catch (error) {
    transferRecords = [];
    const summary = document.getElementById("transferSummary");
    if (summary) summary.innerHTML = "";
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="state-row error">${escapeHtml(error.message || "Unable to load transfer records.")}<br><small>Transfer records are stored in Firestore for the selected school year.</small></td></tr>`;
    }
  }
}

export function filterTransferRecords(records) {
  return records.filter((record) => !transferSearch || `${formatLearnerNameSurnameFirst(record)} ${record.learnerId || ""} ${record.gradeLevel || ""} ${record.transferSchool || ""}`.toLowerCase().includes(transferSearch))
    .sort(compareLearnersBySurname);
}

export function renderTransferSummary(records = []) {
  const summary = document.getElementById("transferSummary");
  if (!summary) return;
  const inCount = records.filter((record) => record.transferType === "Transfer In").length;
  const outCount = records.filter((record) => record.transferType === "Transfer Out").length;
  summary.innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Total transfers</div>
    <div class="stat-pill"><strong>${inCount.toLocaleString()}</strong>Transfer In</div>
    <div class="stat-pill"><strong>${outCount.toLocaleString()}</strong>Transfer Out</div>`;
}

export function renderTransferTable(records = []) {
  const body = document.getElementById("transferTableBody");
  if (!body) return;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="10" class="state-row">No transfer records found.</td></tr>`;
    renderTransferPagination(0);
    return;
  }
  const pageCount = Math.max(1, Math.ceil(records.length / TRANSFER_PAGE_SIZE));
  transferPage = Math.min(transferPage, pageCount);
  const pageRecords = records.slice((transferPage - 1) * TRANSFER_PAGE_SIZE, transferPage * TRANSFER_PAGE_SIZE);

  body.innerHTML = pageRecords.map((record) => `
    <tr>
      <td>${escapeHtml(record?.learnerId || "—")}</td>
      <td class="cell-name">${escapeHtml(formatLearnerNameSurnameFirst(record, "—"))}</td>
      <td>${escapeHtml(record?.gradeLevel || "—")}</td>
      <td>${escapeHtml(record?.gender || "—")}</td>
      <td><strong>${escapeHtml(record?.transferType || "—")}</strong></td>
      <td>${escapeHtml(record?.transferSchool || "—")}</td>
      <td>${escapeHtml(formatAppDate(record?.transferDate))}</td>
      <td>${escapeHtml(record?.transferReason || "—")}</td>
      <td>${escapeHtml(documentStatusLabel(record))}</td>
      <td><div class="row-actions"><button class="icon-btn" type="button" title="Edit" aria-label="Edit transfer record" data-transfer-edit="${escapeHtml(record.learnerId)}" data-transfer-type="${escapeHtml(record.transferType)}">${Icon.edit}</button><button class="icon-btn" type="button" title="Cancel transfer and return to masterlist" aria-label="Cancel transfer and return to masterlist" data-transfer-cancel="${escapeHtml(record.learnerId)}" data-transfer-type="${escapeHtml(record.transferType)}">${Icon.x}</button><button class="icon-btn danger" type="button" title="Delete" aria-label="Delete" data-transfer-delete="${escapeHtml(record.learnerId)}">${Icon.trash}</button></div></td>
    </tr>
  `).join("");
  body.querySelectorAll("[data-transfer-edit]").forEach((button) => button.addEventListener("click", () => {
    const record = transferRecords.find((item) => item.learnerId === button.dataset.transferEdit && item.transferType === button.dataset.transferType);
    if (record) {
      const archive = record.transferType === "Transfer In" ? "learners" : "transferredOut";
      openArchiveEditor(archive, getSelectedSchoolYear(), record, () => loadTransferInfo(getSelectedSchoolYear()));
    }
  }));
  body.querySelectorAll("[data-transfer-delete]").forEach((button) => button.addEventListener("click", () => { const record = transferRecords.find((item) => item.learnerId === button.dataset.transferDelete); if (record) deleteArchiveRecord(record.transferType === "Transfer In" ? "learners" : "transferredOut", getSelectedSchoolYear(), record, () => loadTransferInfo(getSelectedSchoolYear())); }));
  body.querySelectorAll("[data-transfer-cancel]").forEach((button) => button.addEventListener("click", () => {
    const record = transferRecords.find((item) => item.learnerId === button.dataset.transferCancel && item.transferType === button.dataset.transferType);
    if (record) cancelLearnerMovement(record.transferType === "Transfer In" ? "learners" : "transferredOut", getSelectedSchoolYear(), record, () => loadTransferInfo(getSelectedSchoolYear()), button);
  }));
  renderTransferPagination(records.length, pageCount);
}

export function renderTransferPagination(total, pageCount = Math.max(1, Math.ceil(total / TRANSFER_PAGE_SIZE))) {
  const info = document.getElementById("transferPageInfo");
  const buttons = document.getElementById("transferPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(transferPage - 1) * TRANSFER_PAGE_SIZE + 1}-${Math.min(transferPage * TRANSFER_PAGE_SIZE, total)} of ${total}` : "0 transfers";
  const pages = paginationPageNumbers(transferPage, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${transferPage === 1 ? "disabled" : ""}>‹</button>${pages.map((page) => `<button type="button" class="${page === transferPage ? "is-active" : ""}" data-page="${page}">${page}</button>`).join("")}<button type="button" aria-label="Next page" ${transferPage === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => {
    if (!button.disabled) button.addEventListener("click", () => {
      transferPage = button.dataset.page ? Number(button.dataset.page) : index === 0 ? transferPage - 1 : transferPage + 1;
      renderTransferTable(filterTransferRecords(transferRecords));
    });
  });
}
