import { describe, expect, it } from 'vitest';
import { buildEduAiGraphs } from './eduai-graphs';

describe('EduAI chart context', () => {
  it('summarizes enrollment, overlapping program tags, and profile charts as aggregates', () => {
    const graphs = buildEduAiGraphs([
      {
        name: 'Private Learner',
        learnerId: 'PRIVATE-ID',
        gradeLevel: 'Grade 1',
        is4Ps: true,
        bosyCRLA: 'Grade Ready',
        mosyCRLA: 'Transitioning',
        bosyRMA: 'Not Proficient',
        bosyNutritionalStatus: 'Normal',
        gender: 'Male',
      },
      {
        name: 'Another Learner',
        learnerId: 'PRIVATE-ID-2',
        gradeLevel: 'Grade 1',
        isARAL: true,
        bosyCRLA: 'Grade Ready',
        bosyRMA: 'Proficient',
        eosyNutritionalStatus: 'Wasted',
        gender: 'Female',
      },
      {
        gradeLevel: 'Grade 4',
        bosyPhilIRI: 'Independent',
        eosyPhilIRI: 'Instructional',
        mosyRMA: 'High-Proficient',
      },
    ]);

    expect(graphs.find(({ title }) => title.includes('enrollment by grade'))?.points)
      .toEqual([{ label: 'Grade 1', count: 2 }, { label: 'Grade 4', count: 1 }]);
    expect(graphs.find(({ title }) => title.includes('program-tag distribution'))?.points)
      .toContainEqual({ label: '4Ps Beneficiaries', count: 1, percent: 33.3 });
    const reading = graphs.find(({ title }) => title.includes('CRLA distribution'));
    expect(reading?.points).toContainEqual({
      label: 'Grade 1 · BOSY · Grade Ready',
      count: 2,
      percent: 100,
    });
    const nutrition = graphs.find(({ title }) => title.includes('distribution by assessment period'));
    expect(nutrition?.points).toContainEqual({
      label: 'Baseline · Normal',
      count: 1,
      percent: 100,
    });

    const serialized = JSON.stringify(graphs);
    expect(serialized).not.toContain('Private Learner');
    expect(serialized).not.toContain('PRIVATE-ID');
  });

  it('returns explicit zero-valued points for supported charts without records', () => {
    const graphs = buildEduAiGraphs([]);
    expect(graphs.find(({ title }) => title.includes('program-tag distribution'))?.points)
      .toContainEqual({ label: 'Not Tagged', count: 0, percent: 0 });
    expect(graphs.find(({ title }) => title.includes('latest status mix'))?.points)
      .toContainEqual({ label: 'Normal', count: 0 });
  });
});
