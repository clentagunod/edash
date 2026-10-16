import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFirestore } = vi.hoisted(() => {
  const state = { documents: new Map(), commits: [] };
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
    get: async () => snapshot(path),
  });
  const collectionRef = (path) => ({
    doc: (id) => documentRef(`${path}/${id}`),
    get: async () => {
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

  it("shows each validation layer before asking to replace tenant data", async () => {
    document.body.innerHTML = `
      <button id="importFirestoreBackupBtn"></button>
      <p id="firestoreBackupStatus"></p>
      <p id="firestoreBackupValidationStatus"></p>
      <div id="firestoreBackupProgress" aria-valuenow="0"></div>
      ${Array.from({ length: 4 }, () => '<li data-backup-validation-step data-state="pending"><span data-backup-step-state></span></li>').join("")}
    `;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await importFirestoreBackupFile({ text: async () => JSON.stringify(makeBackup()) });

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

    expect(confirm.mock.calls[0][0]).toContain("Merge 2 app-managed database documents");
    expect(mockFirestore.state.documents.get("settings/toggles"))
      .toEqual({ canParentAccess: false, retainedField: "keep" });
    expect(document.getElementById("firestoreBackupStatus")?.textContent).toContain("Merge complete");
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
