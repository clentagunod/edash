import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLearnerWorkbook } from "./import-learners.mjs";

const workbookPath = resolve("scripts/Backup_SanRoqueEs.xlsx");

describe("parseLearnerWorkbook", () => {
  it("parses learner records and maps LRN to both learnerId and document ID", async () => {
    const workbook = await readFile(workbookPath);
    const parsed = parseLearnerWorkbook(workbook, "2026-2027", false, { allowInvalidBirthDates: true });
    const learnerSheet = parsed.sheets.find(({ collectionName }) => collectionName === "learners");

    expect(parsed.schoolYear).toBe("2026-2027");
    expect(learnerSheet).toMatchObject({
      sheetName: "Backup_Learners_2026_2027",
      collectionName: "learners",
      recordCount: 467,
      blankRows: 1,
    });
    expect(parsed.records).toHaveLength(467);
    expect(parsed.invalidBirthdates).toBe(1);
    expect(new Set(parsed.records.map(({ id }) => id)).size).toBe(467);
    expect(parsed.records.every(({ id, data }) =>
      typeof id === "string" && id.length > 0 && id === data.learnerId && data.schoolYear === "2026-2027"
    )).toBe(true);
    expect(parsed.records.filter(({ data }) => data.birthDate)).toHaveLength(466);
    expect(parsed.records.filter(({ data }) => data.birthDate).every(({ data }) =>
      /^\d{4}-\d{2}-\d{2}$/.test(data.birthDate)
    )).toBe(true);
    expect(parsed.records[0].data).toHaveProperty("gradesByTerm");
    expect(parsed.records[0].data).toHaveProperty("extra");
  });

  it("includes archive sheets only when requested", async () => {
    const workbook = await readFile(workbookPath);
    const parsed = parseLearnerWorkbook(workbook, "2026-2027", true, { allowInvalidBirthDates: true });

    expect(parsed.sheets.map(({ collectionName }) => collectionName)).toEqual([
      "learners",
      "transferredOut",
    ]);
    expect(parsed.sheets.find(({ collectionName }) => collectionName === "transferredOut").recordCount).toBe(1);
  });

  it("rejects a workbook year that does not match the requested year", async () => {
    const workbook = await readFile(workbookPath);

    expect(() => parseLearnerWorkbook(workbook, "2025-2026")).toThrow(
      'Workbook does not contain "Backup_Learners_2025_2026".'
    );
  });

  it("rejects invalid birthdays during a full import", async () => {
    const workbook = await readFile(workbookPath);

    expect(() => parseLearnerWorkbook(workbook, "2026-2027")).toThrow(
      "Row 357: Birthdate must be a valid date."
    );
  });
});
