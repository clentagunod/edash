import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSchoolYear } = vi.hoisted(() => ({
  mockCreateSchoolYear: vi.fn(),
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
vi.mock("./firestore-backup", () => ({ downloadFirestoreBackup: vi.fn() }));
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
  fsGetPassingThreshold: vi.fn(),
  fsSetGradeLevelGradingConfiguration: vi.fn(),
  fsSetGradeTermCount: vi.fn(),
  fsSetPassingThreshold: vi.fn(),
}));
vi.mock("./grading-config", () => ({
  DEFAULT_LETTER_GRADE_SCALE: [],
  DEFAULT_PASSING_THRESHOLD: 75,
  gradeLevelConfigKey: vi.fn(),
  normalizeGradeLevelGrading: vi.fn(),
  normalizePassingThreshold: vi.fn(),
}));

import { ADMIN_OPTIONS, createAdminYear } from "./admin-options";

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
