import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLearnerWorkbook } from "./import-learners.mjs";
import * as XLSX from "xlsx";

const workbookPath = resolve("scripts/Backup_SanRoqueEs.xlsx");

describe("parseLearnerWorkbook", () => {
  it("keeps structured teacher comments and attendance when importing learner workbooks", () => {
    const comments = ['First & second <term>', 'Literal &quot; and "quotes"', 'Third\nterm'];
    const attendance = { classDays: { Aug: '20' }, daysPresent: { Aug: '19.5' }, daysAbsent: { Aug: '0.5' } };
    const documentStatusDates = { 'Preparing Documents': '2026-10-28', Transmitted: '2026-10-30' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Id', 'LRN', 'Teacher Comments', 'Attendance', 'Document Status', 'Document Status Dates'],
      ['123456789012', '123456789012', JSON.stringify(comments), JSON.stringify(attendance), 'Transmitted', JSON.stringify(documentStatusDates)],
    ]), 'Backup_Learners_2026_2027');
    const parsed = parseLearnerWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), '2026-2027');
    expect(parsed.records[0].data).toMatchObject({ teacherComments: comments, attendance, documentStatus: 'Transmitted', documentStatusDates });
  });
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
