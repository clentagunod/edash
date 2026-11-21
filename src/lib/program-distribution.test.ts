import { afterEach, describe, expect, it } from 'vitest';
import {
  formatLearnerPercentage, learnerPercentage, learnerTaggingData,
  programDistributionData, programDistributionMarkup, renderProgramDistribution,
} from './program-distribution';

afterEach(() => { document.body.innerHTML = ''; });

const summary = {
  totalLearners: 100, notTaggedCount: 10, fourPsCount: 70,
  ipCount: 40, snedCount: 0, aralCount: 20, muslimCount: 30,
};

function ringLengths(segment: Element) {
  return segment.getAttribute('stroke-dasharray')!.split(' ').map(Number);
}

describe('overlapping program enrollment', () => {
  it('uses total enrollment for each program even when memberships exceed enrollment', () => {
    expect(programDistributionData(summary).map(({ label, percent }) => [label, percent])).toEqual([
      ['Not Tagged', 10], ['4Ps Beneficiaries', 70], ['IP Learners', 40],
      ['SNED Learners', 0], ['ARAL Tagged', 20], ['Muslim Learners', 30],
    ]);
    expect(formatLearnerPercentage(1, 3)).toBe('33.33%');
  });

  it('shows independent bars on the same enrollment scale, excluding untagged learners', () => {
    document.body.innerHTML = programDistributionMarkup(summary).bars;
    const rows = [...document.querySelectorAll('.program-percentage-row')];
    expect(rows).toHaveLength(5);
    expect(rows.map(row => row.getAttribute('data-program')))
      .toEqual(['fourPsCount', 'ipCount', 'snedCount', 'aralCount', 'muslimCount']);
    for (const [index, percentage] of [70, 40, 0, 20, 30].entries()) {
      const row = rows[index];
      const meter = row.querySelector('[role="meter"]')!;
      expect(meter.getAttribute('aria-valuenow')).toBe(String(percentage));
      expect(meter.getAttribute('aria-valuemin')).toBe('0');
      expect(meter.getAttribute('aria-valuemax')).toBe('100');
      expect(meter.getAttribute('aria-valuetext')).toBe(`${percentage} learners (${percentage.toFixed(2)}% of total learners)`);
      expect((row.querySelector('.program-percentage-fill') as HTMLElement).style.width).toBe(`${percentage}%`);
    }
  });

  it('handles numeric strings and invalid counts without invalid percentages', () => {
    expect(formatLearnerPercentage('3', '12')).toBe('25.00%');
    for (const total of [0, '0', undefined, NaN, Infinity]) {
      expect(learnerPercentage(5, total)).toBe(0);
    }
    for (const count of [undefined, -1, NaN, Infinity]) {
      expect(learnerPercentage(count, 10)).toBe(0);
    }
  });
});

describe('unique learner tagging coverage', () => {
  it('uses the unique untagged count instead of subtracting program memberships', () => {
    expect(learnerTaggingData(summary)?.map(({ label, value, percent }) => [label, value, percent]))
      .toEqual([['Tagged', 90, 90], ['Not Tagged', 10, 10]]);
    const { svg, legend } = programDistributionMarkup(summary);
    document.body.innerHTML = svg + legend;
    const segments = [...document.querySelectorAll('.distribution-segment')];
    expect(segments).toHaveLength(2);
    const circumference = 2 * Math.PI * 78;
    let offset = 0;
    for (const [index, percent] of [90, 10].entries()) {
      const [filled, empty] = ringLengths(segments[index]);
      expect(filled / circumference).toBeCloseTo(percent / 100, 10);
      expect(filled + empty).toBeCloseTo(circumference, 10);
      expect(Number(segments[index].getAttribute('stroke-dashoffset'))).toBeCloseTo(-offset, 10);
      expect(segments[index].getAttribute('aria-label')).toContain(`${percent.toFixed(2)}% of total learners`);
      offset += filled;
    }
    expect(offset).toBeCloseTo(circumference, 10);
    expect(document.querySelector('.tagging-chart-value')?.textContent).toBe('90.00%');
  });

  it.each([0, 20])('renders one complete ring when all 20 learners are in one tagging group (%s untagged)', notTaggedCount => {
    const { svg } = programDistributionMarkup({ totalLearners: 20, notTaggedCount, muslimCount: 20 - notTaggedCount });
    document.body.innerHTML = svg;
    const key = notTaggedCount === 0 ? 'taggedCount' : 'notTaggedCount';
    const segment = document.querySelector(`[data-program="${key}"]`)!;
    const [filled, empty] = ringLengths(segment);
    expect(filled).toBeCloseTo(2 * Math.PI * 78, 10);
    expect(empty).toBe(0);
  });

  it('handles numeric strings for unique counts', () => {
    expect(learnerTaggingData({ totalLearners: '12', notTaggedCount: '3' })?.map(group => group.percent))
      .toEqual([75, 25]);
  });

  it.each([undefined, null, '', ' ', NaN, Infinity, -1, 101])('does not infer missing or invalid unique counts (%s)', notTaggedCount => {
    expect(learnerTaggingData({ ...summary, notTaggedCount })).toBeNull();
    const { svg, legend, bars } = programDistributionMarkup({ ...summary, notTaggedCount });
    document.body.innerHTML = svg + legend + bars;
    expect(document.querySelectorAll('.distribution-segment')).toHaveLength(0);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('unavailable');
    expect(document.querySelector('.tagging-chart-value')?.textContent).toBe('—');
    expect(document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('70');
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('renders empty enrollment as a neutral ring and zero bars', () => {
    const { svg, legend, bars } = programDistributionMarkup({ totalLearners: 0 });
    document.body.innerHTML = svg + legend + bars;
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    expect([...document.querySelectorAll('.distribution-segment')].every(segment => ringLengths(segment)[0] === 0)).toBe(true);
    expect(document.querySelector('.tagging-empty')?.textContent).toBe('No enrolled learners in this view.');
    expect([...document.querySelectorAll('[role="meter"]')].map(row => row.getAttribute('aria-valuenow'))).toEqual(Array(5).fill('0'));
  });

  it('updates both visualizations together within the supplied root', () => {
    document.body.innerHTML = '<main><div id="donutSvg"></div><div id="donutLegend"></div><div id="programDistributionBars"></div></main>';
    renderProgramDistribution(summary, document.querySelector('main')!);
    expect(document.querySelectorAll('.distribution-segment')).toHaveLength(2);
    expect(document.querySelectorAll('[role="meter"]')).toHaveLength(5);
    renderProgramDistribution({ totalLearners: 0 });
    expect(document.querySelector('.tagging-chart-value')?.textContent).toBe('0.00%');
  });
});
