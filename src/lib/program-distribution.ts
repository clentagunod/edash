import '../styles/components/program-distribution.css';

type ProgramSummary = {
  totalLearners?: unknown;
  notTaggedCount?: unknown;
  fourPsCount?: unknown;
  ipCount?: unknown;
  snedCount?: unknown;
  aralCount?: unknown;
  muslimCount?: unknown;
};

const PROGRAM_CATEGORIES = [
  { key: 'notTaggedCount', label: 'Not Tagged', color: 'var(--ink-300)' },
  { key: 'fourPsCount', label: '4Ps Beneficiaries', color: 'var(--tag-4ps)' },
  { key: 'ipCount', label: 'IP Learners', color: 'var(--tag-ip)' },
  { key: 'snedCount', label: 'SNED Learners', color: 'var(--tag-sned)' },
  { key: 'aralCount', label: 'ARAL Tagged', color: 'var(--tag-aral)' },
  { key: 'muslimCount', label: 'Muslim Learners', color: 'var(--tag-muslim)' },
] as const;

function learnerCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function learnerPercentage(count: unknown, totalLearners: unknown): number {
  const total = learnerCount(totalLearners);
  return total > 0 ? (learnerCount(count) / total) * 100 : 0;
}

export function formatLearnerPercentage(count: unknown, totalLearners: unknown): string {
  return `${learnerPercentage(count, totalLearners).toFixed(2)}%`;
}

export function programDistributionData(summary: ProgramSummary) {
  return PROGRAM_CATEGORIES.map(category => ({
    ...category,
    value: learnerCount(summary[category.key]),
    percent: learnerPercentage(summary[category.key], summary.totalLearners),
    percentageLabel: formatLearnerPercentage(summary[category.key], summary.totalLearners),
  }));
}

/** The unique untagged count must come from learner records, never summed program counts. */
export function learnerTaggingData(summary: ProgramSummary) {
  const total = learnerCount(summary.totalLearners);
  const untagged = Number(summary.notTaggedCount);
  if (total > 0 && (
    summary.notTaggedCount == null || String(summary.notTaggedCount).trim() === ''
    || !Number.isFinite(untagged) || untagged < 0 || untagged > total
  )) return null;

  return [
    { key: 'taggedCount', label: 'Tagged', color: 'var(--blue-600)', value: total > 0 ? total - untagged : 0 },
    { key: 'notTaggedCount', label: 'Not Tagged', color: 'var(--ink-300)', value: total > 0 ? untagged : 0 },
  ].map(group => ({
    ...group,
    percent: learnerPercentage(group.value, total),
    percentageLabel: formatLearnerPercentage(group.value, total),
  }));
}

/** Unique learner coverage in the donut; overlapping program enrollment in independent bars. */
export function programDistributionMarkup(summary: ProgramSummary) {
  const groups = learnerTaggingData(summary);
  const total = learnerCount(summary.totalLearners);
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = (groups || []).map(group => {
    const length = group.percent / 100 * circumference;
    const description = `${group.label}: ${group.value.toLocaleString()} learners (${group.percentageLabel} of total learners)`;
    const segment = `<circle class="distribution-segment" data-program="${group.key}" cx="100" cy="100" r="${radius}" fill="none" stroke="${group.color}" stroke-width="20"
        stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" tabindex="0" role="img" aria-label="${description}"><title>${description}</title></circle>`;
    offset += length;
    return segment;
  }).join('');

  const svg = `<svg class="learner-tagging-chart" viewBox="0 0 200 200" width="210" height="210" role="group" aria-label="Tagged versus untagged learners${groups ? '' : ': breakdown unavailable'}">
    <circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--line-100)" stroke-width="20" aria-hidden="true" pointer-events="none" />
    ${segments}
    <text class="tagging-chart-value" x="100" y="98" text-anchor="middle" aria-hidden="true">${groups ? groups[0].percentageLabel : '—'}</text>
    <text class="tagging-chart-label" x="100" y="119" text-anchor="middle" aria-hidden="true">${groups ? 'Tagged' : 'Unavailable'}</text>
    </svg>`;
  const legend = groups ? groups.map(group => `
    <div class="legend-row" data-tagging="${group.key}">
      <span class="legend-key"><span class="legend-dot" style="background:${group.color}"></span>${group.label}</span>
      <span class="legend-val">${group.value.toLocaleString()} <span class="tagging-legend-percentage">(${group.percentageLabel})</span></span>
    </div>`).join('') : '<p class="tagging-unavailable" role="status">Tagging breakdown is unavailable for this summary.</p>';
  const taggingLegend = `<p class="tagging-enrollment"><strong>${total.toLocaleString()}</strong> total learners</p>${legend}${total === 0 ? '<p class="tagging-empty">No enrolled learners in this view.</p>' : ''}`;

  const bars = `<div class="program-percentage-scale" aria-hidden="true"><span>Share of total learners</span><span>0–100%</span></div>`
    + programDistributionData(summary).filter(group => group.key !== 'notTaggedCount').map(group => {
      const description = `${group.value.toLocaleString()} learners (${group.percentageLabel} of total learners)`;
      return `<div class="program-percentage-row" data-program="${group.key}" style="--program-color:${group.color}">
        <div class="program-percentage-heading">
          <span class="program-percentage-label"><span class="legend-dot" aria-hidden="true"></span>${group.label}</span>
          <span class="program-percentage-value"><span class="program-percentage-count">${group.value.toLocaleString()}</span><strong>${group.percentageLabel}</strong></span>
        </div>
        <div class="program-percentage-track" role="meter" aria-label="${group.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, group.percent)}" aria-valuetext="${description}" tabindex="0" title="${group.label}: ${description}">
          <span class="program-percentage-fill" style="width:${Math.min(100, group.percent)}%"></span>
        </div>
      </div>`;
    }).join('');
  return { svg, legend: taggingLegend, bars };
}

/** Shared by Dashboard and Statistics, including live updates and role-specific views. */
export function renderProgramDistribution(summary: ProgramSummary, root: ParentNode = document) {
  const markup = programDistributionMarkup(summary);
  for (const [selector, content] of [
    ['#donutSvg', markup.svg], ['#donutLegend', markup.legend], ['#programDistributionBars', markup.bars],
  ]) {
    const mount = root.querySelector(selector);
    if (mount) mount.innerHTML = content;
  }
}
