import { describe, expect, it } from 'vitest';
import {
  emptyPerformanceConfig, formatPerformanceVariance, indicatorIdFromLabel, normalizePerformanceYear,
  PERFORMANCE_INDICATORS, performanceLabels, performanceRate, performanceVariance, performanceYear,
  validatePerformanceConfig, visiblePerformanceYears,
} from './performance-indicators';

describe('performance indicator calculations', () => {
  it.each([
    [45, 45, 100], [45, 48, 93.75], [433, 442, 97.96380090497738], [49, 48, 102.08333333333333],
    [375, 385, 97.40259740259741], [442, 538, 82.15613382899627], [5, 442, 1.1312217194570136],
    [9, 442, 2.0361990950226243], [442, 538, 82.15613382899627], [9, 442, 2.0361990950226243],
    [62, 70, 88.57142857142857], [67, 76, 88.1578947368421],
  ])('matches the workbook formula for %s / %s', (numerator, denominator, expected) => {
    expect(performanceRate({ numerator, denominator })).toBeCloseTo(expected, 10);
  });
  it('distinguishes zero learners from missing counts or zero denominator', () => {
    expect(performanceRate({ numerator: 0, denominator: 383 })).toBe(0);
    for (const entry of [undefined, { numerator: null, denominator: 100 }, { numerator: 1, denominator: 0 }, { numerator: 1, denominator: null }, { numerator: -1, denominator: 100 }, { numerator: 1.5, denominator: 100 }]) expect(performanceRate(entry)).toBeNull();
  });
  it('computes exact percentage-point variance before rounding', () => {
    const config = emptyPerformanceConfig();
    config.configurations['2024-2025'] = { indicators: { completion: { numerator: 75, denominator: 64 } } };
    config.configurations['2025-2026'] = { indicators: { completion: { numerator: 45, denominator: 48 } } };
    expect(performanceVariance(config, '2025-2026', 'completion')).toBe(-23.4375);
    expect(formatPerformanceVariance(-23.4375)).toBe('-23.44 pp');
    expect(formatPerformanceVariance(-0.00001)).toBe('0.00 pp');
  });
  it('does not compare nonconsecutive school years', () => {
    const config = emptyPerformanceConfig();
    config.configurations['2023-2024'] = { indicators: { graduation: { numerator: 50, denominator: 50 } } };
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 45, denominator: 45 } } };
    expect(performanceVariance(config, '2025-2026', 'graduation')).toBeNull();
  });
  it('uses six-year cohort and previous-year labels from the workbook', () => {
    expect(performanceLabels('completion', '2025-2026')[1]).toContain('2019-2020 (Kindergarten)');
    expect(performanceLabels('retention', '2025-2026')[1]).toContain('2024-2025 (Kindergarten–Grade 5)');
    expect(performanceLabels('transition', '2025-2026')[1]).toContain('Grade 4 (July 31, 2024)');
    expect(PERFORMANCE_INDICATORS).toHaveLength(12);
  });
  it('accepts workbook spelling variations', () => {
    expect(indicatorIdFromLabel('Repitition Rate')).toBe('repetition');
    expect(indicatorIdFromLabel('Enrolment Rate')).toBe('enrollment');
    expect(indicatorIdFromLabel('Drop Out Rate')).toBe('dropout');
  });
});

describe('performance indicator configuration', () => {
  it('defaults to a five-year window and rejects malformed school years', () => {
    expect(emptyPerformanceConfig().windowYears).toBe(5);
    expect(normalizePerformanceYear('2025 – 2026')).toBe('2025-2026');
    expect(normalizePerformanceYear('2025-2027')).toBeNull();
    expect(normalizePerformanceYear('20219-2020')).toBeNull();
  });
  it('shows gaps and permits moving every calendar year across a window', () => {
    const config = emptyPerformanceConfig();
    config.configurations = { '2019-2020': { indicators: {} }, '2025-2026': { indicators: {} } };
    expect(visiblePerformanceYears(config)).toEqual(['2021-2022', '2022-2023', '2023-2024', '2024-2025', '2025-2026']);
    expect(visiblePerformanceYears(config, 2023)).toEqual(['2019-2020', '2020-2021', '2021-2022', '2022-2023', '2023-2024']);
    expect(visiblePerformanceYears({ ...config, windowYears: 9 })).toHaveLength(7);
  });
  it('validates every persisted count and preserves original labels', () => {
    const config = emptyPerformanceConfig();
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 45, denominator: 45, numeratorLabel: 'Original workbook label' } } };
    expect(validatePerformanceConfig(config)).toEqual(config);
    config.configurations['2025-2026'].indicators.graduation!.numerator = NaN;
    expect(() => validatePerformanceConfig(config)).toThrow('whole-number count');
    expect(() => validatePerformanceConfig({ ...emptyPerformanceConfig(), windowYears: 4 })).toThrow('invalid');
  });
  it('enforces the maximum configuration size', () => {
    const config = emptyPerformanceConfig();
    for (let index = 0; index < 101; index++) config.configurations[performanceYear(1900 + index)] = { indicators: {} };
    expect(() => validatePerformanceConfig(config)).toThrow('At most 100');
  });
});
