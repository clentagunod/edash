import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSchoolYear, mockGetParentAccess, mockSetParentAccess, mockGetPromotion, mockSetPromotion, mockGetImports, mockSetImports, mockGetProfileEditing, mockSetProfileEditing, mockGetCardPreferences, mockSetCardPreferences } = vi.hoisted(() => ({
  mockCreateSchoolYear: vi.fn(),
  mockGetParentAccess: vi.fn(),
  mockSetParentAccess: vi.fn(),
  mockGetPromotion: vi.fn(),
  mockSetPromotion: vi.fn(),
  mockGetImports: vi.fn(),
  mockSetImports: vi.fn(),
  mockGetProfileEditing: vi.fn(),
  mockSetProfileEditing: vi.fn(),
  mockGetCardPreferences: vi.fn(),
  mockSetCardPreferences: vi.fn(),
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
  fsGetPromotionConfiguration: mockGetPromotion,
  fsGetImportConfiguration: mockGetImports,
  fsGetProfileEditingConfiguration: mockGetProfileEditing,
  fsGetPassingThreshold: vi.fn(),
  fsSetGradeLevelGradingConfiguration: vi.fn(),
  fsSetGradeTermCount: vi.fn(),
  fsSetParentAccessEnabled: mockSetParentAccess,
  fsSetCanPromoteStudents: mockSetPromotion,
  fsSetCanTeacherImport: mockSetImports,
  fsSetCanTeacherEditProfiles: mockSetProfileEditing,
  fsSetPassingThreshold: vi.fn(),
  fsGetCardPrintingPreferences: mockGetCardPreferences,
  fsSetCardPrintingPreferences: mockSetCardPreferences,
}));
vi.mock("./grading-config", () => ({
  DEFAULT_LETTER_GRADE_SCALE: [],
  DEFAULT_PASSING_THRESHOLD: 75,
  gradeLevelConfigKey: vi.fn(),
  normalizeGradeLevelGrading: vi.fn(),
  normalizePassingThreshold: vi.fn(),
}));

import { ADMIN_OPTIONS, createAdminYear, initializeSheetsBackupLink, loadAdminCardPreferences, loadAdminImportAccess, loadAdminProfileEditing, loadAdminParentAccess, loadAdminPromotionAccess, saveAdminCardPreferences, saveAdminImportAccessToggle, saveAdminProfileEditingToggle, saveAdminParentAccessToggle, saveAdminPromotionAccessToggle } from "./admin-options";
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

describe("Promotion access toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="adminPromotionAccessToggle" type="checkbox" />
      <p id="adminPromotionAccessState" role="status"></p>
    `;
    ADMIN_OPTIONS.promotionAccessLoaded = false;
    ADMIN_OPTIONS.promotionAccessSaving = false;
    ADMIN_OPTIONS.canPromoteStudents = false;
    mockGetPromotion.mockReset().mockResolvedValue({ canPromoteStudents: false, configured: false });
    mockSetPromotion.mockReset().mockResolvedValue(undefined);
  });

  it("loads the configured state and persists changes at the promotion setting", async () => {
    const toggle = document.getElementById("adminPromotionAccessToggle") as HTMLInputElement;
    await loadAdminPromotionAccess();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("adminPromotionAccessState")?.textContent).toContain("settings/toggles/canPromoteStudents");

    toggle.checked = true;
    await saveAdminPromotionAccessToggle({ currentTarget: toggle });
    expect(mockSetPromotion).toHaveBeenCalledWith(true);
    expect(document.getElementById("adminPromotionAccessState")?.textContent).toContain("now on");
  });
});

describe("Imports access toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="adminImportAccessToggle" type="checkbox" />
      <p id="adminImportAccessState" role="status"></p>
      <button id="adminImportAccessRetry" hidden>Retry</button>
    `;
    ADMIN_OPTIONS.importAccessLoaded = false;
    ADMIN_OPTIONS.importAccessSaving = false;
    ADMIN_OPTIONS.canTeacherImport = false;
    mockGetImports.mockReset().mockResolvedValue({ canTeacherImport: false, configured: false });
    mockSetImports.mockReset().mockResolvedValue(true);
  });

  it("starts disabled by default and persists teacher import access", async () => {
    const toggle = document.getElementById("adminImportAccessToggle") as HTMLInputElement;
    await loadAdminImportAccess();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("adminImportAccessState")?.textContent).toContain("off by default");
    toggle.checked = true;
    await saveAdminImportAccessToggle({ currentTarget: toggle });
    expect(mockSetImports).toHaveBeenCalledWith(true);
    expect(ADMIN_OPTIONS.canTeacherImport).toBe(true);
    expect(document.getElementById("adminImportAccessState")?.textContent).toContain("now on");
  });

  it("rolls the switch back to the saved state after a failed write", async () => {
    mockGetImports.mockResolvedValue({ canTeacherImport: true, configured: true });
    await loadAdminImportAccess();
    const toggle = document.getElementById("adminImportAccessToggle") as HTMLInputElement;
    toggle.checked = false;
    mockSetImports.mockRejectedValue(new Error("Permission denied"));
    await saveAdminImportAccessToggle({ currentTarget: toggle });
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(ADMIN_OPTIONS.canTeacherImport).toBe(true);
    expect(document.getElementById("adminImportAccessState")?.textContent).toContain("Permission denied");
  });

  it("keeps the switch unavailable on load failure and permits a retry", async () => {
    mockGetImports.mockRejectedValueOnce(new Error("Offline"));
    const toggle = document.getElementById("adminImportAccessToggle") as HTMLInputElement;
    await loadAdminImportAccess();
    expect(toggle.disabled).toBe(true);
    expect(document.getElementById("adminImportAccessRetry")?.hidden).toBe(false);
    toggle.checked = true;
    await saveAdminImportAccessToggle({ currentTarget: toggle });
    expect(mockSetImports).not.toHaveBeenCalled();
    await loadAdminImportAccess();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("adminImportAccessRetry")?.hidden).toBe(true);
  });
});

describe("Teacher profile editing toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="adminProfileEditingToggle" type="checkbox" />
      <p id="adminProfileEditingState" role="status"></p>
      <button id="adminProfileEditingRetry" hidden>Retry</button>
    `;
    ADMIN_OPTIONS.profileEditingLoaded = false;
    ADMIN_OPTIONS.profileEditingSaving = false;
    ADMIN_OPTIONS.canTeacherEditProfiles = true;
    mockGetProfileEditing.mockReset().mockResolvedValue({ canTeacherEditProfiles: true, configured: false });
    mockSetProfileEditing.mockReset().mockResolvedValue(true);
  });

  it("starts enabled by default and persists teacher profile editing access", async () => {
    const toggle = document.getElementById("adminProfileEditingToggle") as HTMLInputElement;
    await loadAdminProfileEditing();
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("adminProfileEditingState")?.textContent).toContain("on by default");
    toggle.checked = false;
    await saveAdminProfileEditingToggle({ currentTarget: toggle });
    expect(mockSetProfileEditing).toHaveBeenCalledWith(false);
    expect(ADMIN_OPTIONS.canTeacherEditProfiles).toBe(false);
    expect(document.getElementById("adminProfileEditingState")?.textContent).toContain("now off");
  });

  it("rolls the switch back to the saved state after a failed write", async () => {
    mockGetProfileEditing.mockResolvedValue({ canTeacherEditProfiles: true, configured: true });
    await loadAdminProfileEditing();
    const toggle = document.getElementById("adminProfileEditingToggle") as HTMLInputElement;
    toggle.checked = false;
    mockSetProfileEditing.mockRejectedValue(new Error("Permission denied"));
    await saveAdminProfileEditingToggle({ currentTarget: toggle });
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(ADMIN_OPTIONS.canTeacherEditProfiles).toBe(true);
    expect(document.getElementById("adminProfileEditingState")?.textContent).toContain("Permission denied");
  });

  it("keeps the switch unavailable on load failure and permits a retry", async () => {
    mockGetProfileEditing.mockRejectedValueOnce(new Error("Offline"));
    const toggle = document.getElementById("adminProfileEditingToggle") as HTMLInputElement;
    await loadAdminProfileEditing();
    expect(toggle.disabled).toBe(true);
    expect(document.getElementById("adminProfileEditingRetry")?.hidden).toBe(false);
    toggle.checked = true;
    await saveAdminProfileEditingToggle({ currentTarget: toggle });
    expect(mockSetProfileEditing).not.toHaveBeenCalled();
    await loadAdminProfileEditing();
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(document.getElementById("adminProfileEditingRetry")?.hidden).toBe(true);
  });
});

describe("Card Printing preferences save", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="adminCardTemplate" type="radio" name="adminCardTemplate" value="sf9" checked />
      <div id="adminCardGradeTemplates"></div>
      <textarea id="adminCardAttendanceMonths">Jun, Jul</textarea>
      <input id="adminCardClassDaysLabel" value="Class days" />
      <input id="adminCardPresentLabel" value="Present" />
      <input id="adminCardAbsentLabel" value="Absent" />
      <p id="adminCardPreferencesState" role="status"></p>
      <button id="saveAdminCardPreferencesBtn" type="button">Save preferences</button>
    `;
    mockGetCardPreferences.mockReset().mockResolvedValue({
      activeTemplate: "sf9",
      gradeTemplates: {},
      attendanceMonths: ["Jun", "Jul"],
      attendanceRows: [
        { id: "classDays", label: "Class days" },
        { id: "daysPresent", label: "Present" },
        { id: "daysAbsent", label: "Absent" },
      ],
    });
    mockSetCardPreferences.mockReset().mockResolvedValue({ attendanceMonths: ["Jun", "Jul"] });
  });

  it("loads the saved template selection and attendance preferences", async () => {
    await loadAdminCardPreferences();

    expect((document.getElementById("adminCardTemplate") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("adminCardAttendanceMonths") as HTMLTextAreaElement).value).toBe("Jun, Jul");
    expect((document.getElementById("adminCardClassDaysLabel") as HTMLInputElement).value).toBe("Class days");
    expect(document.getElementById("adminCardPreferencesState")?.textContent).toBe("Card Printing preferences loaded.");
  });

  it("shows a success indicator when preferences save", async () => {
    await saveAdminCardPreferences();

    const state = document.getElementById("adminCardPreferencesState");
    const button = document.getElementById("saveAdminCardPreferencesBtn") as HTMLButtonElement;
    expect(state?.textContent).toBe("Card Printing preferences saved.");
    expect(state?.classList.contains("is-success")).toBe(true);
    expect(state?.classList.contains("is-saving")).toBe(false);
    expect(mockSetCardPreferences).toHaveBeenCalledWith(expect.objectContaining({ activeTemplate: "sf9" }));
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Save preferences");
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("shows an error indicator and restores the button when saving fails", async () => {
    mockSetCardPreferences.mockRejectedValue(new Error("Network unavailable"));
    await saveAdminCardPreferences();

    const state = document.getElementById("adminCardPreferencesState");
    const button = document.getElementById("saveAdminCardPreferencesBtn") as HTMLButtonElement;
    expect(state?.textContent).toContain("Unable to save Card Printing preferences: Network unavailable");
    expect(state?.classList.contains("is-error")).toBe(true);
    expect(state?.classList.contains("is-saving")).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Save preferences");
    expect(button.hasAttribute("aria-busy")).toBe(false);
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
