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
  { key: 'notTaggedCount', label: 'Not Tagged', color: '#2f6fed' },
  { key: 'fourPsCount', label: '4Ps Beneficiaries', color: '#d94f70' },
  { key: 'ipCount', label: 'IP Learners', color: '#1e8e5a' },
  { key: 'snedCount', label: 'SNED Learners', color: '#7c5cd1' },
  { key: 'aralCount', label: 'ARAL Tagged', color: '#e08a2b' },
  { key: 'muslimCount', label: 'Muslim Learners', color: '#31527f' },
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

/** Donut slices compare group counts; labels retain enrollment-based percentages. */
export function programDistributionMarkup(summary: ProgramSummary) {
  const groups = programDistributionData(summary);
  const chartTotal = groups.reduce((sum, group) => sum + group.value, 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = groups.map(group => {
    const length = (chartTotal ? group.value / chartTotal : 0) * circumference;
    const description = `${group.label}: ${group.value.toLocaleString()} learners (${group.percentageLabel} of total learners; ${formatLearnerPercentage(group.value, chartTotal)} of chart group counts)`;
    const segment = `<circle class="distribution-segment" data-program="${group.key}" cx="90" cy="90" r="${radius}" fill="none" stroke="${group.color}" stroke-width="26"
        stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)" tabindex="0" role="img" aria-label="${description}"><title>${description}</title></circle>`;
    offset += length;
    return segment;
  }).join('');

  const svg = `<svg class="program-distribution-chart" viewBox="0 0 180 180" width="190" height="190" role="group" aria-label="Program distribution by group counts">
    <circle cx="90" cy="90" r="${radius}" fill="none" stroke="var(--line-200, #e4e9f0)" stroke-width="26" aria-hidden="true" pointer-events="none" />
    ${segments}<circle cx="90" cy="90" r="44" fill="var(--bg-card, #fff)" aria-hidden="true" pointer-events="none" /></svg>`;
  const legend = groups.map(group => `
    <div class="legend-row">
      <span class="legend-key"><span class="legend-dot" style="background:${group.color}"></span>${group.label}</span>
      <span class="legend-val">${group.value.toLocaleString()} (${group.percentageLabel})</span>
    </div>`).join('');
  return { svg, legend };
}
