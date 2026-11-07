import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PerformanceIndicatorOverview from './PerformanceIndicatorOverview';
import '../styles/components/performance-indicators.css';

export default function DashboardModes() {
  const [mode, setMode] = useState<'learners' | 'performance'>('learners');
  const tabs = useRef<HTMLDivElement>(null);
  const id = useId();
  const learnerPanel = document.getElementById('learnerOverviewPanel');
  const performancePanel = document.getElementById('performanceIndicatorPanel');
  useEffect(() => {
    if (learnerPanel) learnerPanel.hidden = mode !== 'learners';
    if (performancePanel) performancePanel.hidden = mode !== 'performance';
    const description = document.querySelector('.page-header .desc');
    if (description) description.textContent = mode === 'learners' ? 'Overview of learner profiles and program tagging' : 'School performance across school years';
  }, [mode, learnerPanel, performancePanel]);
  return <>
    <div className="pi-mode-tabs" ref={tabs} role="tablist" aria-label="Dashboard view" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'learners' : event.key === 'End' ? 'performance' : mode === 'learners' ? 'performance' : 'learners';
      setMode(next); tabs.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
    }}>
      <button id={`${id}-learners`} data-mode="learners" type="button" role="tab" aria-selected={mode === 'learners'} aria-controls="learnerOverviewPanel" tabIndex={mode === 'learners' ? 0 : -1} onClick={() => setMode('learners')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" /></svg>Learner Overview</button>
      <button id={`${id}-performance`} data-mode="performance" type="button" role="tab" aria-selected={mode === 'performance'} aria-controls="performanceIndicatorPanel" tabIndex={mode === 'performance' ? 0 : -1} onClick={() => setMode('performance')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 3v17h17M8 16v-5M13 16V7M18 16V4" /></svg>Performance Indicator</button>
    </div>
    {performancePanel && mode === 'performance' && createPortal(<PerformanceIndicatorOverview />, performancePanel)}
  </>;
}
