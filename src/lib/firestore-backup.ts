// @ts-nocheck -- Firestore compat SDK is supplied by the tenant runtime.
declare const firebase: any;

import { APP_CONFIG } from './app-config';
import { auth, db } from './firebase';
import {
  FS_DOCUMENTS,
  FS_LEARNERS,
  FS_PATHS,
  FS_SCHOOL_YEARS,
  FS_SETTINGS,
  FS_TRANSFERRED_OUT,
  FS_DROPOUTS,
  FS_USERS,
  fsInvalidateReadCaches_,
} from './firestore-api';
import { clearButtonLoading, setButtonLoading, showToast } from './shell';
import { clearFirestoreBackupReview, renderFirestoreBackupReview } from './firestore-backup-review';

export const FIRESTORE_BACKUP_FORMAT = "edash-tenant-firestore-backup";
export const FIRESTORE_BACKUP_FORMAT_VERSION = 1;
const FIRESTORE_BATCH_SIZE = 400;
const FIRESTORE_TIMESTAMP_TAG = "__edashFirestoreTimestamp";
const FIRESTORE_DATE_TAG = "__edashFirestoreDate";
const FIRESTORE_GEOPOINT_TAG = "__edashFirestoreGeoPoint";
const FIRESTORE_MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const FIRESTORE_MAX_TIMESTAMP_SECONDS = 253_402_300_799;

export function encodeBackupValue(value) {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return { [FIRESTORE_DATE_TAG]: value.toISOString() };
  if (typeof value.toDate === "function" && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) {
    return { [FIRESTORE_TIMESTAMP_TAG]: { seconds: value.seconds, nanoseconds: value.nanoseconds } };
  }
  if (Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.constructor?.name === "GeoPoint") {
    return { [FIRESTORE_GEOPOINT_TAG]: { latitude: value.latitude, longitude: value.longitude } };
  }
  if (Array.isArray(value)) return value.map(encodeBackupValue);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("The database contains a value type that cannot be represented safely in a JSON backup.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeBackupValue(entry)]));
}

export function decodeBackupValue(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeBackupValue);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === FIRESTORE_TIMESTAMP_TAG) {
    const timestamp = value[FIRESTORE_TIMESTAMP_TAG];
    if (!timestamp || !Number.isInteger(timestamp.seconds) || timestamp.seconds < FIRESTORE_MIN_TIMESTAMP_SECONDS
      || timestamp.seconds > FIRESTORE_MAX_TIMESTAMP_SECONDS || !Number.isInteger(timestamp.nanoseconds)
      || timestamp.nanoseconds < 0 || timestamp.nanoseconds >= 1_000_000_000) {
      throw new Error("The backup contains an invalid timestamp value.");
    }
    return new firebase.firestore.Timestamp(timestamp.seconds, timestamp.nanoseconds);
  }
  if (keys.length === 1 && keys[0] === FIRESTORE_DATE_TAG) {
    const dateValue = value[FIRESTORE_DATE_TAG];
    const date = new Date(dateValue);
    if (typeof dateValue !== "string" || Number.isNaN(date.getTime())) throw new Error("The backup contains an invalid date value.");
    return date;
  }
  if (keys.length === 1 && keys[0] === FIRESTORE_GEOPOINT_TAG) {
    const point = value[FIRESTORE_GEOPOINT_TAG];
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
      || point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
      throw new Error("The backup contains an invalid geographic point.");
    }
    return new firebase.firestore.GeoPoint(point.latitude, point.longitude);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeBackupValue(entry)]));
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPathSegment(value) {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/");
}

function validateBackupValue(value, documentPath) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Document ${documentPath} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => validateBackupValue(entry, documentPath));
    return;
  }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`Document ${documentPath} contains a value that is not valid JSON data.`);
  }

  const keys = Object.keys(value);
  if (keys.includes(FIRESTORE_TIMESTAMP_TAG)) {
    const timestamp = value[FIRESTORE_TIMESTAMP_TAG];
    if (keys.length !== 1 || !isRecord(timestamp) || !Number.isInteger(timestamp.seconds)
      || timestamp.seconds < FIRESTORE_MIN_TIMESTAMP_SECONDS || timestamp.seconds > FIRESTORE_MAX_TIMESTAMP_SECONDS
      || !Number.isInteger(timestamp.nanoseconds) || timestamp.nanoseconds < 0 || timestamp.nanoseconds >= 1_000_000_000) {
      throw new Error(`Document ${documentPath} contains an invalid Firestore timestamp.`);
    }
    return;
  }
  if (keys.includes(FIRESTORE_DATE_TAG)) {
    const dateValue = value[FIRESTORE_DATE_TAG];
    const date = new Date(dateValue);
    if (keys.length !== 1 || typeof dateValue !== "string" || Number.isNaN(date.getTime()) || date.toISOString() !== dateValue) {
      throw new Error(`Document ${documentPath} contains an invalid date value.`);
    }
    return;
  }
  if (keys.includes(FIRESTORE_GEOPOINT_TAG)) {
    const point = value[FIRESTORE_GEOPOINT_TAG];
    if (keys.length !== 1 || !isRecord(point) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
      || point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
      throw new Error(`Document ${documentPath} contains an invalid geographic point.`);
    }
    return;
  }
  Object.values(value).forEach((entry) => validateBackupValue(entry, documentPath));
}

function validateBackupEnvelope(value) {
  if (!isRecord(value) || value.format !== FIRESTORE_BACKUP_FORMAT) {
    throw new Error("This file is not an E-Dash tenant database backup.");
  }
  if (value.formatVersion !== FIRESTORE_BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${String(value.formatVersion)}.`);
  }
  if (value.appSchemaVersion !== APP_CONFIG.firestore.schemaVersion) {
    throw new Error("This backup uses a different database schema version. Use a compatible E-Dash version.");
  }
  if (!APP_CONFIG.schoolId || value.schoolId !== APP_CONFIG.schoolId) {
    throw new Error("This backup belongs to a different school. Import was stopped to protect tenant data.");
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(new Date(value.exportedAt).getTime())) {
    throw new Error("The backup is missing a valid export date.");
  }
  if (!Array.isArray(value.documents) || value.documents.length === 0) {
    throw new Error("The backup contains no database documents.");
  }
  return value;
}

function validateBackupDocuments(value) {
  const paths = new Set();
  value.documents.forEach((backupDocument, index) => {
    if (!isRecord(backupDocument) || !isSupportedFirestoreBackupPath(backupDocument.path) || !isRecord(backupDocument.data)) {
      throw new Error(`Backup document ${index + 1} has an invalid path or data object.`);
    }
    if (paths.has(backupDocument.path)) throw new Error(`The backup contains duplicate document path: ${backupDocument.path}.`);
    paths.add(backupDocument.path);
    validateBackupValue(backupDocument.data, backupDocument.path);
  });
}

function validateBackupActiveAdmin(value, activeAdminUid) {
  const activeAdmin = value.documents.find(({ path }) => path === `${FS_USERS}/${activeAdminUid}`)?.data;
  if (!activeAdmin || activeAdmin.role !== "School Admin" || activeAdmin.status !== "Active") {
    throw new Error("The backup must include your active School Admin account so this school remains manageable after restore.");
  }
}

export function isSupportedFirestoreBackupPath(path) {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  if (parts.some((part) => !isPathSegment(part))) return false;
  if (parts.length === 2) {
    return ["users", FS_SCHOOL_YEARS, FS_SETTINGS].includes(parts[0])
      || (parts[0] === "publicStats" && parts[1] === "summary");
  }
  if (parts.length === 4) {
    return (parts[0] === FS_USERS && parts[2] === FS_PATHS.assignmentHistory)
      || (parts[0] === FS_SETTINGS && parts[1] === FS_DOCUMENTS.gradeTerms && parts[2] === FS_PATHS.gradeTermYears)
      || (parts[0] === FS_SCHOOL_YEARS && [FS_LEARNERS, FS_DROPOUTS, FS_TRANSFERRED_OUT, "trash", FS_PATHS.grades].includes(parts[2]));
  }
  if (parts.length === 6) {
    return parts[0] === FS_SCHOOL_YEARS
      && parts[2] === FS_PATHS.grades
      && parts[4] === FS_PATHS.sections;
  }
  return parts.length === 8
    && parts[0] === FS_SCHOOL_YEARS
    && parts[2] === FS_PATHS.grades
    && parts[4] === FS_PATHS.sections
    && parts[6] === FS_PATHS.teachers;
}

export function validateFirestoreBackup(value, activeAdminUid = auth.currentUser?.uid || "") {
  validateBackupEnvelope(value);
  validateBackupDocuments(value);
  validateBackupActiveAdmin(value, activeAdminUid);
  return value;
}

function appendSnapshotDocuments(documents, snapshot) {
  snapshot.docs.forEach((document) => documents.push({
    path: document.ref.path,
    data: encodeBackupValue(document.data()),
  }));
}

async function appendCollectionDocuments(documents, collection) {
  appendSnapshotDocuments(documents, await readBackupReference(collection));
}

async function readBackupReference(reference) {
  try {
    return await reference.get();
  } catch (error) {
    if (error.code === "permission-denied" || error.code === "firestore/permission-denied") {
      const projectId = db.app?.options?.projectId || APP_CONFIG.firebase?.projectId || "the selected school's Firebase project";
      throw new Error(
        `Backup cannot read "${reference.path}" in ${projectId}. ` +
        "Sign in with an active School Admin account and deploy the latest firestore.rules to this school's Firebase project, then retry. " +
        "No backup was downloaded.",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function collectFirestoreBackup() {
  const documents = [];
  const [usersSnapshot, yearsSnapshot, settingsSnapshot, publicStatsSummary] = await Promise.all([
    readBackupReference(db.collection(FS_USERS)),
    readBackupReference(db.collection(FS_SCHOOL_YEARS)),
    readBackupReference(db.collection(FS_SETTINGS)),
    readBackupReference(db.collection("publicStats").doc("summary")),
  ]);
  appendSnapshotDocuments(documents, usersSnapshot);
  appendSnapshotDocuments(documents, yearsSnapshot);
  appendSnapshotDocuments(documents, settingsSnapshot);
  if (publicStatsSummary.exists) {
    documents.push({ path: publicStatsSummary.ref.path, data: encodeBackupValue(publicStatsSummary.data()) });
  }

  await Promise.all(usersSnapshot.docs.map((user) =>
    appendCollectionDocuments(documents, user.ref.collection(FS_PATHS.assignmentHistory))));

  await Promise.all(settingsSnapshot.docs
    .filter((setting) => setting.id === FS_DOCUMENTS.gradeTerms)
    .map((setting) => appendCollectionDocuments(
      documents,
      setting.ref.collection(FS_PATHS.gradeTermYears),
    )));

  await Promise.all(yearsSnapshot.docs.map(async (year) => {
    const [learners, dropouts, transfers, trash, grades] = await Promise.all([
      readBackupReference(year.ref.collection(FS_LEARNERS)),
      readBackupReference(year.ref.collection(FS_DROPOUTS)),
      readBackupReference(year.ref.collection(FS_TRANSFERRED_OUT)),
      readBackupReference(year.ref.collection("trash")),
      readBackupReference(year.ref.collection(FS_PATHS.grades)),
    ]);
    [learners, dropouts, transfers, trash, grades].forEach((snapshot) => appendSnapshotDocuments(documents, snapshot));
    await Promise.all(grades.docs.map(async (grade) => {
      const sections = await readBackupReference(grade.ref.collection(FS_PATHS.sections));
      appendSnapshotDocuments(documents, sections);
      await Promise.all(sections.docs.map(async (section) =>
        appendCollectionDocuments(documents, section.ref.collection(FS_PATHS.teachers))));
    }));
  }));

  documents.sort((left, right) => left.path.localeCompare(right.path));
  return {
    format: FIRESTORE_BACKUP_FORMAT,
    formatVersion: FIRESTORE_BACKUP_FORMAT_VERSION,
    appSchemaVersion: APP_CONFIG.firestore.schemaVersion,
    schoolId: APP_CONFIG.schoolId,
    schoolName: APP_CONFIG.branding.schoolName,
    exportedAt: new Date().toISOString(),
    documents,
  };
}

export function downloadFirestoreBackupFile(backup, prefix = "edash-backup") {
  const tenantSlug = String(APP_CONFIG.schoolId || "school").replace(/[^a-z0-9-]/gi, "-");
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${prefix}-${tenantSlug}-${date}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export const FIRESTORE_BACKUP_MODES = Object.freeze({
  REPLACE: "replace",
  MERGE: "merge",
  EXTEND: "extend",
});

export function updateFirestoreBackupModeWarning(mode = FIRESTORE_BACKUP_MODES.REPLACE) {
  const review = document.getElementById('firestoreBackupReview');
  if (review && !review.hidden) {
    const status = document.getElementById('firestoreBackupValidationStatus');
    if (status) status.textContent = 'Restore options changed. Choose the backup again to review it with this mode.';
  }
  clearFirestoreBackupReview();
  const title = document.getElementById("backupReplaceWarningTitle");
  const description = document.getElementById("backupModeWarningDescription");
  const descriptions = {
    [FIRESTORE_BACKUP_MODES.REPLACE]: {
      title: "Replace mode: replace E-Dash-managed school data",
      description: "Imported documents overwrite matching records. Other E-Dash-managed records missing from the file are deleted, leaving the app-managed data to match the backup.",
    },
    [FIRESTORE_BACKUP_MODES.MERGE]: {
      title: "Merge mode: update imported records without deleting",
      description: "Imported fields update matching records while fields not present in the file are preserved. New document paths are added. Existing documents not in the backup are left unchanged.",
    },
    [FIRESTORE_BACKUP_MODES.EXTEND]: {
      title: "Extend mode: add only missing records",
      description: "Imported documents are added only when their exact document path does not already exist. Existing matching documents remain unchanged; no records are deleted.",
    },
  };
  const copy = descriptions[mode] || descriptions[FIRESTORE_BACKUP_MODES.REPLACE];
  if (title) title.textContent = copy.title;
  if (description) description.textContent = copy.description;
}

export async function downloadFirestoreBackup() {
  const button = document.getElementById("downloadFirestoreBackupBtn");
  const status = document.getElementById("firestoreBackupStatus");
  setButtonLoading(button, "Preparing JSON…");
  if (status) status.textContent = "Reading all supported tenant records and settings…";
  try {
    const backup = await collectFirestoreBackup();
    const filename = downloadFirestoreBackupFile(backup);
    if (status) status.textContent = `Backup downloaded: ${backup.documents.length.toLocaleString()} documents in ${filename}.`;
    showToast("Tenant database backup downloaded as JSON.", "success");
    return backup;
  } catch (error) {
    if (status) status.textContent = error.message || "Backup could not be created.";
    showToast(error.message || "Backup could not be created.", "error");
    return null;
  } finally {
    clearButtonLoading(button);
  }
}

function toFirestoreDocument(document) {
  return {
    path: document.path,
    data: decodeBackupValue(document.data),
    ref: db.doc(document.path),
  };
}

export async function restoreFirestoreBackup(value, mode = FIRESTORE_BACKUP_MODES.REPLACE) {
  if (!Object.values(FIRESTORE_BACKUP_MODES).includes(mode)) {
    throw new Error(`Unsupported database import mode: ${String(mode)}.`);
  }
  const backup = validateFirestoreBackup(value);
  const activeAdminPath = `${FS_USERS}/${auth.currentUser.uid}`;
  const incomingPaths = new Set(backup.documents.map(({ path }) => path));
  const preparedDocuments = backup.documents.map(toFirestoreDocument);
  const status = document.getElementById("firestoreBackupStatus");

  if (status) status.textContent = "Creating a safety backup of the current database before restoring…";
  const safetyBackup = await collectFirestoreBackup();
  if (safetyBackup.documents.length) downloadFirestoreBackupFile(safetyBackup, "edash-pre-restore");

  let documentsToWrite = preparedDocuments;
  let skipped = 0;
  if (mode === FIRESTORE_BACKUP_MODES.EXTEND) {
    const existingDocuments = [];
    for (let start = 0; start < preparedDocuments.length; start += FIRESTORE_BATCH_SIZE) {
      const documentChunk = preparedDocuments.slice(start, start + FIRESTORE_BATCH_SIZE);
      existingDocuments.push(...await Promise.all(documentChunk.map(async (entry) => ({
        ...entry,
        exists: (await entry.ref.get()).exists,
      }))));
    }
    documentsToWrite = existingDocuments.filter(({ exists }) => !exists);
    skipped = existingDocuments.length - documentsToWrite.length;
  }

  if (status) status.textContent = `${mode === FIRESTORE_BACKUP_MODES.REPLACE ? "Replacing" : mode === FIRESTORE_BACKUP_MODES.MERGE ? "Merging" : "Extending"} ${documentsToWrite.length.toLocaleString()} documents…`;
  for (let start = 0; start < documentsToWrite.length; start += FIRESTORE_BATCH_SIZE) {
    const batch = db.batch();
    documentsToWrite.slice(start, start + FIRESTORE_BATCH_SIZE)
      .forEach(({ ref, data }) => {
        if (mode === FIRESTORE_BACKUP_MODES.MERGE) batch.set(ref, data, { merge: true });
        else batch.set(ref, data);
      });
    await batch.commit();
  }

  const staleDocuments = mode === FIRESTORE_BACKUP_MODES.REPLACE ? safetyBackup.documents
    .filter(({ path }) => !incomingPaths.has(path) && path !== activeAdminPath)
    .map(({ path }) => ({ path, ref: db.doc(path) })) : [];
  for (let start = 0; start < staleDocuments.length; start += FIRESTORE_BATCH_SIZE) {
    const batch = db.batch();
    staleDocuments.slice(start, start + FIRESTORE_BATCH_SIZE)
      .forEach(({ ref }) => batch.delete(ref));
    await batch.commit();
  }

  fsInvalidateReadCaches_();
  return {
    mode,
    restored: documentsToWrite.length,
    removed: staleDocuments.length,
    skipped,
  };
}

export async function importFirestoreBackupFile(file, mode = document.getElementById("firestoreBackupMode")?.value || FIRESTORE_BACKUP_MODES.REPLACE) {
  if (!file) return null;
  if (!Object.values(FIRESTORE_BACKUP_MODES).includes(mode)) {
    showToast(`Unsupported database import mode: ${String(mode)}.`, "error");
    return null;
  }
  updateFirestoreBackupModeWarning(mode);
  const status = document.getElementById("firestoreBackupStatus");
  const button = document.getElementById("importFirestoreBackupBtn");
  const steps = [...document.querySelectorAll("[data-backup-validation-step]")];
  const progress = document.getElementById("firestoreBackupProgress");
  const validationStatus = document.getElementById("firestoreBackupValidationStatus");
  const modeSelect = document.getElementById('firestoreBackupMode');
  if (modeSelect) modeSelect.disabled = true;
  let activeStep = 0;
  const setStepState = (stepIndex, state) => {
    const step = steps[stepIndex];
    if (!step) return;
    step.dataset.state = state;
    step.setAttribute("aria-current", state === "active" ? "step" : "false");
    const label = step.querySelector("[data-backup-step-state]");
    if (label) label.textContent = state === "complete" ? "Complete" : state === "active" ? "Checking" : state === "error" ? "Needs attention" : "Waiting";
  };
  const setValidationProgress = (stepIndex, state, message) => {
    setStepState(stepIndex, state);
    if (progress) {
      const completedCount = steps.filter((step) => step.dataset.state === "complete").length;
      const percentage = state === "active" ? Math.round((completedCount + 0.5) / steps.length * 100) : Math.round(completedCount / steps.length * 100);
      progress.setAttribute("aria-valuenow", String(percentage));
      progress.style.setProperty("--backup-validation-progress", `${percentage}%`);
    }
    if (validationStatus) validationStatus.textContent = message;
  };
  const nextPaint = () => new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(resolve);
    else window.setTimeout(resolve, 0);
  });

  steps.forEach((_, index) => setStepState(index, "pending"));
  setValidationProgress(0, "active", "Reading the selected JSON file…");
  setButtonLoading(button, "Validating…");
  try {
    await nextPaint();
    const parsed = JSON.parse(await file.text());
    setValidationProgress(0, "complete", "JSON file read successfully.");
    activeStep = 1;
    setValidationProgress(activeStep, "active", "Checking backup format, tenant, and schema version…");
    await nextPaint();
    validateBackupEnvelope(parsed);

    setValidationProgress(activeStep, "complete", "Backup format, tenant, and schema match this school.");
    activeStep = 2;
    setValidationProgress(activeStep, "active", "Checking document paths, duplicates, and Firestore value types…");
    await nextPaint();
    validateBackupDocuments(parsed);

    setValidationProgress(activeStep, "complete", `${parsed.documents.length.toLocaleString()} documents match supported paths and value types.`);
    activeStep = 3;
    setValidationProgress(activeStep, "active", "Checking that your active School Admin account is included…");
    await nextPaint();
    validateBackupActiveAdmin(parsed, auth.currentUser?.uid || "");
    const backup = parsed;
    setValidationProgress(activeStep, "complete", "Validation passed. Review the backup summary, then choose Review and restore.");
    const summary = renderFirestoreBackupReview(backup, file.name, mode, () => restoreReviewedFirestoreBackup(backup, mode));
    if (status) status.textContent = 'Backup validated. Review the summary before restoring; nothing has been uploaded.';
    return { prepared: true, mode, summary };
  } catch (error) {
    setValidationProgress(activeStep, "error", `Validation stopped: ${error.message || "The selected file could not be validated."}`);
    if (status) status.textContent = error.message || "Backup could not be imported.";
    showToast(error.message || "Backup could not be imported.", "error");
    return null;
  } finally {
    clearButtonLoading(button);
    if (modeSelect) modeSelect.disabled = false;
  }
}

async function restoreReviewedFirestoreBackup(backup, mode) {
  const button = document.getElementById('confirmFirestoreBackupBtn');
  if (!button || button.disabled) return null;
  const status = document.getElementById('firestoreBackupStatus');
  const validationStatus = document.getElementById('firestoreBackupValidationStatus');
  const exportedLabel = new Date(backup.exportedAt).toLocaleString();
  const documentCount = backup.documents.length.toLocaleString();
  const modeNames = {
    [FIRESTORE_BACKUP_MODES.REPLACE]: "Replace",
    [FIRESTORE_BACKUP_MODES.MERGE]: "Merge",
    [FIRESTORE_BACKUP_MODES.EXTEND]: "Extend",
  };
  const modeDetails = {
    [FIRESTORE_BACKUP_MODES.REPLACE]: "Matching app-managed documents will be overwritten, and other app-managed documents missing from this file will be deleted.",
    [FIRESTORE_BACKUP_MODES.MERGE]: "Imported fields will update matching documents, preserving fields not included in the file. Existing documents absent from the backup will remain unchanged.",
    [FIRESTORE_BACKUP_MODES.EXTEND]: "Only app-managed documents whose exact paths do not exist will be added. Existing matching documents will be skipped.",
  };
  if (!window.confirm(
    `${modeNames[mode]} ${documentCount} app-managed database documents for ${backup.schoolName || APP_CONFIG.branding.schoolName} using the backup from ${exportedLabel}?\n\n` +
    `${modeDetails[mode]}\n\n` +
    `This mode cannot affect Firebase Authentication accounts or unrelated/custom collections. A JSON safety backup will be downloaded first. Restore is not atomic. Continue?`,
  )) {
    if (validationStatus) validationStatus.textContent = `${modeNames[mode]} validation passed. Restore canceled; database unchanged. You can review the summary and try again.`;
    return null;
  }
  const controls = ['importFirestoreBackupBtn', 'downloadFirestoreBackupBtn', 'firestoreBackupMode', 'cancelFirestoreBackupBtn']
    .map(id => document.getElementById(id)).filter(Boolean).map(element => ({ element, disabled: element.disabled }));
  controls.forEach(({ element }) => { element.disabled = true; });
  setButtonLoading(button, 'Restoring…');
  button.disabled = true;
  try {
    const result = await restoreFirestoreBackup(backup, mode);
    const resultParts = [`${result.restored.toLocaleString()} written`];
    if (result.removed) resultParts.push(`${result.removed.toLocaleString()} removed`);
    if (result.skipped) resultParts.push(`${result.skipped.toLocaleString()} skipped`);
    if (status) status.textContent = `${modeNames[mode]} complete: ${resultParts.join(", ")}.`;
    if (validationStatus) validationStatus.textContent = "Restore completed successfully.";
    showToast("Tenant database restore completed.", "success");
    return result;
  } catch (error) {
    if (validationStatus) validationStatus.textContent = `Validation passed, but restore failed: ${error.message || "Unknown error"}. Choose and validate the backup again before retrying.`;
    if (status) status.textContent = error.message || "Backup could not be imported.";
    showToast(error.message || "Backup could not be imported.", "error");
    return null;
  } finally {
    clearButtonLoading(button);
    button.disabled = true;
    controls.forEach(({ element, disabled }) => { element.disabled = disabled; });
    const close = document.getElementById('cancelFirestoreBackupBtn');
    if (close) {
      close.textContent = 'Close summary';
      close.onclick = clearFirestoreBackupReview;
    }
  }
}
