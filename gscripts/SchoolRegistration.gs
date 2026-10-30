/**
 * E-Dash school onboarding. Use a NEW spreadsheet-bound Apps Script project.
 * Script properties: SPREADSHEET_ID, REGISTRATION_SHARED_SECRET,
 * REGISTRATION_BASE_URL (https://register.edash.online/).
 * Deploy as a web app: Execute as Me; access Anyone.
 * The secret-authenticated Vercel relay is the only supported HTTP client.
 * No Firebase writes, account creation, or outgoing emails occur here.
 */
var EDASH_REQUEST_HEADERS = [
  'requestId', 'receivedAt', 'status', 'schoolName', 'schoolId', 'contactName',
  'email', 'phone', 'division', 'privacyAcknowledgedAt', 'invitationTokenHash',
  'invitationExpiresAt', 'registrationId', 'invitationCreatedAt'
];
var EDASH_PROFILE_FIELDS = [
  'name', 'officialSchoolId', 'nickname', 'projectName', 'tagline', 'motto',
  'colorGradientTag', 'region', 'divisionOffice', 'district', 'schoolAddr',
  'schoolEmail', 'contactNumber', 'fbPage', 'headName', 'headPosition', 'headEmail',
  'headPhoneNumber', 'contactName', 'contactRole', 'contactEmail', 'contactPhone', 'driveLink'
];
var EDASH_REGISTRATION_HEADERS = [
  'registrationId', 'requestId', 'submittedAt', 'status'
].concat(EDASH_PROFILE_FIELDS).concat([
  'driveSharingConfirmedAt', 'privacyAcknowledgedAt', 'privacyPolicyUrl', 'schoolProfileJson'
]);

function onOpen() {
  SpreadsheetApp.getUi().createMenu('E-Dash registration')
    .addItem('Initialize registration sheets', 'initializeRegistrationSheets')
    .addItem('Create / renew link for selected request', 'createSelectedRegistrationLink')
    .addToUi();
}

function initializeRegistrationSheets() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var book = edashBook_();
    edashSheet_(book, 'Requests', EDASH_REQUEST_HEADERS, true);
    edashSheet_(book, 'Registrations', EDASH_REGISTRATION_HEADERS, true);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

/** Read-only editor diagnostic. Logs configuration flags, never IDs or secrets. */
function checkRegistrationSetup() {
  var properties = PropertiesService.getScriptProperties();
  var result = {
    secretConfigured: (properties.getProperty('REGISTRATION_SHARED_SECRET') || '').trim().length >= 32,
    spreadsheetConfigured: !!(properties.getProperty('SPREADSHEET_ID') || '').trim(),
    spreadsheetAccessible: false,
    sheets: {},
    ready: false
  };
  if (result.spreadsheetConfigured) {
    try {
      var book = edashBook_();
      result.spreadsheetAccessible = true;
      var boundBook = SpreadsheetApp.getActiveSpreadsheet();
      result.matchesBoundSpreadsheet = boundBook ? boundBook.getId() === book.getId() : null;
      [['Requests', EDASH_REQUEST_HEADERS], ['Registrations', EDASH_REGISTRATION_HEADERS]].forEach(function (entry) {
        var sheet = book.getSheetByName(entry[0]);
        result.sheets[entry[0]] = !sheet ? 'missing' : sheet.getLastRow() === 0 ? 'empty'
          : sheet.getMaxColumns() >= entry[1].length && sheet.getRange(1, 1, 1, entry[1].length).getValues()[0].join('|') === entry[1].join('|') ? 'ready' : 'schema mismatch';
      });
      result.ready = result.secretConfigured && Object.keys(result.sheets).every(function (name) { return result.sheets[name] !== 'schema mismatch'; });
    } catch (ignored) { result.code = 'REGISTRATION_SPREADSHEET_ACCESS'; }
  }
  console.log(JSON.stringify(result));
  return result;
}

/** Run from the spreadsheet menu after manually reviewing a Requests row. */
function createSelectedRegistrationLink() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = active.getActiveSheet();
  var row = sheet.getActiveRange().getRow();
  if (active.getId() !== edashBook_().getId() || sheet.getName() !== 'Requests' || row < 2) {
    throw new Error('Select a data row in the configured Requests sheet first.');
  }
  var base = PropertiesService.getScriptProperties().getProperty('REGISTRATION_BASE_URL');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/(?:register\/?)?$/.test(base || '')) {
    throw new Error('Set REGISTRATION_BASE_URL to https://register.edash.online/ first.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var token, request;
  try {
    edashSheet_(active, 'Requests', EDASH_REQUEST_HEADERS, false);
    request = edashReadRow_(sheet, row, EDASH_REQUEST_HEADERS);
    var existing = edashFindRow_(edashSheet_(active, 'Registrations', EDASH_REGISTRATION_HEADERS, false), 2, request.requestId);
    if (!request.requestId || existing || request.registrationId || request.status === 'Rejected') {
      throw new Error('This request is empty, rejected, or already completed.');
    }
    // Two independently generated UUIDs; persist only SHA-256, never the raw token.
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    request.invitationTokenHash = edashHash_(token);
    request.invitationExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    request.invitationCreatedAt = new Date().toISOString();
    request.status = 'Invited';
    edashWriteRow_(sheet, row, EDASH_REQUEST_HEADERS, request);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  var link = base + '#token=' + token;
  var html = '<div style="font:14px/1.6 Arial;padding:16px"><h2>Registration invitation</h2>' +
    '<p>Manually email this link to the school contact after review. Creating a link does not send an email.</p>' +
    '<p><strong>School:</strong> ' + edashHtml_(request.schoolName) + '<br><strong>Email:</strong> ' + edashHtml_(request.email) + '</p>' +
    '<p>Expires: ' + edashHtml_(request.invitationExpiresAt) + '. Any earlier invitation link has been revoked.</p>' +
    '<textarea readonly style="width:100%;height:100px" onclick="this.select()">' + edashHtml_(link) + '</textarea>' +
    '<p>Treat this link as private. Anyone with it can complete this school’s registration.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(400), 'Copy school invitation');
}

function doGet() {
  return edashJson_({ ok: false, status: 405, error: 'Use the E-Dash registration form.' });
}

function doPost(e) {
  var lock;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 24576) edashReject_(400, 'Invalid registration data.');
    var payload;
    try { payload = JSON.parse(raw); } catch (ignored) { edashReject_(400, 'Invalid registration data.'); }
    var secret = (PropertiesService.getScriptProperties().getProperty('REGISTRATION_SHARED_SECRET') || '').trim();
    if (secret.length < 32) edashReject_(503, 'School registration is not configured yet. Please contact the E-Dash team.', 'REGISTRATION_SECRET_MISSING');
    if (!payload || Array.isArray(payload) || typeof payload.sharedSecret !== 'string' ||
        !edashEqual_(edashHash_(payload.sharedSecret), edashHash_(secret))) {
      edashReject_(403, 'Registration access denied.', 'REGISTRATION_SECRET_MISMATCH');
    }
    if (['submitSchoolRegistration', 'getSchoolInvitation', 'submitCompleteSchoolRegistration'].indexOf(payload.action) < 0) {
      edashReject_(400, 'Invalid registration action.');
    }
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) edashReject_(503, 'Registration is busy. Please try again shortly.');
    var book = edashBook_();
    // A valid first submission can start with a completely empty spreadsheet.
    // Only missing/empty tabs are initialized; existing data/headers are checked.
    var initialize = payload.action === 'submitSchoolRegistration';
    var requests = edashSheet_(book, 'Requests', EDASH_REQUEST_HEADERS, initialize);
    var registrations = edashSheet_(book, 'Registrations', EDASH_REGISTRATION_HEADERS, initialize);
    var data;
    if (payload.action === 'submitSchoolRegistration') {
      data = edashSubmitRequest_(requests, payload);
    } else {
      var found = edashInvitation_(requests, payload.token);
      // Recover from an interrupted request-row update after a durable profile write.
      var completedRow = edashFindRow_(registrations, 2, found.request.requestId);
      if (completedRow) {
        var completed = edashReadRow_(registrations, completedRow, EDASH_REGISTRATION_HEADERS);
        data = { registrationId: completed.registrationId, status: 'Submitted', duplicate: true };
      } else {
        if (new Date(found.request.invitationExpiresAt).getTime() <= Date.now() ||
            !isFinite(new Date(found.request.invitationExpiresAt).getTime())) {
          edashReject_(410, 'This invitation has expired. Reply to the E-Dash team’s email to request a new link.');
        }
        if (found.request.status !== 'Invited') edashReject_(403, 'This invitation is unavailable. Contact the E-Dash team.');
        data = payload.action === 'getSchoolInvitation'
          ? edashInvitationData_(found.request)
          : edashSubmitProfile_(requests, registrations, found, payload);
      }
    }
    SpreadsheetApp.flush();
    return edashJson_({ ok: true, data: data });
  } catch (error) {
    // No request data or credentials in logs or public error responses.
    return edashJson_({ ok: false, status: error.publicStatus || 503,
      error: error.publicStatus ? error.message : 'Registration could not be saved. Please try again later.',
      code: error.publicCode || (error.publicStatus ? undefined : 'REGISTRATION_STORAGE_UNAVAILABLE') });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function edashSubmitRequest_(sheet, payload) {
  if (payload.website) edashReject_(400, 'Registration could not be submitted.');
  var request = {
    schoolName: edashText_(payload.schoolName, 'School name', 120, true),
    schoolId: edashText_(payload.schoolId, 'School ID', 30, true),
    contactName: edashText_(payload.contactName, 'Contact name', 120, true),
    email: edashEmail_(payload.email, 'Contact email'),
    phone: edashText_(payload.phone, 'Phone number', 40, true),
    division: edashText_(payload.division, 'Schools division', 120, true)
  };
  if (payload.privacyAcknowledged !== true) edashReject_(400, 'Please acknowledge the Privacy Policy.');
  var key = edashHash_(request.schoolId.toLowerCase() + '|' + request.email);
  var matches = sheet.getLastRow() > 1
    ? sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).createTextFinder(request.schoolId).matchEntireCell(true).matchCase(false).findAll() : [];
  for (var i = 0; i < matches.length; i++) {
    var saved = edashReadRow_(sheet, matches[i].getRow(), EDASH_REQUEST_HEADERS);
    if (saved.email.toLowerCase() === request.email) return { requestId: saved.requestId, duplicate: true, status: 'Received' };
  }
  // Best-effort shared cache throttles repeated requests; not a substitute for WAF rules.
  var cache = CacheService.getScriptCache();
  var emailKey = 'registration-email:' + edashHash_(request.email);
  if (Number(cache.get(emailKey) || 0) >= 5) edashReject_(429, 'Too many requests for this email. Please try again in an hour.');
  var now = new Date().toISOString();
  request.requestId = 'REQ-' + Utilities.getUuid();
  request.receivedAt = now; request.status = 'Pending'; request.privacyAcknowledgedAt = now;
  edashWriteRow_(sheet, sheet.getLastRow() + 1, EDASH_REQUEST_HEADERS, request);
  cache.put(emailKey, String(Number(cache.get(emailKey) || 0) + 1), 3600);
  return { requestId: request.requestId, duplicate: false, status: 'Received' };
}

function edashSubmitProfile_(requests, registrations, found, payload) {
  var fields = payload.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || fields.website) edashReject_(400, 'Invalid school information.');
  if (payload.privacyAcknowledged !== true || payload.driveSharingConfirmed !== true) edashReject_(400, 'Confirm the Privacy Policy and Drive sharing settings.');
  var optional = ['projectName', 'tagline', 'motto', 'fbPage'];
  var limits = { name: 120, nickname: 64, officialSchoolId: 30, projectName: 120, tagline: 240, motto: 240,
    colorGradientTag: 7, schoolAddr: 300, schoolEmail: 254, fbPage: 500, headEmail: 160,
    contactEmail: 254, contactNumber: 40, headPhoneNumber: 40, contactPhone: 40, driveLink: 1000 };
  var values = {};
  EDASH_PROFILE_FIELDS.forEach(function (field) {
    values[field] = edashText_(fields[field], field, limits[field] || 160, optional.indexOf(field) < 0);
  });
  ['schoolEmail', 'headEmail', 'contactEmail'].forEach(function (field) { values[field] = edashEmail_(values[field], field); });
  if (values.officialSchoolId !== found.request.schoolId) edashReject_(400, 'The DepEd school ID must match your invitation. Contact the E-Dash team to correct it.');
  if (!/^#[0-9a-f]{6}$/i.test(values.colorGradientTag)) edashReject_(400, 'Choose a valid school brand color.');
  if (values.fbPage && !/^https:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.com)\/[\S]+$/i.test(values.fbPage)) edashReject_(400, 'Enter a valid https:// Facebook page link.');
  if (!/^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|file\/d)\/[A-Za-z0-9_-]+\/?(?:\?[^\s#]*)?(?:#[^\s]*)?$/.test(values.driveLink)) {
    edashReject_(400, 'Enter a Google Drive folder or file sharing link.');
  }
  var now = new Date().toISOString();
  var registrationId = 'REG-' + Utilities.getUuid();
  var profile = {
    name: values.name, nickname: values.nickname, projectName: values.projectName,
    tagline: values.tagline, colorGradientTag: values.colorGradientTag,
    schoolInfo: { id: values.officialSchoolId, region: values.region, divisionOffice: values.divisionOffice,
      district: values.district, schoolAddr: values.schoolAddr, email: values.schoolEmail,
      contactNumber: values.contactNumber, fbPage: values.fbPage, motto: values.motto },
    schoolHead: { name: values.headName, position: values.headPosition, email: values.headEmail, phoneNumber: values.headPhoneNumber }
  };
  var record = Object.assign({}, values, {
    registrationId: registrationId, requestId: found.request.requestId, submittedAt: now,
    status: 'Awaiting setup', driveSharingConfirmedAt: now, privacyAcknowledgedAt: now,
    privacyPolicyUrl: 'https://www.edash.online/privacy-policy', schoolProfileJson: JSON.stringify(profile)
  });
  // Durable write first. A retry checks requestId before writing another profile.
  edashWriteRow_(registrations, registrations.getLastRow() + 1, EDASH_REGISTRATION_HEADERS, record);
  SpreadsheetApp.flush();
  found.request.status = 'Awaiting setup'; found.request.registrationId = registrationId;
  edashWriteRow_(requests, found.row, EDASH_REQUEST_HEADERS, found.request);
  return { registrationId: registrationId, status: 'Awaiting setup' };
}

function edashInvitation_(sheet, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) edashReject_(403, 'This invitation is invalid. Use the complete link emailed by the E-Dash team.');
  var row = edashFindRow_(sheet, 11, edashHash_(token));
  if (!row) edashReject_(403, 'This invitation is invalid or has been replaced. Use the latest link emailed by the E-Dash team.');
  var request = edashReadRow_(sheet, row, EDASH_REQUEST_HEADERS);
  if (request.status === 'Rejected') edashReject_(403, 'This invitation is unavailable. Contact the E-Dash team.');
  return { row: row, request: request };
}

function edashInvitationData_(request) {
  return { schoolName: request.schoolName, schoolId: request.schoolId, contactName: request.contactName,
    email: request.email, phone: request.phone, division: request.division };
}
function edashBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) edashReject_(503, 'Registration storage is not configured. Please contact the E-Dash team.', 'REGISTRATION_SPREADSHEET_MISSING');
  try { return SpreadsheetApp.openById(id.trim()); }
  catch (ignored) { edashReject_(503, 'Registration storage is unavailable. Please contact the E-Dash team.', 'REGISTRATION_SPREADSHEET_ACCESS'); }
}
function edashSheet_(book, name, headers, initialize) {
  var sheet = book.getSheetByName(name);
  if (!sheet && initialize) sheet = book.insertSheet(name);
  if (!sheet) edashReject_(503, 'Registration storage is not ready. Please contact the E-Dash team.', 'REGISTRATION_SHEETS_NOT_INITIALIZED');
  if (sheet.getLastRow() === 0 && initialize) {
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e6f2ec');
    sheet.setFrozenRows(1);
  }
  if (sheet.getMaxColumns() < headers.length || sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
    edashReject_(503, 'Registration storage needs administrator attention. Please contact the E-Dash team.', 'REGISTRATION_SHEET_SCHEMA_MISMATCH');
  }
  return sheet;
}
function edashFindRow_(sheet, column, value) {
  if (sheet.getLastRow() < 2 || !value) return 0;
  var match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findNext();
  return match ? match.getRow() : 0;
}
function edashReadRow_(sheet, row, headers) {
  var values = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  var result = {};
  headers.forEach(function (key, index) { result[key] = values[index]; });
  return result;
}
function edashWriteRow_(sheet, row, headers, values) {
  // Plain text preserves leading zeroes. Escape formula prefixes in ALL cells.
  var cells = headers.map(function (key) {
    var text = values[key] === undefined ? '' : String(values[key]);
    return /^[=+@\-\t\r\n]/.test(text) ? "'" + text : text;
  });
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  sheet.getRange(row, 1, 1, headers.length).setNumberFormat('@').setValues([cells]);
}
function edashText_(value, label, max, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') edashReject_(400, label + ' must be text.');
  var text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) edashReject_(400, 'Check ' + label + ' (maximum ' + max + ' characters).');
  return text;
}
function edashEmail_(value, label) {
  var email = edashText_(value, label, 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) edashReject_(400, 'Enter a valid ' + label + '.');
  return email;
}
function edashHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
function edashEqual_(left, right) {
  var diff = left.length ^ right.length;
  for (var i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function edashReject_(status, message, code) { var error = new Error(message); error.publicStatus = status; error.publicCode = code; throw error; }
function edashJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function edashHtml_(value) { return String(value).replace(/[&<>"']/g, function (char) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]; }); }
