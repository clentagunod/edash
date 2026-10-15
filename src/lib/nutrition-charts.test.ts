import { describe, expect, it } from 'vitest';
import { buildNutritionGraphData } from './nutrition-charts';

describe('nutrition graph data', () => {
  it('builds period percentages and uses each learner latest recorded status once', () => {
    const data = buildNutritionGraphData([
      { gender: 'Male', bosyNutritionalStatus: 'Normal', mosyNutritionalStatus: 'Wasted', eosyNutritionalStatus: 'Severely Wasted' },
      { gender: 'Female', bosyNutritionalStatus: 'Wasted', mosyNutritionalStatus: 'Normal' },
      { gender: 'Male', bosyNutritionalStatus: 'Obese' },
      { gender: 'Female' },
    ]);

    expect(data.periods[0]).toMatchObject({
      label: 'Baseline',
      total: 3,
      values: { Normal: 100 / 3, Wasted: 100 / 3, Obese: 100 / 3 },
    });
    expect(data.periods[1]).toMatchObject({
      label: 'Midline',
      total: 2,
      values: { Normal: 50, Wasted: 50 },
    });
    expect(data.periods[2]).toMatchObject({
      label: 'Endline',
      total: 1,
      values: { 'Severely Wasted': 100 },
    });
    expect(data.latestStatuses).toMatchObject({
      Normal: 1,
      'Severely Wasted': 1,
      Obese: 1,
    });
    expect(data.latestByGender.map(({ label, total }) => [label, total])).toEqual([
      ['Male', 2],
      ['Female', 1],
      ['Total', 3],
    ]);
  });

  it('returns empty chart groups when no known statuses are present', () => {
    const data = buildNutritionGraphData([
      { gender: 'Male', bosyNutritionalStatus: 'Unknown', eosyNutritionalStatus: '' },
    ]);

    expect(data.periods.every(({ total }) => total === 0)).toBe(true);
    expect(data.latestByGender.every(({ total }) => total === 0)).toBe(true);
    expect(Object.values(data.latestStatuses).every((count) => count === 0)).toBe(true);
  });
});
