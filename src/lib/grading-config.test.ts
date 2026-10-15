import { describe, expect, it } from "vitest";
import {
  DEFAULT_LETTER_GRADE_SCALE,
  DEFAULT_PASSING_THRESHOLD,
  gradeLevelConfigKey,
  normalizeGradeLevelGrading,
  normalizeLetterGradeScale,
  normalizePassingThreshold,
} from "./grading-config";

describe("school-year grade grading configuration", () => {
  it("defaults the pass threshold to 75 and validates configured thresholds", () => {
    expect(DEFAULT_PASSING_THRESHOLD).toBe(75);
    expect(normalizePassingThreshold("80")).toBe(80);
    expect(() => normalizePassingThreshold("")).toThrow(/0 to 100/);
    expect(() => normalizePassingThreshold(101)).toThrow(/0 to 100/);
  });

  it("uses numerical grading by default and provides editable ABCDF equivalencies", () => {
    expect(normalizeGradeLevelGrading()).toEqual({
      gradingType: "numerical",
      letterScale: DEFAULT_LETTER_GRADE_SCALE,
      finalGradeMode: "automatic",
    });
    expect(DEFAULT_LETTER_GRADE_SCALE.map(({ letter, min, max }) => [letter, min, max])).toEqual([
      ["A", 90, 100],
      ["B", 80, 89],
      ["C", 70, 79],
      ["D", 60, 69],
      ["F", 0, 59],
    ]);
  });

  it("normalizes grade-level keys consistently", () => {
    expect(gradeLevelConfigKey("Kindergarten")).toBe("kinder");
    expect(gradeLevelConfigKey("Grade 04")).toBe("grade4");
    expect(gradeLevelConfigKey("5")).toBe("grade5");
  });

  it("rejects duplicate letters, invalid ranges, and overlapping ranges", () => {
    expect(() => normalizeLetterGradeScale([{ letter: "A", min: 90, max: 100 }, { letter: "a", min: 70, max: 89 }])).toThrow(/listed more than once/);
    expect(() => normalizeLetterGradeScale([{ letter: "A", min: 90, max: 101 }])).toThrow(/valid 0–100/);
    expect(() => normalizeLetterGradeScale([{ letter: "A", min: 80, max: 100 }, { letter: "B", min: 70, max: 90 }])).toThrow(/overlapping/);
  });
});
