/**
 * E-Dash - standalone tenant AuditLog service.
 *
 * This is the only remaining Google Apps Script data service for the website.
 * It must be deployed separately as a Web App. Store these Script Properties:
 *   AUDIT_SPREADSHEET_ID
 *   FIRESTORE_PROJECT_ID
 *   FIREBASE_WEB_API_KEY
 *   FIREBASE_SERVICE_ACCOUNT_JSON
 *
 * Only allowlisted metadata is stored. Administrative changes include settings
 * and account assignments. Profile photos come from the authenticated profile.
 * Two identity columns are appended automatically; existing rows are preserved.
 */

const AUDIT_HEADERS = [
  "Timestamp",
  "User",
  "Action",
  "Sheet",
  "Record/ID",
  "Old Value",
  "New Value",
  "IP/Session",
  "User ID",
  "Profile Photo",
];
const AUDIT_PAGE_SIZE = 10;
const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "LEARNER_ADD",
  "LEARNER_UPDATE",
  "LEARNER_DELETE",
  "USER_ADD",
  "USER_UPDATE",
  "USER_DELETE",
  "ENROLLMENT_UPDATE",
  "LEARNERS_IMPORT",
  "LEARNER_MOVEMENT_CANCEL",
  "LEARNER_PROMOTE",
  "LEARNER_RETAIN",
  "SETTINGS_UPDATE",
  "SCHOOL_YEAR_ADD",
  "SCHOOL_YEAR_CURRENT",
  "SECTION_ADD",
  "SECTION_UPDATE",
  "SECTION_DELETE",
  "CURRICULUM_SUBJECT_ADD",
  "CURRICULUM_SUBJECT_DELETE",
  "CURRICULUM_UPDATE",
  "DATABASE_RESTORE",
];
const AUDIT_STAFF_ACTIONS = [
  "LEARNER_ADD",
  "LEARNER_UPDATE",
  "LEARNER_DELETE",
  "ENROLLMENT_UPDATE",
  "LEARNER_MOVEMENT_CANCEL",
  "LEARNER_PROMOTE",
  "LEARNER_RETAIN",
];
const AUDIT_ADMIN_ACTIONS = [
  "LEARNERS_IMPORT",
  "USER_ADD",
  "USER_UPDATE",
  "USER_DELETE",
  "SETTINGS_UPDATE",
  "SCHOOL_YEAR_ADD",
  "SCHOOL_YEAR_CURRENT",
  "SECTION_ADD",
  "SECTION_UPDATE",
  "SECTION_DELETE",
  "CURRICULUM_SUBJECT_ADD",
  "CURRICULUM_SUBJECT_DELETE",
  "CURRICULUM_UPDATE",
  "DATABASE_RESTORE",
];
const AUDIT_SAFE_FIELDS = [
  "schoolYear",
  "gradeLevel",
  "section",
  "gender",
  "enrollmentStatus",
  "eosyStatus",
  "transferType",
  "transferDate",
  "role",
  "status",
];

function doGet(event) {
  try {
    const params = event.parameter || {};
    const auth = authorizeAudit_(params.token);
    if (auth.role !== "School Admin")
      throw new Error("Only a School Admin can view administrator data.");
    if (params.action === "getAuditLogs")
      return jsonAudit_({ ok: true, data: readAuditLogs_(params.page) });
    if (params.action === "getFirestoreUsage")
      return jsonAudit_({ ok: true, data: readFirestoreUsage_() });
    throw new Error("Unknown audit action.");
  } catch (error) {
    return jsonAudit_({
      ok: false,
      error: error.message || "Audit request failed.",
    });
  }
}

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || "{}");
    const auth = authorizeAudit_(body.token);
    if (body.action === "deleteAuthUsers")
      return deleteAuthUsersResponse_(auth, body.userIds);
    if (body.action !== "recordAuditEvent")
      throw new Error("Unknown audit action.");
    const action = String(body.auditAction || "")
      .trim()
      .toUpperCase();
    if (!AUDIT_ACTIONS.includes(action))
      throw new Error("That audit event is not allowed.");
    if (AUDIT_ADMIN_ACTIONS.includes(action) && auth.role !== "School Admin")
      throw new Error("Only a School Admin can record this event.");
    if (
      AUDIT_STAFF_ACTIONS.includes(action) &&
      !["School Admin", "Registrar", "Teacher"].includes(auth.role)
    )
      throw new Error("You are not allowed to record this event.");
    appendAuditLog_(auth, action, body);
    return jsonAudit_({ ok: true, data: { recorded: true } });
  } catch (error) {
    return jsonAudit_({
      ok: false,
      error: error.message || "Audit event failed.",
    });
  }
}

function deleteAuthUsersResponse_(auth, userIds) {
  if (auth.role !== "School Admin")
    throw new Error("Only a School Admin can delete Firebase accounts.");
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > 100)
    throw new Error("Provide between 1 and 100 Firebase user IDs.");
  const ids = [...new Set(userIds.map((id) => typeof id === "string" ? id.trim() : ""))];
  if (ids.some((id) => !id || id.length > 128 || id.includes("/")))
    throw new Error("One or more Firebase user IDs are invalid.");
  if (ids.includes(auth.uid))
    throw new Error("You cannot delete the account you are currently using.");
  ids.forEach(deleteFirebaseAuthUser_);
  return jsonAudit_({
    ok: true,
    data: { deleted: ids.length, deletedUserIds: ids },
  });
}

function deleteFirebaseAuthUser_(uid) {
  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(auditProperty_("FIRESTORE_PROJECT_ID"))}/accounts:delete`,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${firebaseAdminAccessToken_()}` },
      payload: JSON.stringify({ localId: uid }),
      muteHttpExceptions: true,
    },
  );
  const result = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() !== 200) {
    const message =
      result.error && result.error.message
        ? result.error.message
        : "Firebase Authentication rejected the deletion.";
    // The Firestore profile can outlive its Auth account (for example after a
    // manual Firebase-console deletion). Treat that state as already removed
    // so admin cleanup can still delete the stale profile document.
    if (message.includes("USER_NOT_FOUND")) return;
    if (
      message.includes("INSUFFICIENT_PERMISSION") ||
      response.getResponseCode() === 403
    ) {
      throw new Error(
        "The Firebase service account cannot delete Authentication users. Grant it Firebase Authentication Admin (roles/firebaseauth.admin), then redeploy this Apps Script web app.",
      );
    }
    throw new Error(`Could not delete Firebase account ${uid}: ${message}`);
  }
}

function firebaseAdminAccessToken_() {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      auditProperty_("FIREBASE_SERVICE_ACCOUNT_JSON"),
    );
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.",
    );
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key)
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.",
    );
  const header = base64Url_(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claim = base64Url_(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: arguments.length
        ? arguments[0]
        : "https://www.googleapis.com/auth/identitytoolkit",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsigned, serviceAccount.private_key),
  ).replace(/=+$/, "");
  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    },
    muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() !== 200 || !result.access_token)
    throw new Error("Could not obtain a Firebase Admin access token.");
  return result.access_token;
}

function readFirestoreUsage_() {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const metrics = {
    reads: "firestore.googleapis.com/document/read_ops_count",
    writes: "firestore.googleapis.com/document/write_ops_count",
    deletes: "firestore.googleapis.com/document/delete_ops_count",
  };
  const usage = {};
  Object.entries(metrics).forEach(([key, metric]) => {
    usage[key] = readMetricSeries_(metric, start, end);
  });
  return {
    plan: "Spark free tier",
    limits: { reads: 50000, writes: 20000, deletes: 20000 },
    days: mergeUsageDays_(usage),
    refreshedAt: new Date().toISOString(),
    nextResetAt: nextPacificMidnight_().toISOString(),
  };
}

function readMetricSeries_(metricType, start, end) {
  const configuredProjectId = auditProperty_("FIRESTORE_PROJECT_ID").trim();
  if (!configuredProjectId) {
    throw new Error(
      "FIRESTORE_PROJECT_ID is missing. Set it to this school's Firebase project ID.",
    );
  }
  if (/^\d+$/.test(configuredProjectId)) {
    throw new Error(
      "FIRESTORE_PROJECT_ID must be the project ID, not the numeric project number or messaging sender ID.",
    );
  }
  const projectId = encodeURIComponent(configuredProjectId);
  const params = [
    `filter=${encodeURIComponent(`metric.type="${metricType}"`)}`,
    `interval.startTime=${encodeURIComponent(start.toISOString())}`,
    `interval.endTime=${encodeURIComponent(end.toISOString())}`,
    "aggregation.alignmentPeriod=86400s",
    "aggregation.perSeriesAligner=ALIGN_SUM",
    "aggregation.crossSeriesReducer=REDUCE_SUM",
    "pageSize=1000",
  ].join("&");
  const response = UrlFetchApp.fetch(
    `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`,
    {
      headers: {
        Authorization: `Bearer ${firebaseAdminAccessToken_("https://www.googleapis.com/auth/cloud-platform")}`,
      },
      muteHttpExceptions: true,
    },
  );
  const result = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() !== 200) {
    const message =
      result.error && result.error.message
        ? result.error.message
        : "Cloud Monitoring rejected the usage request.";
    throw new Error(message);
  }
  const totals = {};
  (result.timeSeries || []).forEach((series) =>
    (series.points || []).forEach((point) => {
      const date = String(point.interval?.endTime || "").slice(0, 10);
      if (date)
        totals[date] =
          (totals[date] || 0) +
          Number(point.value?.int64Value || point.value?.doubleValue || 0);
    }),
  );
  return totals;
}

function mergeUsageDays_(usage) {
  const dates = new Set([
    ...Object.values(usage).flatMap((values) => Object.keys(values)),
  ]);
  return [...dates].sort().map((date) => ({
    date,
    reads: usage.reads[date] || 0,
    writes: usage.writes[date] || 0,
    deletes: usage.deletes[date] || 0,
  }));
}

function nextPacificMidnight_() {
  const now = new Date();
  const pacificDate = Utilities.formatDate(
    now,
    "America/Los_Angeles",
    "yyyy-MM-dd",
  );
  const tomorrow = new Date(`${pacificDate}T00:00:00-08:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

function base64Url_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/, "");
}

function jsonAudit_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function auditProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing ${name} Script Property.`);
  if (name === "FIREBASE_WEB_API_KEY" && /PRIVATE KEY|BEGIN|END/.test(value)) {
    throw new Error(
      "FIREBASE_WEB_API_KEY is misconfigured. Use the Firebase Web app apiKey (starts with AIza), not the service-account private key.",
    );
  }
  return value;
}

function authorizeAudit_(idToken) {
  if (!idToken || String(idToken).length > 5000)
    throw new Error("Missing or invalid Firebase token.");
  const webApiKey = auditProperty_("FIREBASE_WEB_API_KEY").trim();
  if (!/^AIza[\w-]+$/.test(webApiKey))
    throw new Error(
      "FIREBASE_WEB_API_KEY must be the Firebase Web app apiKey, not a private key or service-account credential.",
    );
  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(webApiKey)}`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ idToken }),
      muteHttpExceptions: true,
    },
  );
  const result = JSON.parse(response.getContentText() || "{}");
  const user = result.users && result.users[0];
  if (response.getResponseCode() !== 200 || !user || !user.localId)
    throw firebaseAuthFailure_(response.getResponseCode(), result);
  const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(auditProperty_("FIRESTORE_PROJECT_ID"))}/databases/(default)/documents/users/${encodeURIComponent(user.localId)}`;
  const profileResponse = UrlFetchApp.fetch(profileUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
    muteHttpExceptions: true,
  });
  const profile = JSON.parse(profileResponse.getContentText() || "{}");
  if (profileResponse.getResponseCode() !== 200 || !profile.fields)
    throw new Error("No authorized Firestore profile found.");
  const role = firestoreString_(profile.fields.role);
  const status = firestoreString_(profile.fields.status);
  if (status !== "Active") throw new Error("Your account is not active.");
  return { uid: user.localId, email: user.email || "", role, photoURL: auditPhotoURL_(firestoreString_(profile.fields.photoURL)) };
}

function firebaseAuthFailure_(httpStatus, result) {
  const code = String(result.error && result.error.message || "UNKNOWN_ERROR")
    .split(/[:\s]/)[0]
    .slice(0, 80);
  const guidance = {
    API_KEY_INVALID: "Verify FIREBASE_WEB_API_KEY is the apiKey from this school's Firebase Web App.",
    API_KEY_SERVICE_BLOCKED: "Check that the Firebase API key permits Identity Toolkit API requests from Apps Script.",
    INVALID_ID_TOKEN: "The sign-in token was rejected; sign out and sign in again, then retry.",
    USER_DISABLED: "This Firebase Authentication account is disabled.",
    USER_NOT_FOUND: "The Firebase Authentication account was not found.",
    PROJECT_NOT_FOUND: "Verify the Firebase API key and FIRESTORE_PROJECT_ID refer to the same school project.",
  }[code];
  return new Error(
    `Firebase authentication failed (${code}, HTTP ${httpStatus}). ${guidance || "Verify the school's Firebase API key and sign-in session."}`,
  );
}

function firestoreString_(field) {
  if (!field) return "";
  return (
    field.stringValue || String(field.integerValue || field.booleanValue || "")
  );
}

function auditText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function auditId_(value) {
  return auditText_(value, 300).replace(/[^a-zA-Z0-9._:@,|/\- ]/g, "");
}

// Additional fields apply only to administrative events, never learner profiles.
const AUDIT_ADMIN_FIELDS = [
  "name", "email", "teacherAssignment", "teacherAssignments", "teacherAssignmentSchoolYear", "teacherName", "adviser",
  "sourceYear", "copiedSections", "copiedCurriculumGrades", "copiedGradingLevels", "copiedTeacherAssignments", "preservedTeacherAssignments",
  "subjectId", "subjectIds", "label", "trashConfg", "canParentAccess", "canPromoteStudents", "roundType",
  "termCount", "passingThreshold", "gradeLevels", "gradingType", "letterScale", "letter", "min", "max", "finalGradeMode",
  "activeTemplate", "gradeTemplates", "attendanceMonths", "attendanceRows", "id",
  "mode", "restored", "removed", "skipped",
];

function auditPhotoURL_(value) {
  const url = auditText_(value, 2048);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : "";
}

function auditValue_(value, action) {
  if (value == null || value === "") return "";
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch (error) { return auditText_(value, 300); }
  }
  const adminEvent = AUDIT_ADMIN_ACTIONS.includes(action);
  const allowed = AUDIT_SAFE_FIELDS.concat(adminEvent ? AUDIT_ADMIN_FIELDS : []);
  function sanitize(value, depth, parent) {
    if (depth > 6) return "[omitted]";
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object") return auditText_(value, 160);
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1, parent));
    const safe = {};
    Object.keys(value).slice(0, 100).forEach((key) => {
      const gradeKey = adminEvent && ["gradeLevels", "gradeTemplates"].includes(parent) && /^(kinder|grade[1-6])$/.test(key);
      if (allowed.includes(key) || gradeKey) safe[key] = sanitize(value[key], depth + 1, key);
    });
    return safe;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) return auditText_(parsed, 300);
  const result = JSON.stringify(sanitize(parsed, 0, ""));
  // Keep JSON valid so reads can apply the same redaction again.
  return result.length <= 30000 ? result : JSON.stringify({ status: "Audit details exceed the storage limit" });
}

function auditSheet_(value) {
  const label = auditText_(value, 100);
  return /^(learners|dropout|transferredOut|users|sections|schoolYears|settings|enrollment|audit)([_a-zA-Z0-9-]*)$/i.test(
    label,
  )
    ? label
    : "application";
}

function auditSpreadsheet_() {
  return SpreadsheetApp.openById(auditProperty_("AUDIT_SPREADSHEET_ID"));
}

function auditSheetObject_() {
  const spreadsheet = auditSpreadsheet_();
  let sheet = spreadsheet.getSheetByName("AuditLog");
  if (!sheet) sheet = spreadsheet.insertSheet("AuditLog");
  const headers = sheet
    .getRange(1, 1, 1, AUDIT_HEADERS.length)
    .getValues()[0]
    .map(String);
  if (
    !AUDIT_HEADERS.every((header, index) => headers[index].trim() === header)
  ) {
    sheet.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, AUDIT_HEADERS.length).setFontWeight("bold");
  }
  return sheet;
}

function appendAuditLog_(auth, action, event) {
  const sheet = auditSheetObject_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000))
    throw new Error("Audit service is busy. Please try again.");
  try {
    sheet.appendRow([
      new Date(),
      auditText_(auth.email, 160),
      action,
      auditSheet_(event.sheet),
      auditId_(event.recordId),
      auditValue_(event.oldValue, action),
      auditValue_(event.newValue, action),
      auditId_(event.ipSession),
      auditId_(auth.uid),
      auditPhotoURL_(auth.photoURL),
    ].map((value) => typeof value === "string" && /^[=+@-]/.test(value) ? "\'" + value : value));
  } finally {
    lock.releaseLock();
  }
}

function readAuditLogs_(requestedPage) {
  const sheet = auditSheetObject_();
  const lastRow = sheet.getLastRow();
  const total = Math.max(0, lastRow - 1);
  const totalPages = Math.ceil(total / AUDIT_PAGE_SIZE);
  const pageValue = requestedPage === undefined || requestedPage === ""
    ? 1
    : Number(requestedPage);
  if (!Number.isInteger(pageValue) || pageValue < 1)
    throw new Error("Audit page must be a positive whole number.");
  const page = totalPages ? Math.min(pageValue, totalPages) : 1;
  const startOffset = (page - 1) * AUDIT_PAGE_SIZE;
  const count = Math.min(AUDIT_PAGE_SIZE, Math.max(0, total - startOffset));
  if (!count) {
    return {
      records: [],
      page,
      pageSize: AUDIT_PAGE_SIZE,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: false,
    };
  }
  const firstRow = lastRow - startOffset - count + 1;
  const rows = sheet
    .getRange(firstRow, 1, count, AUDIT_HEADERS.length)
    .getDisplayValues();
  const records = rows
    .map((row) => ({
      timestamp: row[0],
      user: row[1],
      action: row[2],
      sheet: row[3],
      recordId: row[4],
      oldValue: auditValue_(row[5], row[2]),
      newValue: auditValue_(row[6], row[2]),
      ipSession: auditId_(row[7]),
      userId: auditId_(row[8]),
      photoURL: auditPhotoURL_(row[9]),
    }))
    .reverse();
  return {
    records,
    page,
    pageSize: AUDIT_PAGE_SIZE,
    total,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

function redactExistingAuditLog() {
  const sheet = auditSheetObject_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "AuditLog has no entries to redact.";
  const actions = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
  [6, 7].forEach((column) => {
    const range = sheet.getRange(2, column, lastRow - 1, 1);
    range.setValues(range.getValues().map((row, index) => [auditValue_(row[0], actions[index][0])]));
  });
  return "Existing AuditLog values were redacted.";
}
