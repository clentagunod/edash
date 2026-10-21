import {
  CRLA_CATEGORIES,
  PHIL_IRI_CATEGORIES,
  PROFILE_PERIODS,
  RMA_CATEGORIES,
  normalizeProfileCategory,
  normalizeProfileGrade,
} from './profile-charts';
import { buildNutritionGraphData, NUTRITION_STATUS_CATEGORIES } from './nutrition-charts';

export interface EduAiGraphPoint {
  label: string;
  count: number;
  percent?: number;
}

export interface EduAiGraph {
  title: string;
  description: string;
  points: EduAiGraphPoint[];
}

function numericGradeSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function profileGraph(
  title: string,
  records: Array<Record<string, unknown>>,
  fields: readonly [string, string, string],
  categories: readonly { label: string }[],
  grades: string[],
): EduAiGraph {
  const categoryMap = new Map(categories.map(({ label }) => [normalizeProfileCategory(label), label]));
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const grade = grades.find((value) => normalizeProfileGrade(value) === normalizeProfileGrade(record.gradeLevel));
    if (!grade) return;
    PROFILE_PERIODS.forEach(({ key }, periodIndex) => {
      const category = categoryMap.get(normalizeProfileCategory(record[fields[periodIndex]]));
      if (!category) return;
      const keyValue = `${grade}\u0000${key}\u0000${category}`;
      counts.set(keyValue, (counts.get(keyValue) || 0) + 1);
    });
  });

  const points: EduAiGraphPoint[] = [];
  grades.forEach((grade) => {
    PROFILE_PERIODS.forEach(({ key, label: periodLabel }) => {
      const total = categories.reduce((sum, category) => sum + (counts.get(`${grade}\u0000${key}\u0000${category.label}`) || 0), 0);
      categories.forEach(({ label }) => {
        const count = counts.get(`${grade}\u0000${key}\u0000${label}`) || 0;
        points.push({
          label: `${grade} · ${periodLabel} · ${label}`,
          count,
          percent: total ? Math.round((count / total) * 1000) / 10 : 0,
        });
      });
    });
  });
  return {
    title,
    description: 'Aggregated learner counts and shares by grade, assessment period, and chart category. No individual assessment records are included.',
    points,
  };
}

export function buildEduAiGraphs(learners: Array<Record<string, unknown>>): EduAiGraph[] {
  const grades = [...new Set(learners
    .map((learner) => String(learner.gradeLevel || '').trim())
    .filter(Boolean))]
    .sort(numericGradeSort);

  const enrollmentByGrade: EduAiGraph = {
    title: 'Dashboard and Reports: enrollment by grade',
    description: 'Active learner counts by grade level.',
    points: grades.map((grade) => ({
      label: grade,
      count: learners.filter((learner) => String(learner.gradeLevel || '').trim() === grade).length,
    })),
  };

  const programEntries: Array<[string, (learner: Record<string, unknown>) => boolean]> = [
    ['Not Tagged', (learner) => !learner.is4Ps && !learner.isIP && !learner.isSNED && !learner.isARAL && !learner.isMuslim],
    ['4Ps Beneficiaries', (learner) => learner.is4Ps === true],
    ['IP Learners', (learner) => learner.isIP === true],
    ['SNED Learners', (learner) => learner.isSNED === true],
    ['ARAL Tagged', (learner) => learner.isARAL === true],
    ['Muslim Learners', (learner) => learner.isMuslim === true],
  ];
  const programMix: EduAiGraph = {
    title: 'Dashboard: program-tag distribution',
    description: 'Counts and shares shown in the Dashboard and Reports donut. Program tags can overlap; percentages are shares of all displayed segments, not shares of total enrollment.',
    points: (() => {
      const values = programEntries.map(([label, predicate]) => ({
        label,
        count: learners.filter(predicate).length,
      }));
      const segmentTotal = values.reduce((sum, point) => sum + point.count, 0) || 1;
      return values.map((point) => ({
        ...point,
        percent: Math.round((point.count / segmentTotal) * 1000) / 10,
      }));
    })(),
  };

  const coverage = (title: string, fields: string[]): EduAiGraph => ({
    title,
    description: 'Number of learners with at least one chart assessment value, by grade.',
    points: grades.map((grade) => ({
      label: grade,
      count: learners.filter((learner) =>
        String(learner.gradeLevel || '').trim() === grade && fields.some((field) => Boolean(learner[field])),
      ).length,
    })),
  });

  const readingCrla = learners.filter((learner) => ['grade1', 'grade2', 'grade3'].includes(normalizeProfileGrade(learner.gradeLevel)));
  const readingPhilIri = learners.filter((learner) => ['grade4', 'grade5', 'grade6'].includes(normalizeProfileGrade(learner.gradeLevel)));
  const graphList: EduAiGraph[] = [
    enrollmentByGrade,
    programMix,
    coverage('Reports: reading-profile coverage by grade', ['bosyCRLA', 'mosyCRLA', 'eosyCRLA', 'bosyPhilIRI', 'mosyPhilIRI', 'eosyPhilIRI']),
    coverage('Reports: math-profile coverage by grade', ['bosyRMA', 'mosyRMA', 'eosyRMA']),
    coverage('Reports: nutritional-record coverage by grade', ['bosyNutritionalStatus', 'mosyNutritionalStatus', 'eosyNutritionalStatus']),
    profileGraph(
      'Reading Profile: CRLA distribution',
      readingCrla,
      ['bosyCRLA', 'mosyCRLA', 'eosyCRLA'],
      CRLA_CATEGORIES,
      grades.filter((grade) => ['grade1', 'grade2', 'grade3'].includes(normalizeProfileGrade(grade))),
    ),
    profileGraph(
      'Reading Profile: Phil-IRI distribution',
      readingPhilIri,
      ['bosyPhilIRI', 'mosyPhilIRI', 'eosyPhilIRI'],
      PHIL_IRI_CATEGORIES,
      grades.filter((grade) => ['grade4', 'grade5', 'grade6'].includes(normalizeProfileGrade(grade))),
    ),
    profileGraph(
      'Math Profile: RMA distribution',
      learners,
      ['bosyRMA', 'mosyRMA', 'eosyRMA'],
      RMA_CATEGORIES,
      grades,
    ),
  ];

  const nutrition = buildNutritionGraphData(learners);
  graphList.push({
    title: 'Nutritional Status: distribution by assessment period',
    description: 'Aggregated counts and percentages by nutrition-status category. No individual height, weight, or learner record is included.',
    points: nutrition.periods.flatMap((period) => NUTRITION_STATUS_CATEGORIES.map(({ label }) => ({
      label: `${period.label} · ${label}`,
      count: period.counts[label],
      percent: Math.round(period.values[label] * 10) / 10,
    }))),
  }, {
    title: 'Nutritional Status: latest status mix',
    description: 'One latest available recorded status per learner; endline is preferred, then midline, then baseline.',
    points: NUTRITION_STATUS_CATEGORIES.map(({ label }) => ({
      label,
      count: nutrition.latestStatuses[label],
    })),
  }, {
    title: 'Nutritional Status: latest status by sex',
    description: 'Aggregated percentages and assessed counts for each status by sex and overall.',
    points: nutrition.latestByGender.flatMap((group) => NUTRITION_STATUS_CATEGORIES.map(({ label }) => ({
      label: `${group.label} · ${label}`,
      count: group.counts[label],
      percent: Math.round(group.values[label] * 10) / 10,
    }))),
  });

  return graphList;
}
