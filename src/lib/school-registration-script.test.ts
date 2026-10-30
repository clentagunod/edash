// Exercise the actual Apps Script source with an in-memory Sheets service.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync('gscripts/SchoolRegistration.gs', 'utf8');
const secret = 'test-only-secret-that-is-at-least-32-characters';
const initial = { schoolName: 'Sample School', schoolId: '001234', contactName: 'School Admin',
  email: 'admin@example.com', phone: '+639123456789', division: 'Sample Division', privacyAcknowledged: true };
const fields = {
  name: 'Sample School', officialSchoolId: '001234', nickname: 'Sample ES', projectName: '', tagline: '', motto: '',
  colorGradientTag: '#176b5b', region: 'XI', divisionOffice: 'Sample Division', district: 'District 1',
  schoolAddr: '123 School Street', schoolEmail: 'school@example.com', contactNumber: '+639123456789', fbPage: '',
  headName: 'School Head', headPosition: 'Principal', headEmail: 'head@example.com', headPhoneNumber: '+639123456789',
  contactName: 'School Admin', contactRole: 'School ICT coordinator', contactEmail: 'admin@example.com',
  contactPhone: '+639123456789', driveLink: 'https://drive.google.com/drive/folders/school_assets?usp=sharing',
};

function setup(initialize = true) {
  let dialog = '';
  let active: any;
  const sheets = new Map<string, any>();
  const properties = { SPREADSHEET_ID: 'test-book', REGISTRATION_SHARED_SECRET: secret, REGISTRATION_BASE_URL: 'https://register.edash.online/' };
  const cache = new Map();
  let locked = false;
  const lock = { waitLock() { locked = true; }, tryLock() { locked = true; return true; },
    hasLock: () => locked, releaseLock() { locked = false; } };
  class Range {
    constructor(public sheet: any, public row: number, public column: number, public rows = 1, public columns = 1) {}
    getRow() { return this.row; }
    setValues(values: any[][]) {
      values.forEach((cells, r) => cells.forEach((value, c) => {
        this.sheet.data[this.row + r - 1] ||= [];
        this.sheet.data[this.row + r - 1][this.column + c - 1] = value;
      })); return this;
    }
    getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.data[this.row + r - 1]?.[this.column + c - 1] ?? '')); }
    getDisplayValues() { return this.getValues().map((row) => row.map((value) => String(value).replace(/^'/, ''))); }
    setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
    createTextFinder(text: string) {
      let caseSensitive = false;
      const finder = {
        matchEntireCell() { return finder; }, matchCase(value: boolean) { caseSensitive = value; return finder; },
        findAll: () => this.getDisplayValues().flatMap((row, index) => {
          const value = row[0];
          return (caseSensitive ? value === text : value.toLowerCase() === text.toLowerCase())
            ? [new Range(this.sheet, this.row + index, this.column)] : [];
        }), findNext: () => finder.findAll()[0] || null,
      }; return finder;
    }
  }
  const book = {
    getId: () => 'test-book', getSheetByName: (name: string) => sheets.get(name), getActiveSheet: () => active,
    insertSheet(name: string) {
      const sheet = { data: [] as any[][], getName: () => name, getLastRow: () => sheet.data.length,
        getMaxRows: () => 1000, getMaxColumns: () => 50, setFrozenRows() {}, insertRowsAfter() {},
        getActiveRange: () => new Range(sheet, 2, 1),
        getRange: (r: number, c: number, rows?: number, cols?: number) => new Range(sheet, r, c, rows, cols) };
      sheets.set(name, sheet); return sheet;
    },
  };
  const context: any = vm.createContext({
    Date, Object, PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] }) },
    LockService: { getScriptLock: () => lock }, CacheService: { getScriptCache: () => ({ get: (key: string) => cache.get(key), put: (key: string, value: string) => cache.set(key, value) }) },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm: unknown, value: string) => [...createHash('sha256').update(value).digest()] },
    SpreadsheetApp: { openById: () => book, getActiveSpreadsheet: () => book, flush() {},
      getUi: () => ({ showModalDialog(html: any) { dialog = html.value; } }) },
    HtmlService: { createHtmlOutput: (value: string) => { const html = { value, setWidth: () => html, setHeight: () => html }; return html; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (value: string) => ({ setMimeType: () => JSON.parse(value) }) },
  });
  vm.runInContext(source, context);
  if (initialize) context.initializeRegistrationSheets();
  active = sheets.get('Requests');
  const call = (action: string, payload: object = {}) => context.doPost({ postData: { contents: JSON.stringify({ action, sharedSecret: secret, ...payload }) } });
  const invite = () => {
    context.createSelectedRegistrationLink();
    return /#token=([a-f0-9]{64})/.exec(dialog)![1];
  };
  const records = (name: string) => {
    const data = sheets.get(name).data;
    return data.slice(1).map((row) => Object.fromEntries(data[0].map((key, index) => [key, String(row[index] ?? '').replace(/^'/, '')])));
  };
  return { call, invite, records, sheets, context, lock, properties };
}

describe('Google Sheets school onboarding', () => {
  it('checks setup without creating tabs, logging identifiers, or writing requests', () => {
    const app = setup(false);
    const result = app.context.checkRegistrationSetup();
    expect(result).toMatchObject({ ready: true, spreadsheetAccessible: true, matchesBoundSpreadsheet: true, sheets: { Requests: 'missing', Registrations: 'missing' } });
    expect(app.sheets.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('test-book');
    app.context.SpreadsheetApp.getActiveSpreadsheet = () => ({ getId: () => 'another-book' });
    expect(app.context.checkRegistrationSetup().matchesBoundSpreadsheet).toBe(false);
    expect(app.sheets.size).toBe(0);
  });
  it('initializes a completely empty spreadsheet on the first authenticated submission and saves exactly one row', () => {
    const app = setup(false);
    expect(app.sheets.size).toBe(0);
    expect(app.call('submitSchoolRegistration', { ...initial, sharedSecret: 'wrong' }).status).toBe(403);
    expect(app.sheets.size).toBe(0);
    const result = app.call('submitSchoolRegistration', initial);
    expect(result).toMatchObject({ ok: true, data: { status: 'Received', duplicate: false, requestId: expect.stringMatching(/^REQ-/) } });
    expect(app.records('Requests')).toHaveLength(1);
    expect(app.records('Registrations')).toHaveLength(0);
    expect(app.call('submitSchoolRegistration', initial).data).toMatchObject({ duplicate: true, requestId: result.data.requestId });
    expect(app.records('Requests')).toHaveLength(1);
  });

  it('does not overwrite existing sheet data or mismatched headers', () => {
    const app = setup();
    app.sheets.get('Requests').data[0][0] = 'different header';
    const before = JSON.stringify(app.sheets.get('Requests').data);
    expect(app.call('submitSchoolRegistration', initial)).toMatchObject({ ok: false, status: 503, code: 'REGISTRATION_SHEET_SCHEMA_MISMATCH' });
    expect(JSON.stringify(app.sheets.get('Requests').data)).toBe(before);
  });

  it('reports missing spreadsheet configuration and normalizes surrounding secret whitespace', () => {
    const app = setup();
    app.properties.REGISTRATION_SHARED_SECRET = `  ${secret}  `;
    expect(app.call('submitSchoolRegistration', initial).ok).toBe(true);
    app.properties.SPREADSHEET_ID = '';
    expect(app.call('submitSchoolRegistration', initial)).toMatchObject({ ok: false, status: 503, code: 'REGISTRATION_SPREADSHEET_MISSING' });
  });
  it('rejects unauthenticated, malformed, honeypot and unacknowledged requests without storing data', () => {
    const app = setup();
    expect(app.call('submitSchoolRegistration', { ...initial, sharedSecret: 'wrong' }).status).toBe(403);
    expect(app.call('submitSchoolRegistration', { ...initial, privacyAcknowledged: false }).status).toBe(400);
    expect(app.call('submitSchoolRegistration', { ...initial, website: 'bot' }).status).toBe(400);
    expect(app.context.doPost({ postData: { contents: '{' } }).status).toBe(400);
    expect(app.records('Requests')).toHaveLength(0);
    expect(app.lock.hasLock()).toBe(false);
  });

  it('saves and deduplicates initial requests and preserves official school IDs and phone numbers', () => {
    const app = setup();
    expect(app.call('submitSchoolRegistration', initial).ok).toBe(true);
    expect(app.call('submitSchoolRegistration', { ...initial, email: 'ADMIN@example.com' }).data.duplicate).toBe(true);
    expect(app.records('Requests')).toHaveLength(1);
    expect(app.records('Requests')[0]).toMatchObject({ schoolId: '001234', phone: '+639123456789', status: 'Pending' });
    expect(app.call('submitSchoolRegistration', { ...initial, schoolId: 'different' })).toMatchObject({ ok: true });
  });

  it('runs the invitation-to-profile flow, writes registry-shaped JSON, and safely retries submissions', () => {
    const app = setup();
    app.call('submitSchoolRegistration', initial);
    const token = app.invite();
    expect(app.records('Requests')[0].invitationTokenHash).not.toBe(token);
    expect(app.call('getSchoolInvitation', { token }).data).toMatchObject({ schoolId: '001234', email: initial.email });
    const payload = { token, fields, driveSharingConfirmed: true, privacyAcknowledged: true };
    const result = app.call('submitCompleteSchoolRegistration', payload);
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('Awaiting setup');
    expect(app.call('submitCompleteSchoolRegistration', payload).data.registrationId).toBe(result.data.registrationId);
    expect(app.call('getSchoolInvitation', { token }).data.registrationId).toBe(result.data.registrationId);
    expect(app.records('Registrations')).toHaveLength(1);
    expect(app.records('Requests')[0].registrationId).toBe(result.data.registrationId);
    const profile = JSON.parse(app.records('Registrations')[0].schoolProfileJson);
    expect(profile.schoolInfo).toMatchObject({ id: '001234', schoolAddr: fields.schoolAddr });
    expect(profile.schoolHead).toMatchObject({ name: fields.headName, position: fields.headPosition });
    expect(profile).not.toHaveProperty('firebaseConfig');
    expect(profile).not.toHaveProperty('enabled');
  });

  it('revokes old links on renewal and rejects expired or rejected invitations', () => {
    const app = setup(); app.call('submitSchoolRegistration', initial);
    const old = app.invite(); const token = app.invite();
    expect(app.call('getSchoolInvitation', { token: old }).status).toBe(403);
    app.sheets.get('Requests').data[1][11] = '2000-01-01T00:00:00.000Z';
    expect(app.call('getSchoolInvitation', { token }).status).toBe(410);
    app.sheets.get('Requests').data[1][2] = 'Rejected';
    expect(app.call('getSchoolInvitation', { token }).status).toBe(403);
  });

  it('validates school identity, Drive host and confirmations on the server', () => {
    const app = setup(); app.call('submitSchoolRegistration', initial); const token = app.invite();
    const payload = { token, fields, driveSharingConfirmed: true, privacyAcknowledged: true };
    for (const invalid of [
      { ...payload, driveSharingConfirmed: false },
      { ...payload, fields: { ...fields, officialSchoolId: 'other-school' } },
      { ...payload, fields: { ...fields, driveLink: 'https://drive.google.com.attacker.com/drive/folders/a' } },
      { ...payload, fields: { ...fields, driveLink: 'https://drive.google.com/drive/folders/id/extra' } },
      { ...payload, fields: { ...fields, headEmail: 'invalid' } },
    ]) expect(app.call('submitCompleteSchoolRegistration', invalid).status).toBe(400);
    expect(app.records('Registrations')).toHaveLength(0);
  });

  it('neutralizes spreadsheet formula injection and recovers a partially updated request', () => {
    const app = setup(); app.call('submitSchoolRegistration', initial); const token = app.invite();
    const payload = { token, fields: { ...fields, motto: '=IMPORTXML("https://example.com")' }, driveSharingConfirmed: true, privacyAcknowledged: true };
    const saved = app.call('submitCompleteSchoolRegistration', payload);
    const sheet = app.sheets.get('Registrations');
    expect(sheet.data[1][sheet.data[0].indexOf('motto')]).toMatch(/^'=/);
    app.sheets.get('Requests').data[1][2] = 'Invited';
    app.sheets.get('Requests').data[1][12] = '';
    expect(app.call('submitCompleteSchoolRegistration', payload).data.registrationId).toBe(saved.data.registrationId);
    expect(app.records('Registrations')).toHaveLength(1);
  });
});
