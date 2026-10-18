// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { isSchoolAdmin } from './app-config';
import { requireAuth } from './auth';
import { APP_CONFIG } from './app-config';
import { appPageHref, escapeHtml, renderShell } from './shell';

export let auditRecords = [];
const AUDIT_PAGE_SIZE = 10;
let currentPage = 1;
let totalPages = 0;
let totalRecords = 0;
let auditLoadRequest = 0;

function auditLoadErrorMessage(error) {
  const message = String(error?.message || "Unable to load the audit log.");
  if (/^firebase authentication failed\.?$/i.test(message.trim())) {
    return "The Audit Log service could not authenticate this school. Redeploy the latest apps-script/AuditLog.gs and verify its FIREBASE_WEB_API_KEY and FIRESTORE_PROJECT_ID match this school's Firebase project, then sign out and sign in again.";
  }
  return message;
}

export async function initAuditLog({ renderNavigation = true } = {}) {
  if (!isSchoolAdmin()) {
    window.location.replace(appPageHref("dashboard.html"));
    return;
  }
  if (renderNavigation) renderShell("audit-log", "Audit Log");
  document.getElementById("auditSearch")?.addEventListener("input", renderFilteredAuditLog);
  document.getElementById("auditRefreshBtn")?.addEventListener("click", () => loadAuditLog(currentPage));
  document.getElementById("auditPreviousPage")?.addEventListener("click", () => {
    if (currentPage > 1) void loadAuditLog(currentPage - 1);
  });
  document.getElementById("auditNextPage")?.addEventListener("click", () => {
    if (currentPage < totalPages) void loadAuditLog(currentPage + 1);
  });
  currentPage = 1;
  await loadAuditLog();
}

export async function loadAuditLog(page = currentPage) {
  const body = document.getElementById("auditTableBody");
  const meta = document.getElementById("auditMeta");
  const requestId = ++auditLoadRequest;
  const previous = document.getElementById("auditPreviousPage");
  const next = document.getElementById("auditNextPage");
  const pageStatus = document.getElementById("auditPageStatus");
  if (previous) previous.disabled = true;
  if (next) next.disabled = true;
  if (body) body.innerHTML = `<tr><td colspan="8" class="state-row">Loading audit entries…</td></tr>`;
  if (meta) meta.textContent = "Loading audit entries…";
  if (pageStatus) pageStatus.textContent = "Loading…";
  try {
    if (!APP_CONFIG.auditLogApiUrl) throw new Error("The AuditLog service is not configured yet.");
    const result = await LPSApi.getAuditLogs(page);
    if (
      !result
      || !Array.isArray(result.records)
      || result.records.length > AUDIT_PAGE_SIZE
      || result.pageSize !== AUDIT_PAGE_SIZE
      || !Number.isInteger(result.page)
      || !Number.isInteger(result.total)
      || !Number.isInteger(result.totalPages)
    ) {
      throw new Error("The Audit Log service does not support pagination yet. Redeploy the latest apps-script/AuditLog.gs.");
    }
    if (requestId !== auditLoadRequest) return;
    auditRecords = result.records;
    currentPage = result.page;
    totalPages = result.totalPages;
    totalRecords = result.total;
    renderFilteredAuditLog();
  } catch (error) {
    if (requestId !== auditLoadRequest) return;
    auditRecords = [];
    totalPages = 0;
    totalRecords = 0;
    if (body) body.innerHTML = `<tr><td colspan="8" class="state-row error">${escapeHtml(auditLoadErrorMessage(error))}</td></tr>`;
    if (meta) meta.textContent = "Audit log unavailable";
    if (pageStatus) pageStatus.textContent = "Page unavailable";
  }
}

export function renderFilteredAuditLog() {
  const query = document.getElementById("auditSearch")?.value.trim().toLowerCase() || "";
  const records = query
    ? auditRecords.filter((record) => Object.values(record).some((value) => String(value || "").toLowerCase().includes(query)))
    : auditRecords;
  renderAuditTable(records);
}

export function renderAuditTable(records) {
  const body = document.getElementById("auditTableBody");
  const meta = document.getElementById("auditMeta");
  const previous = document.getElementById("auditPreviousPage");
  const next = document.getElementById("auditNextPage");
  const pageStatus = document.getElementById("auditPageStatus");
  if (!body) return;
  if (previous) previous.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
  if (pageStatus) pageStatus.textContent = `Page ${currentPage} of ${Math.max(totalPages, 1)}`;
  const start = totalRecords ? (currentPage - 1) * AUDIT_PAGE_SIZE + 1 : 0;
  const end = Math.min(currentPage * AUDIT_PAGE_SIZE, totalRecords);
  const query = document.getElementById("auditSearch")?.value.trim() || "";
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="8" class="state-row">${query ? "No matching entries on this page." : "No audit entries found."}</td></tr>`;
    if (meta) meta.textContent = query
      ? `No matches on this page · ${totalRecords.toLocaleString()} total entries`
      : `${totalRecords.toLocaleString()} entries`;
    return;
  }
  body.innerHTML = records.map((record) => {
    const action = String(record.action || "—").toUpperCase();
    return `<tr>
      <td>${escapeHtml(record.timestamp || "—")}</td>
      <td class="cell-name">${escapeHtml(record.user || "—")}</td>
      <td><span class="audit-action" data-action="${escapeHtml(action)}">${escapeHtml(action)}</span></td>
      <td>${escapeHtml(record.sheet || "—")}</td>
      <td>${escapeHtml(record.recordId || "—")}</td>
      <td class="audit-value">${escapeHtml(record.oldValue || "—")}</td>
      <td class="audit-value">${escapeHtml(record.newValue || "—")}</td>
      <td class="audit-value">${escapeHtml(record.ipSession || "—")}</td>
    </tr>`;
  }).join("");
  if (meta) {
    const pageSummary = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${totalRecords.toLocaleString()} entries`;
    meta.textContent = query
      ? `${records.length.toLocaleString()} matching entr${records.length === 1 ? "y" : "ies"} on this page · ${pageSummary}`
      : pageSummary;
  }
}
