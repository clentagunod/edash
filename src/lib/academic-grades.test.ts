import { describe, expect, it } from "vitest";
import { GRADE_TERMS, computeNumericalFinalGrades, finalGradeForDisplay, finalGradeRemark, gradeForTerm, gradeTermsForCount, gradesForTerm, mergeGradesForTerm, numericalGradeAverage } from "./academic-grades";

describe("academic grade terms", () => {
  it("builds configurable term lists and always includes the final grade", () => {
    expect(gradeTermsForCount(2).map(({ id, label }) => [id, label])).toEqual([
      ["quarter1", "1st Term"],
      ["quarter2", "2nd Term"],
      ["final", "Final Grade"],
    ]);
    expect(gradeTermsForCount(4)[4]).toEqual({ id: "final", label: "Final Grade" });
    expect(gradeTermsForCount(0)).toEqual(gradeTermsForCount());
  });

  it("keeps each term and the manually entered final grade independent", () => {
    const learner = { math: "91", gradesByTerm: {} };
    const subjectIds = ["math"];
    GRADE_TERMS.slice(0, 4).forEach(({ id }, index) => {
      Object.assign(learner, mergeGradesForTerm(learner, id, { math: String(80 + index) }, subjectIds));
    });
    Object.assign(learner, mergeGradesForTerm(learner, "final", { math: "94" }, subjectIds));

    expect(GRADE_TERMS.map(({ id }) => gradeForTerm(learner, id, "math")))
      .toEqual(["80", "81", "82", "83", "94"]);
    expect(learner.math).toBe("94");
  });

  it("preserves older flat subject grades as manual final grades and preserves untouched terms", () => {
    const learner = {
      math: "88",
      science: "92",
      gradesByTerm: { quarter1: { math: "85" }, quarter3: { science: "79" } },
    };
    const update = mergeGradesForTerm(learner, "quarter2", { math: "90" }, ["math", "science"]);

    expect(update.gradesByTerm).toEqual({
      quarter1: { math: "85" },
      quarter2: { math: "90" },
      quarter3: { science: "79" },
    });
    expect(update.math).toBe("88");
    expect(update.science).toBe("92");
    expect(gradeForTerm({ ...learner, ...update }, "final", "math")).toBe("88");
  });

  it("does not calculate the final grade from term values", () => {
    const learner = {
      math: "",
      gradesByTerm: {
        quarter1: { math: "80" },
        quarter2: { math: "90" },
        quarter3: { math: "70" },
        quarter4: { math: "100" },
      },
    };
    expect(gradeForTerm(learner, "final", "math")).toBe("");
    expect(gradesForTerm(learner, "final", ["math"])).toEqual({});
  });

  it("computes a numerical final grade from entered grades in the configured terms", () => {
    expect(computeNumericalFinalGrades({
      gradesByTerm: {
        quarter1: { math: "80", english: "91" },
        quarter2: { math: "85", english: "" },
        quarter3: { math: "90" },
        quarter4: { math: "100" },
      },
    }, ["math", "english"], 3)).toEqual({ math: "85", english: "91" });
    expect(computeNumericalFinalGrades({
      gradesByTerm: { quarter1: { science: "80" } },
    }, ["science"], 1)).toEqual({ science: "80" });
  });

  it("uses configured automatic final grades for display without replacing a stored grade", () => {
    const learner = {
      gradesByTerm: {
        quarter1: { math: "80" },
        quarter2: { math: "90" },
        quarter3: { math: "70" },
      },
    };
    expect(finalGradeForDisplay(learner, "math", 3, true)).toBe("80");
    expect(finalGradeForDisplay(learner, "math", 3, false)).toBe("");
    expect(finalGradeForDisplay({
      ...learner,
      gradesByTerm: { ...learner.gradesByTerm, final: { math: "95" } },
    }, "math", 3, true)).toBe("95");
  });

  it("calculates the general average using the assigned subject count and waits for all grades", () => {
    expect(numericalGradeAverage(["89.33", "90", "88.67"], 3)).toBe("89.33");
    expect(numericalGradeAverage(["80", "90", "100", "70", "90"], 5)).toBe("86");
    expect(numericalGradeAverage(["80", ""], 2)).toBe("");
    expect(numericalGradeAverage(["80"], 2)).toBe("");
    expect(numericalGradeAverage([], 0)).toBe("");
  });

  it("shows final-grade remarks only when configured terms and the final grade are complete", () => {
    expect(finalGradeRemark("74.99", ["70", "75", "80"], 75)).toBe("Failed");
    expect(finalGradeRemark("75", ["70", "75", "80"], 75)).toBe("Passed");
    expect(finalGradeRemark("90", ["70", "", "80"], 75)).toBe("");
    expect(finalGradeRemark("", ["70", "75", "80"], 75)).toBe("");
    expect(finalGradeRemark("90", ["70", "80"], 80)).toBe("Passed");
  });
});
