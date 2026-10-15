import { CURRICULUM_SUBJECTS } from './curriculum-subjects';
import { FINAL_GRADE_TERM, gradeTermsForCount } from './academic-grades';

export type ParentGradeProfile = {
  id: string;
  label: string;
  grades: Array<{ id: string; label: string; value: unknown }>;
};

const SUBJECT_LABELS = new Map<string, string>(CURRICULUM_SUBJECTS.map(({ id, label }) => [id, label]));

function subjectLabel(id: string) {
  return SUBJECT_LABELS.get(id)
    || id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function gradeEntries(values: unknown) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(values as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([id, value]) => ({ id, label: subjectLabel(id), value }));
}

export function parentGradeProfiles(learner: Record<string, unknown>, termCount: number): ParentGradeProfile[] {
  const termGrades = learner.gradesByTerm && typeof learner.gradesByTerm === 'object' && !Array.isArray(learner.gradesByTerm)
    ? learner.gradesByTerm as Record<string, unknown>
    : {};
  const extra = learner.extra && typeof learner.extra === 'object' && !Array.isArray(learner.extra)
    ? learner.extra as Record<string, unknown>
    : {};
  const legacyFinalGrades = Object.fromEntries(CURRICULUM_SUBJECTS
    .map(({ id }) => [id, learner[id] ?? extra[id] ?? ''])
    .filter(([, value]) => value !== '' && value !== null && value !== undefined));
  const terms = gradeTermsForCount(termCount);

  return terms.map(({ id, label }) => {
    const explicitFinalGrades = termGrades[id] && typeof termGrades[id] === 'object' && !Array.isArray(termGrades[id])
      ? termGrades[id] as Record<string, unknown>
      : {};
    const grades = id === FINAL_GRADE_TERM
      ? { ...legacyFinalGrades, ...explicitFinalGrades }
      : termGrades[id];
    return { id, label, grades: gradeEntries(grades) };
  });
}
