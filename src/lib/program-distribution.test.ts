import { afterEach, describe, expect, it } from 'vitest';
import { formatLearnerPercentage, learnerPercentage, programDistributionData, programDistributionMarkup } from './program-distribution';

afterEach(() => { document.body.innerHTML = ''; });

describe('enrollment-based program percentages', () => {
  const summary = {
    totalLearners: 100, notTaggedCount: 10, fourPsCount: 70,
    ipCount: 40, snedCount: 0, aralCount: 20, muslimCount: 30,
  };

  it('uses total enrollment even when learners belong to several groups', () => {
    expect(programDistributionData(summary).map(({ label, percent }) => [label, percent])).toEqual([
      ['Not Tagged', 10], ['4Ps Beneficiaries', 70], ['IP Learners', 40],
      ['SNED Learners', 0], ['ARAL Tagged', 20], ['Muslim Learners', 30],
    ]);
    expect(formatLearnerPercentage(1, 3)).toBe('33.33%');
  });

  it('keeps one complete donut while identifying the enrollment and chart percentages', () => {
    const { svg, legend } = programDistributionMarkup(summary);
    document.body.innerHTML = svg + legend;
    const segments = [...document.querySelectorAll('.distribution-segment')];
    const rows = [...document.querySelectorAll('.legend-row')];
    expect(segments).toHaveLength(6);
    expect(new Set(segments.map(segment => segment.getAttribute('r')))).toEqual(new Set(['70']));
    let offset = 0;
    const chartTotal = 170;
    programDistributionData(summary).forEach((group, index) => {
      const segment = segments[index];
      const radius = Number(segment.getAttribute('r'));
      const [filled, empty] = segment.getAttribute('stroke-dasharray')!.split(' ').map(Number);
      expect(filled / (2 * Math.PI * radius)).toBeCloseTo(group.value / chartTotal, 10);
      expect(filled + empty).toBeCloseTo(2 * Math.PI * radius, 10);
      expect(Number(segment.getAttribute('stroke-dashoffset'))).toBeCloseTo(-offset, 10);
      offset += filled;
      expect(segment.querySelector('title')?.textContent).toContain(`${group.percentageLabel} of total learners`);
      expect(segment.getAttribute('aria-label')).toContain(`${formatLearnerPercentage(group.value, chartTotal)} of chart group counts`);
      expect(rows[index].querySelector('.legend-val')?.textContent).toBe(`${group.value} (${group.percentageLabel})`);
    });
    expect(offset).toBeCloseTo(2 * Math.PI * 70, 10);
  });

  it('represents full participation as one complete ring', () => {
    document.body.innerHTML = programDistributionMarkup({ totalLearners: 20, muslimCount: 20 }).svg;
    const ring = document.querySelector('[data-program="muslimCount"]')!;
    const [filled, empty] = ring.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(filled).toBeCloseTo(2 * Math.PI * Number(ring.getAttribute('r')), 10);
    expect(empty).toBe(0);
    expect(ring.getAttribute('aria-label')).toContain('100.00%');
  });

  it('handles empty enrollment and numeric counts without invalid percentages', () => {
    expect(formatLearnerPercentage('3', '12')).toBe('25.00%');
    for (const total of [0, '0', undefined, NaN, Infinity]) {
      expect(learnerPercentage(5, total)).toBe(0);
    }
    for (const count of [undefined, -1, NaN, Infinity]) {
      expect(learnerPercentage(count, 10)).toBe(0);
    }
    const { svg, legend } = programDistributionMarkup({ totalLearners: 0 });
    document.body.innerHTML = svg + legend;
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    expect([...document.querySelectorAll('.distribution-segment')].every(segment =>
      segment.getAttribute('stroke-dasharray')?.startsWith('0 '))).toBe(true);
    expect([...document.querySelectorAll('.legend-val')].map(row => row.textContent)).toEqual(Array(6).fill('0 (0.00%)'));
  });
});
