import { afterEach, describe, expect, it } from 'vitest';
import { initGraphEnhancements } from './graph-enhancements';

describe('graph fullscreen enhancements', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('moves a graph into a fullscreen dialog and restores it on Escape', () => {
    document.body.innerHTML = `
      <section class="panel">
        <header class="panel-header"><h3>Learners by Grade Level</h3></header>
        <div class="bar-chart"><div class="bar-col">Grade 1</div></div>
      </section>`;
    initGraphEnhancements();

    const graph = document.querySelector('.bar-chart') as HTMLElement;
    const expandButton = document.querySelector('.graph-expand-button') as HTMLButtonElement;
    expect(expandButton.getAttribute('aria-label')).toBe('Enlarge Learners by Grade Level to full screen');

    expandButton.click();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(graph)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.querySelector('.graph-fullscreen-close')).toBe(document.activeElement);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.bar-chart')).toBe(graph);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(expandButton).toBe(document.activeElement);
  });

  it('enhances graphs added after initialization', async () => {
    document.body.innerHTML = '<main></main>';
    initGraphEnhancements();
    document.querySelector('main')!.innerHTML = `
      <section class="nutrition-chart-card">
        <header><h3>Status mix</h3></header>
        <svg></svg>
      </section>`;

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(document.querySelector('.nutrition-chart-card .graph-expand-button')?.getAttribute('aria-label'))
      .toBe('Enlarge Status mix to full screen');
  });
});
