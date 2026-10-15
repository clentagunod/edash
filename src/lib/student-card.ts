import { gradeLevelConfigKey } from './grading-config';

type GradeLevelGrading = {
  gradingType?: string;
};

export function isLetterGradedLevel(
  gradeLevel: unknown,
  configurations: Record<string, GradeLevelGrading>,
): boolean {
  const key = gradeLevelConfigKey(String(gradeLevel ?? ''));
  return configurations[key]?.gradingType === 'letter';
}