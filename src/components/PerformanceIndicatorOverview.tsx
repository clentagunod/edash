import { useEffect, useId, useState } from 'react';
import { subscribePerformanceConfig } from '../lib/performance-indicators-api';
import {
  formatPerformanceRate, formatPerformanceVariance, PERFORMANCE_INDICATORS, performanceLabels,
  performanceRate, performanceVariance, performanceWindowBounds, performanceYear, visiblePerformanceYears,
  type PerformanceConfig, type PerformanceIndicatorId,
} from '../lib/performance-indicators';
import '../styles/components/performance-indicators.css';

function axisMaximum(value: number) {
  const target = Math.max(1, value) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find(step => step * magnitude >= target)! * magnitude;
  return step * 4;
}

function IndicatorChart({ config, id, years }: { config: PerformanceConfig; id: PerformanceIndicatorId; years: string[] }) {
  const definition = PERFORMANCE_INDICATORS.find(item => item.id === id)!;
  const chartId = useId();
  const points = years.map(year => ({ year, entry: config.configurations[year]?.indicators[id], rate: performanceRate(config.configurations[year]?.indicators[id]) }));
  const latest = points[points.length - 1];
  const variance = performanceVariance(config, latest.year, id);
  const direction = variance === null || Math.abs(variance) < 0.005 ? 'neutral' : (variance < 0) === definition.lowerIsBetter ? 'positive' : 'negative';
  const max = axisMaximum(Math.max(0, ...points.map(point => point.rate ?? 0)));
  const plot = { left: 54, top: 24, width: 510, height: 146 };
  const slot = plot.width / points.length, barWidth = Math.min(48, slot * 0.55);
  return <article className="pi-chart-card" aria-labelledby={`${chartId}-heading`}>
    <div className="pi-chart-heading"><h3 id={`${chartId}-heading`}>{definition.label}</h3><span className="pi-direction">Rate (%)</span></div>
    <div className="pi-chart-metric"><strong>{formatPerformanceRate(latest.rate)}</strong><span className={`pi-variance pi-direction-${direction}`}>{formatPerformanceVariance(variance)}</span></div>
    <p className="pi-chart-caption">S.Y. {latest.year} <span>· versus previous S.Y.</span></p>
    <svg className="pi-bar-chart" viewBox="0 0 600 218" role="group" aria-labelledby={`${chartId}-title`}>
      <title id={`${chartId}-title`}>{definition.label} by school year. Values are percentages.</title>
      {Array.from({ length: 5 }, (_, index) => {
        const value = max * index / 4, y = plot.top + plot.height * (1 - index / 4);
        return <g key={index} className="pi-chart-axis"><line x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} /><text x={plot.left - 9} y={y + 4} textAnchor="end">{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</text></g>;
      })}
      {points.map((point, index) => {
        const x = plot.left + slot * (index + 0.5), height = point.rate === null ? 0 : point.rate / max * plot.height;
        const description = `${point.year}: ${formatPerformanceRate(point.rate)}${point.entry ? `; ${point.entry.numerator ?? 'missing'} divided by ${point.entry.denominator ?? 'missing'}, times 100` : ''}`;
        return <g key={point.year} tabIndex={0} role="img" aria-label={description} className={`pi-chart-bar-group ${index === points.length - 1 ? 'is-latest' : ''}`}>
          <title>{description}</title>
          <rect className="pi-bar-hit" x={x - slot / 2 + 2} y={8} width={slot - 4} height={199} rx={7} />
          {point.rate === null ? <line className="pi-bar-missing" x1={x - barWidth / 2} x2={x + barWidth / 2} y1={plot.top + plot.height} y2={plot.top + plot.height} /> :
            <rect className="pi-chart-bar" x={x - barWidth / 2} y={plot.top + plot.height - Math.max(height, 2)} width={barWidth} height={Math.max(height, 2)} rx={4} />}
          <text className="pi-bar-value" x={x} y={point.rate === null ? plot.top + plot.height - 12 : plot.top + plot.height - height - 8} textAnchor="middle">{point.rate === null ? '—' : `${point.rate.toFixed(1)}%`}</text>
          <text className="pi-bar-year" x={x} y={194} textAnchor="middle">{point.year.slice(0, 4)}–{point.year.slice(-2)}</text>
        </g>;
      })}
    </svg>
    <details className="pi-chart-details"><summary>View counts &amp; computation</summary><div className="pi-table-scroll"><table className="data-table"><caption>{definition.label}: source data and calculated rates</caption><thead><tr><th>School year</th><th>Source counts</th><th>Rate</th><th>Variance</th></tr></thead><tbody>
      {points.map(point => {
        const labels = performanceLabels(id, point.year);
        return <tr key={point.year}><th scope="row">{point.year}</th><td><span title={point.entry?.numeratorLabel || labels[0]}>{point.entry?.numeratorLabel || labels[0]}: <strong>{point.entry?.numerator?.toLocaleString() ?? '—'}</strong></span><br /><span title={point.entry?.denominatorLabel || labels[1]}>{point.entry?.denominatorLabel || labels[1]}: <strong>{point.entry?.denominator?.toLocaleString() ?? '—'}</strong></span></td><td>{formatPerformanceRate(point.rate)}</td><td>{formatPerformanceVariance(performanceVariance(config, point.year, id))}</td></tr>;
      })}
    </tbody></table></div></details>
  </article>;
}

/** A supplied config renders the administrator's unsaved preview without a database listener. */
export default function PerformanceIndicatorOverview({ config: preview }: { config?: PerformanceConfig }) {
  const [live, setLive] = useState<PerformanceConfig | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState<number | undefined>();
  const sliderId = useId();
  const config = preview || live;
  useEffect(() => {
    if (preview) return;
    let active = true;
    setError('');
    const timeout = window.setTimeout(() => { if (active) setError('Performance indicators are taking too long to load. Check your connection and try again.'); }, 15000);
    const unsubscribe = subscribePerformanceConfig(value => {
      if (active) { setLive(value); setError(''); window.clearTimeout(timeout); }
    }, failure => {
      if (!active) return;
      // Firestore can emit a cached snapshot before rejecting the server read.
      // Do not keep displaying that snapshot after access has been denied.
      setLive(null);
      setError(failure.message || 'Could not load performance indicators.');
      window.clearTimeout(timeout);
    });
    return () => { active = false; window.clearTimeout(timeout); unsubscribe(); };
  }, [preview, reload]);
  const bounds = config ? performanceWindowBounds(config) : null;
  const end = bounds ? Math.max(bounds.min, Math.min(bounds.max, selectedEnd ?? bounds.max)) : 0;
  const years = config ? visiblePerformanceYears(config, end) : [];
  const latestCount = config && years.length ? PERFORMANCE_INDICATORS.filter(item => performanceRate(config.configurations[years[years.length - 1]]?.indicators[item.id]) !== null).length : 0;
  return <div className="pi-overview">
    <div className="pi-overview-heading"><div><span className="pi-eyebrow">Across school years</span><h2>Performance Indicator</h2><p>A clearer view of your school’s progress, one school year at a time.</p></div><span className="pi-readonly-badge">School performance</span></div>
    {error && <div className="pi-message pi-message-error" role="alert">{error} <button className="pi-text-button" type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {!config ? !error && <div className="pi-empty" role="status">Loading school performance…</div> : !bounds ? <div className="pi-empty"><div className="pi-empty-icon" aria-hidden="true">▥</div><h3>Your performance history starts here</h3><p>Performance indicators will appear once a school administrator adds school years and source counts in Admin Console → Performance Indicators.</p></div> : <>
      <section className="pi-timeline" aria-label="Performance school year window">
        <div className="pi-timeline-heading"><div><span className="pi-eyebrow">Viewing school years</span><strong aria-live="polite">{years[0]} <span aria-hidden="true">→</span> {years[years.length - 1]}</strong></div><span className="pi-window-badge">{config.windowYears}-year window</span></div>
        <div className="pi-slider-row"><button className="pi-slide-button" type="button" aria-label="View earlier school years" disabled={end <= bounds.min} onClick={() => setSelectedEnd(end - 1)}>‹</button><div className="pi-slider"><label htmlFor={sliderId}>Slide to explore available years</label><input id={sliderId} type="range" min={bounds.min} max={bounds.max} step={1} value={end} disabled={bounds.min === bounds.max} aria-label="Last school year in the performance window" aria-valuetext={`School years ${years[0]} through ${years[years.length - 1]}`} onChange={event => setSelectedEnd(Number(event.target.value))} /><div className="pi-slider-labels"><span>{performanceYear(bounds.first)}</span><span>{performanceYear(bounds.max)}</span></div></div><button className="pi-slide-button" type="button" aria-label="View later school years" disabled={end >= bounds.max} onClick={() => setSelectedEnd(end + 1)}>›</button></div>
        <div className="pi-timeline-note"><span><i className="pi-legend-dot" />{latestCount} of 12 indicators available for {years[years.length - 1]}</span><span>Variance in percentage points (pp) · Missing data shown as —</span></div>
      </section>
      <div className="pi-chart-grid" key={`${years[0]}/${years[years.length - 1]}`}>{PERFORMANCE_INDICATORS.map(item => <IndicatorChart key={item.id} config={config} id={item.id} years={years} />)}</div>
      <p className="pi-footnote">Rates = numerator ÷ denominator × 100. Variance compares with the immediately preceding school year, including years outside the selected window. Rates may exceed 100%. A missing count or zero denominator has no calculable rate.</p>
    </>}
  </div>;
}
