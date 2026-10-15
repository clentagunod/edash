const GRAPH_SELECTOR = '.nutrition-chart-card, .learner-progress-chart, .bar-chart, .donut-wrap';

let graphObserver: MutationObserver | undefined;
let activeGraphClose: (() => void) | undefined;

function getGraphHeading(graph: HTMLElement): HTMLElement | null {
  if (graph.matches('.nutrition-chart-card')) return graph.querySelector('header');
  if (graph.matches('.learner-progress-chart')) return graph.querySelector('.learner-progress-heading');
  return graph.closest('.panel')?.querySelector('.panel-header') ?? null;
}

function openFullscreenGraph(graph: HTMLElement, trigger: HTMLButtonElement) {
  if (activeGraphClose) activeGraphClose();

  const placeholder = document.createComment('graph fullscreen placeholder');
  const parent = graph.parentNode;
  if (!parent) return;
  parent.insertBefore(placeholder, graph);

  const overlay = document.createElement('div');
  overlay.className = 'graph-fullscreen-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${trigger.dataset.graphTitle || 'Chart'} full screen`);

  const toolbar = document.createElement('div');
  toolbar.className = 'graph-fullscreen-toolbar';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'graph-fullscreen-close';
  closeButton.setAttribute('aria-label', 'Close full screen chart');
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg><span>Close</span>';
  toolbar.append(closeButton);

  const content = document.createElement('div');
  content.className = 'graph-fullscreen-content';
  overlay.append(toolbar, content);
  document.body.append(overlay);
  content.append(graph);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  graph.classList.add('is-fullscreen-graph');

  const close = () => {
    if (!overlay.isConnected) return;
    graph.classList.remove('is-fullscreen-graph');
    placeholder.parentNode?.insertBefore(graph, placeholder);
    placeholder.remove();
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    document.removeEventListener('keydown', onKeyDown);
    activeGraphClose = undefined;
    trigger.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex="0"]:not([disabled])',
      )].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  activeGraphClose = close;
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);
  closeButton.focus();
}

function enhanceGraph(graph: HTMLElement) {
  if (graph.dataset.graphEnhanced === 'true') return;
  const heading = getGraphHeading(graph);
  if (!heading) return;

  const title = heading.querySelector('h2, h3')?.textContent?.trim() || 'Chart';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'graph-expand-button';
  button.dataset.graphTitle = title;
  button.setAttribute('aria-label', `Enlarge ${title} to full screen`);
  button.title = 'View full screen';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 8l6-6m12 6l-6-6M3 16l6 6m12-6l-6 6" /></svg>';
  button.addEventListener('click', () => openFullscreenGraph(graph, button));
  heading.append(button);
  graph.dataset.graphEnhanced = 'true';
}

export function initGraphEnhancements(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(GRAPH_SELECTOR).forEach(enhanceGraph);

  if (graphObserver || !document.body) return;
  graphObserver = new MutationObserver((mutations) => {
    mutations.forEach(({ addedNodes }) => {
      addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(GRAPH_SELECTOR)) enhanceGraph(node);
        node.querySelectorAll<HTMLElement>(GRAPH_SELECTOR).forEach(enhanceGraph);
      });
    });
  });
  graphObserver.observe(document.body, { childList: true, subtree: true });
}
