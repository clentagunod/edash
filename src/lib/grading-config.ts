export const DEFAULT_LETTER_GRADE_SCALE = Object.freeze([
  Object.freeze({ letter: "A", min: 90, max: 100 }),
  Object.freeze({ letter: "B", min: 80, max: 89 }),
  Object.freeze({ letter: "C", min: 70, max: 79 }),
  Object.freeze({ letter: "D", min: 60, max: 69 }),
  Object.freeze({ letter: "F", min: 0, max: 59 }),
]);

export const DEFAULT_GRADE_LEVEL_GRADING = Object.freeze({
  gradingType: "numerical",
  letterScale: DEFAULT_LETTER_GRADE_SCALE,
  finalGradeMode: "automatic",
});

export const DEFAULT_PASSING_THRESHOLD = 75;
export const DEFAULT_GRADE_TERMS_SETTINGS = Object.freeze({
  termCount: 3,
  passingThreshold: DEFAULT_PASSING_THRESHOLD,
  gradeLevels: Object.freeze({}),
});

export interface GradeTermsSettingsDocument {
  schoolYear?: string;
  termCount: number;
  passingThreshold: number;
  gradeLevels: Record<string, unknown>;
  updatedAt?: unknown;
  updatedBy?: string;
}

export function normalizePassingThreshold(value: unknown = DEFAULT_PASSING_THRESHOLD) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error("Enter a passing threshold from 0 to 100.");
  }
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("Enter a passing threshold from 0 to 100.");
  }
  return threshold;
}

export function gradeLevelConfigKey(gradeLevel) {
  const normalized = String(gradeLevel || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (["0", "kg", "kinder", "kindergarten"].includes(normalized)) return "kinder";
  const match = normalized.match(/^grade\s*(\d+)$/) || normalized.match(/^(\d+)$/);
  return match ? `grade${Number(match[1])}` : normalized.replace(/[^a-z0-9]/g, "");
}

export function normalizeLetterGradeScale(scale) {
  if (!Array.isArray(scale) || scale.length === 0) {
    throw new Error("Add at least one letter-to-number range.");
  }
  const normalized = scale.map((row) => {
    const letter = String(row?.letter ?? "").trim().toUpperCase();
    if (String(row?.min ?? "").trim() === "" || String(row?.max ?? "").trim() === "") {
      throw new Error(`Enter a valid 0–100 numeric range for ${letter || "each letter grade"}.`);
    }
    const min = Number(row?.min);
    const max = Number(row?.max);
    if (!/^[A-Z][A-Z0-9+-]{0,7}$/.test(letter)) {
      throw new Error("Each letter grade must use 1–8 letters, numbers, +, or -.");
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) {
      throw new Error(`Enter a valid 0–100 numeric range for ${letter}.`);
    }
    return { letter, min, max };
  });
  const letters = new Set();
  normalized.forEach(({ letter }) => {
    if (letters.has(letter)) throw new Error(`The letter grade ${letter} is listed more than once.`);
    letters.add(letter);
  });
  const ascending = [...normalized].sort((left, right) => left.min - right.min);
  for (let index = 1; index < ascending.length; index += 1) {
    if (ascending[index].min <= ascending[index - 1].max) {
      throw new Error(`${ascending[index - 1].letter} and ${ascending[index].letter} have overlapping numeric ranges.`);
    }
  }
  return normalized;
}

export function normalizeGradeLevelGrading(value) {
  if (value?.gradingType != null && !["numerical", "letter"].includes(value.gradingType)) {
    throw new Error("Grading type must be Numerical Grade or Letter Grade.");
  }
  if (value?.finalGradeMode != null && !["automatic", "manual"].includes(value.finalGradeMode)) {
    throw new Error("Final grade mode must be automatic or manual.");
  }
  const gradingType = value?.gradingType === "letter" ? "letter" : "numerical";
  const letterScale = value?.letterScale == null
    ? DEFAULT_LETTER_GRADE_SCALE.map((row) => ({ ...row }))
    : normalizeLetterGradeScale(value.letterScale);
  const finalGradeMode = value?.finalGradeMode === "manual" ? "manual" : "automatic";
  return { gradingType, letterScale, finalGradeMode };
}
