import { describe, expect, it } from 'vitest';
import { buildEduAiGraphs } from './eduai-graphs';
// Verify the server-generated context uses the same chart denominators as the UI.
// @ts-ignore -- CommonJS gateway module is also consumed by the deployed functions.
import serverContext from '../../functions/eduai-context.cjs';

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
      .toContainEqual({ label: '4Ps Beneficiaries', count: 1, percent: 33.33 });
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
      .toHaveLength(5);
    expect(graphs.find(({ title }) => title.includes('tagged versus untagged'))?.points)
      .toEqual([{ label: 'Tagged', count: 0, percent: 0 }, { label: 'Not Tagged', count: 0, percent: 0 }]);
    expect(graphs.find(({ title }) => title.includes('latest status mix'))?.points)
      .toContainEqual({ label: 'Normal', count: 0 });
  });

  it('uses total learners as the denominator when program groups overlap', () => {
    const graphs = buildEduAiGraphs([
      { gradeLevel: 'Grade 1', is4Ps: true, isARAL: true, isMuslim: true },
      { gradeLevel: 'Grade 1', isARAL: true },
    ]);
    const programMix = graphs.find(({ title }) => title.includes('program-tag distribution'));

    expect(programMix?.points).toContainEqual({ label: '4Ps Beneficiaries', count: 1, percent: 50 });
    expect(programMix?.points).toContainEqual({ label: 'ARAL Tagged', count: 2, percent: 100 });
    expect(programMix?.points).toContainEqual({ label: 'Muslim Learners', count: 1, percent: 50 });
    expect(programMix?.points).toHaveLength(5);
    expect(programMix?.description).toContain('percentages of total learners');
    expect(graphs.find(({ title }) => title.includes('tagged versus untagged'))?.points)
      .toEqual([{ label: 'Tagged', count: 2, percent: 100 }, { label: 'Not Tagged', count: 0, percent: 0 }]);
  });

  it.each([
    { records: [] },
    { records: [{ is4Ps: true, isIP: true, isARAL: true }, { isMuslim: true }, {}] },
    { records: [{ is4Ps: true, isIP: true }, { is4Ps: true, isSNED: true }, {}] },
  ])('keeps server and browser chart context aligned for overlapping memberships (%j)', ({ records }) => {
    const browserGraphs = buildEduAiGraphs(records);
    const serverGraphs = serverContext.buildEduAiContext('School Admin', '2026-2027', records).graphs;
    for (const title of ['program-tag distribution', 'tagged versus untagged']) {
      const graph = browserGraphs.find(graph => graph.title.includes(title));
      expect(serverGraphs.find((item: { title: string }) => item.title.includes(title))).toEqual(graph);
    }
    const tagging = browserGraphs.find(graph => graph.title.includes('tagged versus untagged'))!;
    expect(tagging.points.reduce((sum, point) => sum + point.count, 0)).toBe(records.length);
  });
});
