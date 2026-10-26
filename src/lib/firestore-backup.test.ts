import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFirestore } = vi.hoisted(() => {
  const state = { documents: new Map(), commits: [], readErrors: new Map() };
  const checkRead = (path) => {
    if (state.readErrors.has(path)) throw state.readErrors.get(path);
  };
  const snapshot = (path) => {
    const exists = state.documents.has(path);
    const ref = documentRef(path);
    return {
      exists,
      id: path.split("/").at(-1),
      ref,
      data: () => state.documents.get(path),
    };
  };
  const documentRef = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => collectionRef(`${path}/${name}`),
    get: async () => {
      checkRead(path);
      return snapshot(path);
    },
  });
  const collectionRef = (path) => ({
    path,
    doc: (id) => documentRef(`${path}/${id}`),
    get: async () => {
      checkRead(path);
      const depth = path.split("/").length + 1;
      const prefix = `${path}/`;
      const docs = [...state.documents.keys()]
        .filter((documentPath) => documentPath.startsWith(prefix) && documentPath.split("/").length === depth)
        .map((documentPath) => snapshot(documentPath));
      return { docs, empty: docs.length === 0 };
    },
  });
  const db = {
    collection: collectionRef,
    doc: documentRef,
    batch: () => {
      const operations = [];
      return {
        set: (ref, data, options) => operations.push({ type: "set", path: ref.path, data, options }),
        delete: (ref) => operations.push({ type: "delete", path: ref.path }),
        commit: async () => {
          state.commits.push(operations);
          operations.forEach((operation) => {
            if (operation.type === "set") {
              const nextData = operation.options?.merge
                ? { ...(state.documents.get(operation.path) || {}), ...operation.data }
                : operation.data;
              state.documents.set(operation.path, nextData);
            }
            else state.documents.delete(operation.path);
          });
        },
      };
    },
  };
  return { mockFirestore: { state, db, auth: { currentUser: { uid: "admin-1" } } } };
});

vi.mock("./app-config", () => ({
  APP_CONFIG: {
    firestore: { schemaVersion: 3 },
    schoolId: "school-a",
    branding: { schoolName: "School A" },
  },
}));
vi.mock("./firebase", () => ({ auth: mockFirestore.auth, db: mockFirestore.db }));
vi.mock("./firestore-api", () => ({
  FS_DOCUMENTS: { gradeTerms: "gradeTerms" },
  FS_LEARNERS: "learners",
  FS_PATHS: {
    assignmentHistory: "assignmentHistory",
    gradeTermYears: "years",
    grades: "grades",
    sections: "sections",
    teachers: "teachers",
  },
  FS_SCHOOL_YEARS: "schoolYears",
  FS_SETTINGS: "settings",
  FS_TRANSFERRED_OUT: "transferredOut",
  FS_DROPOUTS: "dropouts",
  FS_USERS: "users",
  fsInvalidateReadCaches_: vi.fn(),
}));
vi.mock("./shell", () => ({
  clearButtonLoading: vi.fn(),
  setButtonLoading: vi.fn(),
  showToast: vi.fn(),
}));

import {
  collectFirestoreBackup,
  downloadFirestoreBackup,
  decodeBackupValue,
  encodeBackupValue,
  FIRESTORE_BACKUP_FORMAT,
  FIRESTORE_BACKUP_FORMAT_VERSION,
  FIRESTORE_BACKUP_MODES,
  isSupportedFirestoreBackupPath,
  importFirestoreBackupFile,
  restoreFirestoreBackup,
  updateFirestoreBackupModeWarning,
  validateFirestoreBackup,
} from "./firestore-backup";
import { summarizeFirestoreBackup } from './firestore-backup-review';

const reviewMarkup = `<section id="firestoreBackupReview" hidden><div id="firestoreBackupReviewContent"></div><button id="confirmFirestoreBackupBtn">Review and restore</button><button id="cancelFirestoreBackupBtn">Cancel restore</button></section>`;

vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

class TestTimestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toDate() {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000);
  }
}

class GeoPoint {
  constructor(public latitude: number, public longitude: number) {}
}

function makeBackup(documents = [{
  path: "users/admin-1",
  data: { role: "School Admin", status: "Active" },
}]) {
  return {
    format: FIRESTORE_BACKUP_FORMAT,
    formatVersion: FIRESTORE_BACKUP_FORMAT_VERSION,
    appSchemaVersion: 3,
    schoolId: "school-a",
    schoolName: "School A",
    exportedAt: "2025-01-01T00:00:00.000Z",
    documents,
  };
}

describe("tenant database JSON backup", () => {
  beforeEach(() => {
    mockFirestore.state.documents.clear();
    mockFirestore.state.readErrors.clear();
    mockFirestore.state.commits.length = 0;
    vi.stubGlobal("firebase", {
      firestore: { Timestamp: TestTimestamp, GeoPoint },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:backup"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("round-trips Firestore timestamps, dates, and geographic points", () => {
    const encoded = encodeBackupValue({
      timestamp: new TestTimestamp(1_735_689_600, 125_000_000),
      date: new Date("2025-01-01T12:30:00.000Z"),
      point: new GeoPoint(14.6, 121.0),
    });
    const decoded = decodeBackupValue(JSON.parse(JSON.stringify(encoded)));

    expect(decoded.timestamp).toBeInstanceOf(TestTimestamp);
    expect(decoded.timestamp.seconds).toBe(1_735_689_600);
    expect(decoded.date.toISOString()).toBe("2025-01-01T12:30:00.000Z");
    expect(decoded.point).toBeInstanceOf(GeoPoint);
    expect(decoded.point.latitude).toBe(14.6);
  });

  it("allows only supported app-managed document paths", () => {
    expect(isSupportedFirestoreBackupPath("users/admin-1")).toBe(true);
    expect(isSupportedFirestoreBackupPath("schoolYears/2025-2026/grades/Grade-1/sections/A/teachers/user-1")).toBe(true);
    expect(isSupportedFirestoreBackupPath("custom/private-data")).toBe(false);
    expect(isSupportedFirestoreBackupPath("users/admin-1/unknown/record")).toBe(false);
    expect(isSupportedFirestoreBackupPath("users//admin-1")).toBe(false);
  });

  it("rejects backups from another tenant or schema and duplicate paths", () => {
    expect(() => validateFirestoreBackup({ ...makeBackup(), schoolId: "school-b" }))
      .toThrow(/different school/i);
    expect(() => validateFirestoreBackup({ ...makeBackup(), appSchemaVersion: 99 }))
      .toThrow(/different database schema/i);
    expect(() => validateFirestoreBackup({ ...makeBackup(), exportedAt: "not-a-date" }))
      .toThrow(/valid export date/i);
    expect(() => validateFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
    ]))).toThrow(/duplicate document path/i);
    expect(() => validateFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Disabled" } },
    ]))).toThrow(/active School Admin/i);
  });

  it("rejects malformed Firestore values nested in otherwise valid documents", () => {
    expect(() => validateFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      {
        path: "settings/toggles",
        data: { invalidTimestamp: { __edashFirestoreTimestamp: { seconds: 1, nanoseconds: 1_000_000_000 } } },
      },
    ]))).toThrow(/invalid Firestore timestamp/i);
    expect(() => validateFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "settings/location", data: { point: { __edashFirestoreGeoPoint: { latitude: 91, longitude: 0 } } } },
    ]))).toThrow(/invalid geographic point/i);
  });

  it("shows validation and a summary before the user explicitly starts the restore", async () => {
    document.body.innerHTML = `
      <button id="importFirestoreBackupBtn"></button>
      <p id="firestoreBackupStatus"></p>
      <p id="firestoreBackupValidationStatus"></p>
      <div id="firestoreBackupProgress" aria-valuenow="0"></div>
      ${reviewMarkup}
      ${Array.from({ length: 4 }, () => '<li data-backup-validation-step data-state="pending"><span data-backup-step-state></span></li>').join("")}
    `;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await importFirestoreBackupFile({ text: async () => JSON.stringify(makeBackup()) });

    expect(confirm).not.toHaveBeenCalled();
    expect(document.getElementById('firestoreBackupReview')?.hidden).toBe(false);
    expect(document.getElementById('firestoreBackupReviewContent')?.textContent).toContain('Total documents1');
    expect(mockFirestore.state.commits).toHaveLength(0);
    document.getElementById('confirmFirestoreBackupBtn')?.click();
    expect(confirm).toHaveBeenCalledOnce();
    expect([...document.querySelectorAll("[data-backup-validation-step]")].map((step) => step.dataset.state))
      .toEqual(["complete", "complete", "complete", "complete"]);
    expect(document.getElementById("firestoreBackupProgress")?.getAttribute("aria-valuenow")).toBe("100");
    expect(document.getElementById("firestoreBackupValidationStatus")?.textContent)
      .toContain("Restore canceled; database unchanged");
    expect(mockFirestore.state.commits).toHaveLength(0);
    confirm.mockRestore();
  });

  it("marks a failed schema/tenant layer and does not show replace confirmation", async () => {
    document.body.innerHTML = `
      <button id="importFirestoreBackupBtn"></button>
      <p id="firestoreBackupStatus"></p>
      <p id="firestoreBackupValidationStatus"></p>
      <div id="firestoreBackupProgress" aria-valuenow="0"></div>
      ${Array.from({ length: 4 }, () => '<li data-backup-validation-step data-state="pending"><span data-backup-step-state></span></li>').join("")}
    `;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await importFirestoreBackupFile({ text: async () => JSON.stringify({ ...makeBackup(), schoolId: "another-school" }) });

    expect(confirm).not.toHaveBeenCalled();
    expect([...document.querySelectorAll("[data-backup-validation-step]")].map((step) => step.dataset.state))
      .toEqual(["complete", "error", "pending", "pending"]);
    expect(document.getElementById("firestoreBackupValidationStatus")?.textContent)
      .toContain("different school");
    expect(mockFirestore.state.commits).toHaveLength(0);
    confirm.mockRestore();
  });

  it("collects tenant documents into a sorted, versioned backup", async () => {
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("settings/toggles", { canParentAccess: false });
    mockFirestore.state.documents.set("publicStats/summary", { totalLearners: 12 });

    const backup = await collectFirestoreBackup();

    expect(backup.format).toBe(FIRESTORE_BACKUP_FORMAT);
    expect(backup.appSchemaVersion).toBe(3);
    expect(backup.schoolId).toBe("school-a");
    expect(backup.documents.map(({ path }) => path)).toEqual([
      "publicStats/summary",
      "settings/toggles",
      "users/admin-1",
    ]);
    expect(backup.documents.find(({ path }) => path === "settings/toggles")?.data)
      .toEqual({ canParentAccess: false });
  });

  it.each([
    ["settings", "permission-denied"],
    ["users/admin-1/assignmentHistory", "permission-denied"],
    ["schoolYears/2025-2026/trash", "firestore/permission-denied"],
    ["publicStats/summary", "permission-denied"],
  ])("reports denied reads at %s and never downloads an incomplete backup", async (path, code) => {
    document.body.innerHTML = '<button id="downloadFirestoreBackupBtn"></button><p id="firestoreBackupStatus"></p>';
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("schoolYears/2025-2026", { isCurrent: true });
    mockFirestore.state.readErrors.set(path, Object.assign(new Error("Missing or insufficient permissions."), { code }));

    expect(await downloadFirestoreBackup()).toBeNull();

    const status = document.getElementById("firestoreBackupStatus")?.textContent;
    expect(status).toContain(`Backup cannot read "${path}"`);
    expect(status).toContain("active School Admin");
    expect(status).toContain("deploy the latest firestore.rules to this school's Firebase project");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mockFirestore.state.commits).toHaveLength(0);
  });

  it("preserves non-permission errors when reading a backup", async () => {
    const error = Object.assign(new Error("Network unavailable"), { code: "unavailable" });
    mockFirestore.state.readErrors.set("settings", error);

    await expect(collectFirestoreBackup()).rejects.toBe(error);
  });

  it("restores incoming records and removes stale app-managed records", async () => {
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("settings/toggles", { canParentAccess: true });
    mockFirestore.state.documents.set("settings/obsolete", { value: "remove me" });
    const backup = makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "settings/toggles", data: { canParentAccess: false } },
    ]);

    const result = await restoreFirestoreBackup(backup);

    expect(result).toEqual({ mode: "replace", restored: 2, removed: 1, skipped: 0 });
    expect(mockFirestore.state.documents.get("settings/toggles")).toEqual({ canParentAccess: false });
    expect(mockFirestore.state.documents.has("settings/obsolete")).toBe(false);
  });

  it("merges imported fields and preserves existing records absent from the backup", async () => {
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("settings/toggles", { canParentAccess: true, retainedField: "keep" });
    mockFirestore.state.documents.set("settings/obsolete", { value: "keep this document" });

    const result = await restoreFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "settings/toggles", data: { canParentAccess: false } },
    ]), "merge");

    expect(result).toEqual({ mode: "merge", restored: 2, removed: 0, skipped: 0 });
    expect(mockFirestore.state.documents.get("settings/toggles"))
      .toEqual({ canParentAccess: false, retainedField: "keep" });
    expect(mockFirestore.state.documents.get("settings/obsolete")).toEqual({ value: "keep this document" });
    expect(mockFirestore.state.commits.flat().find(({ path }) => path === "settings/toggles")?.options)
      .toEqual({ merge: true });
  });

  it("extends by adding missing paths and skipping existing records", async () => {
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("settings/toggles", { canParentAccess: true });
    mockFirestore.state.documents.set("settings/obsolete", { value: "keep this document" });

    const result = await restoreFirestoreBackup(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "settings/toggles", data: { canParentAccess: false } },
      { path: "settings/newSetting", data: { enabled: true } },
    ]), "extend");

    expect(result).toEqual({ mode: "extend", restored: 1, removed: 0, skipped: 2 });
    expect(mockFirestore.state.documents.get("settings/toggles")).toEqual({ canParentAccess: true });
    expect(mockFirestore.state.documents.get("settings/newSetting")).toEqual({ enabled: true });
    expect(mockFirestore.state.documents.get("settings/obsolete")).toEqual({ value: "keep this document" });
  });

  it("updates the warning text and passes the selected mode through import confirmation", async () => {
    document.body.innerHTML = `
      <h4 id="backupReplaceWarningTitle"></h4>
      <p id="backupModeWarningDescription"></p>
      <button id="importFirestoreBackupBtn"></button>
      <p id="firestoreBackupStatus"></p>
      <p id="firestoreBackupValidationStatus"></p>
      <div id="firestoreBackupProgress" aria-valuenow="0"></div>
      ${reviewMarkup}
      ${Array.from({ length: 4 }, () => '<li data-backup-validation-step data-state="pending"><span data-backup-step-state></span></li>').join("")}
    `;
    updateFirestoreBackupModeWarning(FIRESTORE_BACKUP_MODES.MERGE);
    expect(document.getElementById("backupReplaceWarningTitle")?.textContent).toContain("Merge mode");
    expect(document.getElementById("backupModeWarningDescription")?.textContent).toContain("left unchanged");

    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    mockFirestore.state.documents.set("settings/toggles", { canParentAccess: true, retainedField: "keep" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await importFirestoreBackupFile({ text: async () => JSON.stringify(makeBackup([
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      { path: "settings/toggles", data: { canParentAccess: false } },
    ])) }, FIRESTORE_BACKUP_MODES.MERGE);

    expect(confirm).not.toHaveBeenCalled();
    document.getElementById('confirmFirestoreBackupBtn')?.click();
    await vi.waitFor(() => expect(document.getElementById("firestoreBackupStatus")?.textContent).toContain("Merge complete"));

    expect(confirm.mock.calls[0][0]).toContain("Merge 2 app-managed database documents");
    expect(mockFirestore.state.documents.get("settings/toggles"))
      .toEqual({ canParentAccess: false, retainedField: "keep" });
    expect(document.getElementById("firestoreBackupStatus")?.textContent).toContain("Merge complete");
    confirm.mockRestore();
  });

  it('counts backup record types and distinct years without counting subcollections as users', () => {
    const paths = [
      'users/admin-1', 'users/admin-1/assignmentHistory/2026-2027',
      'schoolYears/2026-2027', 'schoolYears/2026-2027/learners/123456789012',
      'schoolYears/2025-2026/learners/123456789012', 'schoolYears/2026-2027/trash/deleted',
      'schoolYears/2026-2027/grades/grade6', 'settings/toggles', 'publicStats/summary',
    ];
    expect(summarizeFirestoreBackup(makeBackup(paths.map(path => ({ path, data: {} }))))).toEqual({
      total: 9, years: ['2025-2026', '2026-2027'],
      counts: { students: 2, archives: 1, users: 1, settings: 1, structure: 1, assignments: 1, statistics: 1, yearDocuments: 1 },
    });
  });

  it('cancels a prepared restore and invalidates it when the mode changes', async () => {
    document.body.innerHTML = `<p id="firestoreBackupValidationStatus"></p>${reviewMarkup}`;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const file = { name: '<script>backup</script>.json', text: async () => JSON.stringify({ ...makeBackup(), schoolName: '<img src=x onerror=alert(1)>' }) };
    await importFirestoreBackupFile(file);
    expect(document.querySelector('#firestoreBackupReview script, #firestoreBackupReview img')).toBeNull();
    expect(document.getElementById('firestoreBackupReviewContent')?.textContent).toContain(file.name);
    document.getElementById('cancelFirestoreBackupBtn')?.click();
    expect(document.getElementById('firestoreBackupReview')?.hidden).toBe(true);
    expect(document.getElementById('confirmFirestoreBackupBtn')?.onclick).toBeNull();
    await importFirestoreBackupFile(file);
    updateFirestoreBackupModeWarning(FIRESTORE_BACKUP_MODES.MERGE);
    expect(document.getElementById('firestoreBackupReview')?.hidden).toBe(true);
    document.getElementById('confirmFirestoreBackupBtn')?.click();
    expect(confirm).not.toHaveBeenCalled();
    expect(mockFirestore.state.commits).toHaveLength(0);
    confirm.mockRestore();
  });

  it("splits restore writes into Firestore batches of at most 400 operations", async () => {
    mockFirestore.state.documents.set("users/admin-1", { role: "School Admin", status: "Active" });
    const documents = [
      { path: "users/admin-1", data: { role: "School Admin", status: "Active" } },
      ...Array.from({ length: 400 }, (_, index) => ({
        path: `settings/backup-${index}`,
        data: { index },
      })),
    ];

    await restoreFirestoreBackup(makeBackup(documents));

    expect(mockFirestore.state.commits.map((batch) => batch.length)).toEqual([400, 1]);
  });
});
