import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSchoolYear, mockGetParentAccess, mockSetParentAccess } = vi.hoisted(() => ({
  mockCreateSchoolYear: vi.fn(),
  mockGetParentAccess: vi.fn(),
  mockSetParentAccess: vi.fn(),
}));

vi.mock("./sheets-api", () => ({
  LPSApi: { createSchoolYear: mockCreateSchoolYear },
}));
vi.mock("./auth", () => ({ requireAuth: vi.fn() }));
vi.mock("./app-config", () => ({
  APP_CONFIG: { backupSpreadsheetUrl: "" },
  isSchoolAdmin: () => true,
}));
vi.mock("./shell", () => ({
  clearButtonLoading: vi.fn(),
  escapeHtml: (value: unknown) => String(value),
  setButtonLoading: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("./icons", () => ({ Icon: { edit: "", trash: "" } }));
vi.mock("./firestore-backup", () => ({
  downloadFirestoreBackup: vi.fn(),
  updateFirestoreBackupModeWarning: vi.fn(),
}));
vi.mock("./curriculum-subjects", () => ({
  CURRICULUM_GRADE_LEVELS: [],
  CURRICULUM_SUBJECTS: [],
  isCustomCurriculumSubjectId: vi.fn(),
  normalizeCurriculumSubjectPool: vi.fn(),
}));
vi.mock("./academic-grades", () => ({
  DEFAULT_GRADE_TERM_COUNT: 3,
  MAX_GRADE_TERM_COUNT: 4,
  MIN_GRADE_TERM_COUNT: 1,
}));
vi.mock("./firestore-api", () => ({
  fsGetGradeLevelGradingConfigurations: vi.fn(),
  fsGetGradeTermCount: vi.fn(),
  fsGetParentAccessConfiguration: mockGetParentAccess,
  fsGetPassingThreshold: vi.fn(),
  fsSetGradeLevelGradingConfiguration: vi.fn(),
  fsSetGradeTermCount: vi.fn(),
  fsSetParentAccessEnabled: mockSetParentAccess,
  fsSetPassingThreshold: vi.fn(),
}));
vi.mock("./grading-config", () => ({
  DEFAULT_LETTER_GRADE_SCALE: [],
  DEFAULT_PASSING_THRESHOLD: 75,
  gradeLevelConfigKey: vi.fn(),
  normalizeGradeLevelGrading: vi.fn(),
  normalizePassingThreshold: vi.fn(),
}));

import { ADMIN_OPTIONS, createAdminYear, initializeSheetsBackupLink, loadAdminParentAccess, saveAdminParentAccessToggle } from "./admin-options";
import { APP_CONFIG } from "./app-config";

describe("Google Sheets backup link", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <a id="openSheetsBackupBtn" hidden></a>
      <p id="sheetsBackupStatus"></p>
    `;
    APP_CONFIG.backupSpreadsheetUrl = "";
  });

  it("opens the configured Google Sheets backup and hides unavailable or invalid links", () => {
    const link = document.getElementById("openSheetsBackupBtn") as HTMLAnchorElement;
    const status = document.getElementById("sheetsBackupStatus");

    expect(initializeSheetsBackupLink()).toBe(false);
    expect(link.hidden).toBe(true);
    expect(status?.textContent).toContain("not configured");

    APP_CONFIG.backupSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/example/edit";
    expect(initializeSheetsBackupLink()).toBe(true);
    expect(link.href).toBe("https://docs.google.com/spreadsheets/d/example/edit");
    expect(link.hidden).toBe(false);

    APP_CONFIG.backupSpreadsheetUrl = "https://example.com/not-a-spreadsheet";
    expect(initializeSheetsBackupLink()).toBe(false);
    expect(link.hidden).toBe(true);
    expect(status?.textContent).toContain("invalid");
  });
});

describe("Parent Access toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="adminParentAccessToggle" type="checkbox" />
      <p id="adminParentAccessState" role="status"></p>
    `;
    ADMIN_OPTIONS.parentAccessLoaded = false;
    ADMIN_OPTIONS.parentAccessSaving = false;
    ADMIN_OPTIONS.parentAccessEnabled = true;
    mockGetParentAccess.mockReset().mockResolvedValue({ canParentAccess: false, configured: true });
    mockSetParentAccess.mockReset().mockResolvedValue(undefined);
  });

  it("loads the saved state and persists an admin change", async () => {
    const toggle = document.getElementById("adminParentAccessToggle") as HTMLInputElement;
    await loadAdminParentAccess();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);

    toggle.checked = true;
    await saveAdminParentAccessToggle({ currentTarget: toggle });

    expect(mockSetParentAccess).toHaveBeenCalledWith(true);
    expect(document.getElementById("adminParentAccessState")?.textContent).toContain("now on");
  });
});

describe("createAdminYear", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="adminYearForm">
        <input id="adminYearInput" value="2027-2028" />
        <input id="adminYearCurrent" type="checkbox" />
        <p id="adminYearError" role="alert" hidden></p>
        <button type="submit">Create school year</button>
      </form>
      <div id="adminYearModalBackdrop"></div>
    `;
    ADMIN_OPTIONS.years = [{ schoolYear: "2026-2027", isCurrent: true }];
    mockCreateSchoolYear.mockReset().mockRejectedValue(
      Object.assign(new Error("permission denied"), { code: "permission-denied" }),
    );
  });

  it("submits a future year and displays Firestore permission errors in the dialog", async () => {
    const button = document.querySelector("button");
    const event = {
      preventDefault: vi.fn(),
      submitter: button,
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await createAdminYear(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mockCreateSchoolYear).toHaveBeenCalledWith("2027-2028", false, "2026-2027");
    const error = document.getElementById("adminYearError");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("deploy the latest firestore.rules");
    consoleError.mockRestore();
  });
});
