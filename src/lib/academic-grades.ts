export const DEFAULT_GRADE_TERM_COUNT = 3;
export const MIN_GRADE_TERM_COUNT = 1;
export const MAX_GRADE_TERM_COUNT = 4;

export function gradeTermsForCount(termCount = DEFAULT_GRADE_TERM_COUNT) {
  const count = Number.isInteger(termCount) && termCount >= MIN_GRADE_TERM_COUNT && termCount <= MAX_GRADE_TERM_COUNT
    ? termCount
    : DEFAULT_GRADE_TERM_COUNT;
  const ordinal = (value) => {
    const suffix = value % 100 >= 11 && value % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[value % 10] || "th");
    return `${value}${suffix}`;
  };
  return Object.freeze([
    ...Array.from({ length: count }, (_, index) => ({
      id: `quarter${index + 1}`,
      label: `${ordinal(index + 1)} Term`,
    })),
    { id: "final", label: "Final Grade" },
  ]);
}

export const DEFAULT_GRADE_TERMS = gradeTermsForCount();
export const GRADE_TERMS = gradeTermsForCount(MAX_GRADE_TERM_COUNT);

export const DEFAULT_GRADE_TERM = "quarter1";
export const FINAL_GRADE_TERM = "final";

export const DEFAULT_ROUND_TYPE = "nearest_integer";
export const GRADE_ROUND_TYPES = Object.freeze(["nearest_integer", "none"]);

export function roundGradeResult(value, roundType = DEFAULT_ROUND_TYPE) {
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value))) return value ?? "";
  const numeric = Number(value);
  if (roundType === "none") return String(numeric);
  return String(Math.floor(numeric + 0.5));
}

export function gradesForTerm(learner, term = FINAL_GRADE_TERM, subjectIds = []) {
  const termGrades = learner?.gradesByTerm?.[term];
  if (term !== FINAL_GRADE_TERM) {
    return termGrades && typeof termGrades === "object" && !Array.isArray(termGrades) ? { ...termGrades } : {};
  }
  const extra = learner?.extra && typeof learner.extra === "object" ? learner.extra : {};
  const legacyFinals = Object.fromEntries(subjectIds
    .map((id) => [id, learner?.[id] ?? extra[id] ?? ""])
    .filter(([, value]) => value !== "" && value != null));
  return termGrades && typeof termGrades === "object" && !Array.isArray(termGrades)
    ? { ...legacyFinals, ...termGrades }
    : legacyFinals;
}

export function mergeGradesForTerm(learner, term, subjectValues, subjectIds = Object.keys(subjectValues || {})) {
  const gradesByTerm = learner?.gradesByTerm && typeof learner.gradesByTerm === "object"
    ? { ...learner.gradesByTerm }
    : {};
  const previousGrades = gradesForTerm(learner, term, subjectIds);
  const updatedGrades = { ...previousGrades };
  subjectIds.forEach((subjectId) => {
    if (Object.prototype.hasOwnProperty.call(subjectValues || {}, subjectId)) {
      updatedGrades[subjectId] = String(subjectValues[subjectId] ?? "").trim();
    }
  });
  gradesByTerm[term] = updatedGrades;

  const update = { gradesByTerm };
  if (term === FINAL_GRADE_TERM) {
    subjectIds.forEach((subjectId) => {
      update[subjectId] = updatedGrades[subjectId] ?? "";
    });
  } else {
    subjectIds.forEach((subjectId) => {
      update[subjectId] = learner?.[subjectId] ?? learner?.extra?.[subjectId] ?? "";
    });
  }
  return update;
}

export function gradeForTerm(learner, term, subjectId) {
  if (Object.prototype.hasOwnProperty.call(learner?.gradesByTerm?.[term] || {}, subjectId)) {
    return learner.gradesByTerm[term][subjectId];
  }
  return term === FINAL_GRADE_TERM ? learner?.[subjectId] ?? learner?.extra?.[subjectId] ?? "" : "";
}

export function computeNumericalFinalGrades(learner, subjectIds, termCount) {
  const terms = gradeTermsForCount(termCount).filter(({ id }) => id !== FINAL_GRADE_TERM);
  return Object.fromEntries(subjectIds.map((subjectId) => {
    const values = terms
      .map(({ id }) => gradeForTerm(learner, id, subjectId))
      .filter((value) => value != null && String(value).trim() !== "")
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length) return [subjectId, ""];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return [subjectId, String(Math.round((mean + Number.EPSILON) * 100) / 100)];
  }));
}

export function finalGradeForDisplay(learner, subjectId, termCount, autoCalculate) {
  const storedFinalGrade = gradeForTerm(learner, FINAL_GRADE_TERM, subjectId);
  if (storedFinalGrade != null && String(storedFinalGrade).trim() !== "") return storedFinalGrade;
  if (!autoCalculate) return storedFinalGrade;
  return computeNumericalFinalGrades(learner, [subjectId], termCount)[subjectId] || "";
}

export function numericalGradeAverage(grades, expectedCount = grades.length) {
  if (!Array.isArray(grades) || expectedCount <= 0 || grades.length !== expectedCount) return "";
  const values = grades.map((grade) => {
    if ((typeof grade !== "number" && typeof grade !== "string") || String(grade).trim() === "") return null;
    const value = Number(grade);
    return Number.isFinite(value) ? value : null;
  });
  if (values.some((value) => value === null)) return "";
  const average = values.reduce((total, value) => total + value, 0) / expectedCount;
  return String(Math.round((average + Number.EPSILON) * 100) / 100);
}

export function finalGradeRemark(finalGrade, termGrades, passingThreshold) {
  if (!Array.isArray(termGrades) || termGrades.length === 0) return "";
  const completedTerms = termGrades.every((value) => {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return false;
    return Number.isFinite(Number(value));
  });
  if (!completedTerms || (typeof finalGrade !== "number" && typeof finalGrade !== "string") || String(finalGrade).trim() === "") return "";
  const numericFinalGrade = Number(finalGrade);
  if (!Number.isFinite(numericFinalGrade)) return "";
  return numericFinalGrade >= passingThreshold ? "Passed" : "Failed";
}
