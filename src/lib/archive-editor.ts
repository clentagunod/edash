// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { appDateInputValue, clearButtonLoading, setButtonLoading, showToast } from './shell';
import { LPSApi } from './sheets-api';
import { ensureAnecdotalRecordsInput, organizeLearnerForm } from './learner-form-layout';

export let archiveEditorState = null;

export function archiveDateInputValue(value) {
  return typeof appDateInputValue === "function" ? appDateInputValue(value) : "";
}

export function ensureArchiveEditor() {
  if (document.getElementById("archiveEditorBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="archiveEditorBackdrop"><div class="modal archive-editor-modal"><div class="modal-header"><h3 id="archiveEditorTitle">Edit archived learner</h3><button class="modal-close" type="button" id="archiveEditorClose" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><form id="archiveEditorForm"><div class="modal-body"><div class="field-grid"><div class="field"><label for="archiveFirstName">First name</label><input id="archiveFirstName" required /></div><div class="field"><label for="archiveMiddleName">Middle name</label><input id="archiveMiddleName" /></div><div class="field"><label for="archiveLastName">Last name</label><input id="archiveLastName" required /></div><div class="field"><label for="archiveSuffix">Suffix</label><select id="archiveSuffix"><option value="">None</option><option value="Jr.">Jr.</option><option value="II">II</option><option value="III">III</option><option value="custom">Please specify…</option></select></div><div class="field" id="archiveCustomSuffixWrap" hidden><label for="archiveCustomSuffix">Please specify suffix</label><input id="archiveCustomSuffix" maxlength="32" /></div><div class="field"><label for="archiveBirthDate">Birthdate</label><input id="archiveBirthDate" type="date" /></div><div class="field"><label for="archiveGrade">Grade level</label><input id="archiveGrade" /></div><div class="field"><label for="archiveSection">Section</label><input id="archiveSection" /></div><div class="field"><label for="archiveGender">Gender</label><select id="archiveGender" required aria-required="true"><option value="">Select gender</option><option>Male</option><option>Female</option></select></div><div class="field"><label for="archiveDateAdded">Date added</label><input id="archiveDateAdded" type="date" /></div><div class="field span-2"><label for="archiveTransferSchool">Transfer school</label><input id="archiveTransferSchool" /></div><div class="field"><label for="archiveTransferDate">Transfer date</label><input id="archiveTransferDate" type="date" /></div><div class="field span-2"><label for="archiveReason">Transfer reason</label><textarea id="archiveReason" rows="3"></textarea></div><div class="field span-2"><label for="archiveNotes">Transfer notes</label><textarea id="archiveNotes" rows="3"></textarea></div></div></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="archiveEditorCancel">Cancel</button><button class="btn btn-primary" type="submit" id="archiveEditorSave">Save changes</button></div></form></div></div>`);
  const form = document.getElementById("archiveEditorForm");
  ensureAnecdotalRecordsInput(form, true);
  organizeLearnerForm(form, true);
  const close = () => document.getElementById("archiveEditorBackdrop").classList.remove("is-open");
  document.getElementById("archiveEditorClose").addEventListener("click", close);
  document.getElementById("archiveEditorCancel").addEventListener("click", close);
  document.getElementById("archiveEditorBackdrop").addEventListener("click", (event) => { if (event.target.id === "archiveEditorBackdrop") close(); });
  document.getElementById("archiveSuffix").addEventListener("change", updateArchiveSuffixVisibility);
  document.getElementById("archiveEditorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("archiveEditorSave");
    if (!archiveEditorState || !event.target.reportValidity()) return;
    button.disabled = true;
    try {
      const sentenceCaseName = (value) => { const text = String(value || "").trim().toLowerCase(); return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""; };
      const record = {
        ...archiveEditorState.record,
        firstName: sentenceCaseName(document.getElementById("archiveFirstName").value),
        middleName: sentenceCaseName(document.getElementById("archiveMiddleName").value),
        lastName: sentenceCaseName(document.getElementById("archiveLastName").value),
        suffix: document.getElementById("archiveSuffix").value === "custom"
          ? document.getElementById("archiveCustomSuffix").value.trim()
          : document.getElementById("archiveSuffix").value,
        birthDate: document.getElementById("archiveBirthDate").value,
        gradeLevel: document.getElementById("archiveGrade").value.trim(),
        section: document.getElementById("archiveSection").value.trim(),
        gender: document.getElementById("archiveGender").value,
        dateAdded: document.getElementById("archiveDateAdded").value,
        transferSchool: document.getElementById("archiveTransferSchool").value.trim(),
        transferDate: document.getElementById("archiveTransferDate").value,
        transferReason: document.getElementById("archiveReason").value.trim(),
        transferNotes: document.getElementById("archiveNotes").value.trim(),
        anecdotalRecords: document.getElementById("archiveAnecdotalRecords").value.trim(),
      };
      await LPSApi.updateArchiveRecord(archiveEditorState.archive, archiveEditorState.schoolYear, archiveEditorState.record.learnerId, record);
      close();
      await archiveEditorState.reload();
      showToast("Archived learner updated.", "success");
    } catch (error) { showToast(error.message || "The archived learner could not be updated.", "error"); }
    finally { button.disabled = false; }
  });
  ["archiveFirstName", "archiveMiddleName", "archiveLastName"].forEach((id) => {
    document.getElementById(id).addEventListener("blur", (event) => {
      const text = String(event.target.value || "").trim().toLowerCase();
      event.target.value = text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
    });
  });
}

export function openArchiveEditor(archive, schoolYear, record, reload) {
  ensureArchiveEditor();
  archiveEditorState = { archive, schoolYear, record, reload };
  document.getElementById("archiveEditorTitle").textContent = archive === "dropout" ? "Edit Dropout Info record" : "Edit transfer record";
  document.getElementById("archiveFirstName").value = record.firstName || "";
  document.getElementById("archiveMiddleName").value = record.middleName || "";
  document.getElementById("archiveLastName").value = record.lastName || "";
  const standardSuffixes = ["Jr.", "II", "III"];
  document.getElementById("archiveSuffix").value = standardSuffixes.includes(record.suffix) ? record.suffix : record.suffix ? "custom" : "";
  document.getElementById("archiveCustomSuffix").value = standardSuffixes.includes(record.suffix) ? "" : record.suffix || "";
  updateArchiveSuffixVisibility();
  document.getElementById("archiveBirthDate").value = archiveDateInputValue(record.birthDate);
  document.getElementById("archiveGrade").value = record.gradeLevel || "";
  document.getElementById("archiveSection").value = record.section || "";
  document.getElementById("archiveGender").value = record.gender || "";
  document.getElementById("archiveDateAdded").value = archiveDateInputValue(record.dateAdded);
  document.getElementById("archiveTransferSchool").value = record.transferSchool || "";
  document.getElementById("archiveTransferDate").value = archiveDateInputValue(record.transferDate);
  document.getElementById("archiveReason").value = record.transferReason || "";
  document.getElementById("archiveNotes").value = record.transferNotes || "";
  document.getElementById("archiveAnecdotalRecords").value = record.anecdotalRecords || "";
  document.getElementById("archiveEditorBackdrop").classList.add("is-open");
}

function updateArchiveSuffixVisibility() {
  const custom = document.getElementById("archiveSuffix").value === "custom";
  const wrapper = document.getElementById("archiveCustomSuffixWrap");
  const input = document.getElementById("archiveCustomSuffix");
  wrapper.hidden = !custom;
  input.required = custom;
  if (!custom) input.value = "";
}

export async function deleteArchiveRecord(archive, schoolYear, record, reload) {
  if (!window.confirm(`Delete ${record.firstName || "this"} ${record.lastName || "learner"} from the archive?`)) return;
  const button = document.querySelector(`[data-archive-delete="${CSS.escape(String(record.learnerId))}"], [data-transfer-delete="${CSS.escape(String(record.learnerId))}"]`);
  setButtonLoading(button, "Deleting…");
  try { await LPSApi.deleteArchiveRecord(archive, schoolYear, record.learnerId); await reload(); showToast("Archived learner deleted.", "success"); }
  catch (error) { showToast(error.message || "The archived learner could not be deleted.", "error"); }
  finally { clearButtonLoading(button); }
}

export async function cancelLearnerMovement(archive, schoolYear, record, reload, button) {
  const learnerName = [record.firstName, record.middleName, record.lastName].filter(Boolean).join(" ") || record.learnerId || "this learner";
  const movement = archive === "dropout" ? "dropout" : "transfer";
  if (!window.confirm(`Cancel this ${movement} for ${learnerName}?\n\nThe learner will return to the masterlist, and the movement/status fields will be reset.`)) return;

  setButtonLoading(button, "Restoring…");
  try {
    await LPSApi.cancelLearnerMovement(archive, schoolYear, record.learnerId);
    await reload();
    showToast(`${learnerName} returned to the learner masterlist.`, "success");
  } catch (error) {
    showToast(error.message || `Unable to cancel this ${movement}.`, "error");
  } finally {
    clearButtonLoading(button);
  }
}
