import { buildEduAiGraphs, type EduAiGraph } from './eduai-graphs';

export type EduAiRole = 'School Admin' | 'Registrar' | 'Teacher';
export type EduAiMessageRole = 'user' | 'assistant';

export interface EduAiMessage {
  id?: string;
  role: EduAiMessageRole;
  content: string;
  createdAt?: string;
}

export interface EduAiContext {
  role: EduAiRole;
  schoolYear: string;
  summary: {
    totalLearners: number;
    byGradeLevel: Array<{ gradeLevel: string; count: number }>;
    byGradeAndSection: Array<{ gradeLevel: string; section: string; count: number }>;
    genderCounts: { male: number; female: number; otherOrUnspecified: number };
    programCounts: Record<string, number>;
  };
  learnerNames: string[];
  learnerNameCount: number;
  graphs: EduAiGraph[];
}

const MAX_CONTEXT_NAMES = 150;

function learnerDisplayName(learner: Record<string, unknown>): string {
  const storedName = typeof learner.name === 'string' ? learner.name.trim() : '';
  if (storedName) return storedName.slice(0, 120);

  return [learner.firstName, learner.middleName, learner.lastName, learner.suffix]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ')
    .slice(0, 120);
}

export function buildEduAiContext(
  roleValue: unknown,
  schoolYear: string,
  learners: Array<Record<string, unknown>>,
): EduAiContext {
  const role = String(roleValue || '').trim();
  if (!['School Admin', 'Registrar', 'Teacher'].includes(role)) {
    throw new Error('Your account role is not allowed to use EduAI.');
  }

  const byGrade = new Map<string, number>();
  const byGradeAndSection = new Map<string, { gradeLevel: string; section: string; count: number }>();
  const genderCounts = { male: 0, female: 0, otherOrUnspecified: 0 };
  const programCounts: Record<string, number> = {
    fourPs: 0,
    indigenousPeoples: 0,
    sned: 0,
    aral: 0,
    muslim: 0,
  };
  const learnerNames: string[] = [];

  learners.forEach((learner) => {
    const name = learnerDisplayName(learner);
    if (name) learnerNames.push(name);

    const gradeLevel = typeof learner.gradeLevel === 'string' ? learner.gradeLevel.trim() : '';
    const section = typeof learner.section === 'string' ? learner.section.trim() : '';
    if (gradeLevel) byGrade.set(gradeLevel, (byGrade.get(gradeLevel) || 0) + 1);
    if (gradeLevel && section) {
      const key = `${gradeLevel}\u0000${section}`;
      const group = byGradeAndSection.get(key) || { gradeLevel, section, count: 0 };
      group.count += 1;
      byGradeAndSection.set(key, group);
    }

    const gender = typeof learner.gender === 'string' ? learner.gender.trim().toLowerCase() : '';
    if (gender === 'male') genderCounts.male += 1;
    else if (gender === 'female') genderCounts.female += 1;
    else genderCounts.otherOrUnspecified += 1;

    if (learner.is4Ps === true) programCounts.fourPs += 1;
    if (learner.isIP === true) programCounts.indigenousPeoples += 1;
    if (learner.isSNED === true) programCounts.sned += 1;
    if (learner.isARAL === true) programCounts.aral += 1;
    if (learner.isMuslim === true) programCounts.muslim += 1;
  });

  return {
    role: role as EduAiRole,
    schoolYear,
    summary: {
      totalLearners: learners.length,
      byGradeLevel: [...byGrade.entries()]
        .map(([gradeLevel, count]) => ({ gradeLevel, count }))
        .sort((left, right) => left.gradeLevel.localeCompare(right.gradeLevel, undefined, { numeric: true })),
      byGradeAndSection: [...byGradeAndSection.values()]
        .sort((left, right) =>
          left.gradeLevel.localeCompare(right.gradeLevel, undefined, { numeric: true })
          || left.section.localeCompare(right.section, undefined, { numeric: true })),
      genderCounts,
      programCounts,
    },
    learnerNames: learnerNames.slice(0, MAX_CONTEXT_NAMES),
    learnerNameCount: learnerNames.length,
    graphs: buildEduAiGraphs(learners),
  };
}
