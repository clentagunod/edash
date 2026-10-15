export const NUTRITION_STATUS_CATEGORIES = [
  { label: 'Normal', color: '#3b82f6' },
  { label: 'Wasted', color: '#ef5350' },
  { label: 'Severely Wasted', color: '#84c341' },
  { label: 'Overweight', color: '#f59e0b' },
  { label: 'Obese', color: '#8b5cf6' },
];

const ASSESSMENT_PERIODS = [
  { key: 'bosy', label: 'Baseline' },
  { key: 'mosy', label: 'Midline' },
  { key: 'eosy', label: 'Endline' },
];

type NutritionStatus = typeof NUTRITION_STATUS_CATEGORIES[number]['label'];

export interface NutritionChartRecord {
  gender?: string;
  bosyNutritionalStatus?: string;
  mosyNutritionalStatus?: string;
  eosyNutritionalStatus?: string;
}

interface NutritionChartGroup {
  label: string;
  values: Record<NutritionStatus, number>;
  total: number;
}

export interface NutritionGraphData {
  periods: NutritionChartGroup[];
  latestStatuses: Record<NutritionStatus, number>;
  latestByGender: NutritionChartGroup[];
}

function emptyStatusCounts(): Record<NutritionStatus, number> {
  return Object.fromEntries(NUTRITION_STATUS_CATEGORIES.map(({ label }) => [label, 0])) as Record<NutritionStatus, number>;
}

function findStatus(value: unknown): NutritionStatus | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  return NUTRITION_STATUS_CATEGORIES.find(({ label }) => label.toLowerCase() === normalized)?.label;
}

function toPercentages(counts: Record<NutritionStatus, number>, total: number): Record<NutritionStatus, number> {
  return Object.fromEntries(NUTRITION_STATUS_CATEGORIES.map(({ label }) => [
    label,
    total ? counts[label] * 100 / total : 0,
  ])) as Record<NutritionStatus, number>;
}

export function buildNutritionGraphData(records: NutritionChartRecord[]): NutritionGraphData {
  const periods = ASSESSMENT_PERIODS.map(({ key, label }) => {
    const counts = emptyStatusCounts();
    records.forEach((record) => {
      const status = findStatus(record[`${key}NutritionalStatus` as keyof NutritionChartRecord]);
      if (status) counts[status] += 1;
    });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { label, values: toPercentages(counts, total), total };
  });

  const latestStatuses = emptyStatusCounts();
  const genderCounts = new Map([
    ['Male', emptyStatusCounts()],
    ['Female', emptyStatusCounts()],
  ]);
  let totalLatest = 0;

  records.forEach((record) => {
    const status = findStatus(record.eosyNutritionalStatus)
      ?? findStatus(record.mosyNutritionalStatus)
      ?? findStatus(record.bosyNutritionalStatus);
    if (!status) return;

    latestStatuses[status] += 1;
    totalLatest += 1;
    const genderCount = genderCounts.get(record.gender ?? '');
    if (genderCount) genderCount[status] += 1;
  });

  const latestByGender = ['Male', 'Female', 'Total'].map((label) => {
    const counts = label === 'Total'
      ? latestStatuses
      : genderCounts.get(label) ?? emptyStatusCounts();
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { label, values: toPercentages(counts, total), total };
  });

  return { periods, latestStatuses, latestByGender };
}

interface BarChartSeries {
  label: string;
  color: string;
  values: number[];
}

interface BarChartOptions {
  title: string;
  labels: string[];
  series: BarChartSeries[];
  maxValue: number;
  formatValue: (value: number) => string;
  legend?: boolean;
  groupTotals?: number[];
}

function renderBarChart({
  title,
  labels,
  series,
  maxValue,
  formatValue,
  legend = true,
  groupTotals = [],
}: BarChartOptions): string {
  const width = 760;
  const height = 360;
  const left = 48;
  const right = 12;
  const top = 30;
  const bottom = 56;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const groupWidth = plotWidth / labels.length;
  const barGap = series.length > 1 ? 3 : 0;
  const barWidth = Math.min(32, (groupWidth * 0.72 - barGap * (series.length - 1)) / series.length);
  const gridlineCount = 4;
  const grid = Array.from({ length: gridlineCount + 1 }, (_, index) => {
    const value = maxValue * (gridlineCount - index) / gridlineCount;
    const y = top + plotHeight * index / gridlineCount;
    return `<g><line class="nutrition-chart-gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" /><text class="nutrition-chart-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${formatValue(value)}</text></g>`;
  }).join('');

  const bars = labels.map((label, groupIndex) => {
    const groupBarWidth = series.length * barWidth + Math.max(0, series.length - 1) * barGap;
    const groupStart = left + groupIndex * groupWidth + (groupWidth - groupBarWidth) / 2;
    const columns = series.map((item, seriesIndex) => {
      const value = item.values[groupIndex] ?? 0;
      const barHeight = maxValue ? value / maxValue * plotHeight : 0;
      const x = groupStart + seriesIndex * (barWidth + barGap);
      const y = top + plotHeight - barHeight;
      const valueLabel = value > 0
        ? `<text class="nutrition-chart-value" x="${x + barWidth / 2}" y="${Math.max(top + 12, y - 7)}" text-anchor="middle">${formatValue(value)}</text>`
        : '';
      const tooltip = `${label}: ${item.label} — ${formatValue(value)}`;
      return `<g><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${item.color}" rx="2" tabindex="0" role="img" aria-label="${tooltip}"><title>${tooltip}</title></rect>${valueLabel}</g>`;
    }).join('');
    const totalLabel = groupTotals[groupIndex] == null ? '' : `<text class="nutrition-chart-group-total" x="${left + (groupIndex + 0.5) * groupWidth}" y="${top + plotHeight + 34}" text-anchor="middle">${groupTotals[groupIndex]} assessed</text>`;
    return `${columns}<text class="nutrition-chart-axis-label nutrition-chart-x-label" x="${left + (groupIndex + 0.5) * groupWidth}" y="${top + plotHeight + 17}" text-anchor="middle">${label}</text>${totalLabel}`;
  }).join('');

  const legendMarkup = legend
    ? `<div class="nutrition-chart-legend" aria-label="${title} legend">${series.map(({ label, color }) => `<span><i style="background:${color}"></i>${label}</span>`).join('')}</div>`
    : '';

  return `<svg class="nutrition-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
    <title>${title}</title>${grid}${bars}</svg>${legendMarkup}`;
}

function renderChartCard(title: string, description: string, chart: string): string {
  return `<article class="nutrition-chart-card"><header><h3>${title}</h3><p>${description}</p></header>${chart}</article>`;
}

export function renderNutritionCharts(records: NutritionChartRecord[]) {
  const target = document.getElementById('nutritionProfileCharts');
  if (!target) return;

  const data = buildNutritionGraphData(records);
  const statuses = NUTRITION_STATUS_CATEGORIES.map(({ label, color }) => ({
    label,
    color,
    values: data.periods.map(({ values }) => values[label]),
  }));
  const latestSeries = NUTRITION_STATUS_CATEGORIES.map(({ label, color }) => ({
    label,
    color,
    values: data.latestByGender.map(({ values }) => values[label]),
  }));
  const latestTotal = Object.values(data.latestStatuses).reduce((sum, count) => sum + count, 0);
  const hasData = data.periods.some(({ total }) => total > 0) || latestTotal > 0;

  if (!hasData) {
    target.innerHTML = '<p class="learner-progress-empty">No nutritional status data is available for the selected filters.</p>';
    return;
  }

  const latestCounts = [{
    label: 'Learners',
    color: '#56845a',
    values: NUTRITION_STATUS_CATEGORIES.map(({ label }) => data.latestStatuses[label]),
  }];

  target.innerHTML = [
    renderChartCard(
      'Status by assessment period',
      'Percentage of learners assessed in each period.',
      renderBarChart({
        title: 'Nutritional status by assessment period',
        labels: data.periods.map(({ label }) => label),
        series: statuses,
        maxValue: 100,
        formatValue: (value) => `${Number(value.toFixed(1))}%`,
        groupTotals: data.periods.map(({ total }) => total),
      }),
    ),
    renderChartCard(
      'Latest status mix',
      'One latest available status per learner (Endline, then Midline, then Baseline).',
      renderBarChart({
        title: 'Latest nutritional status mix',
        labels: NUTRITION_STATUS_CATEGORIES.map(({ label }) => label),
        series: latestCounts,
        maxValue: Math.max(4, Math.ceil(Math.max(...latestCounts[0].values) / 4) * 4),
        formatValue: (value) => String(Math.round(value)),
        legend: false,
      }),
    ),
    renderChartCard(
      'Status by sex',
      'Percentage of learners with a latest recorded status.',
      renderBarChart({
        title: 'Latest nutritional status by sex',
        labels: data.latestByGender.map(({ label }) => label),
        series: latestSeries,
        maxValue: 100,
        formatValue: (value) => `${Number(value.toFixed(1))}%`,
        groupTotals: data.latestByGender.map(({ total }) => total),
      }),
    ),
  ].join('');
}
