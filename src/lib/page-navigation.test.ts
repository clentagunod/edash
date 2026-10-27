import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import preferencesMarkup from '../pages/markup/preferences.html?raw';
import { handlePageLinkClick } from './page-navigation';

function linkEvent(target: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('legacy page link navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/pages/preferences.html');
    document.body.innerHTML = preferencesMarkup;
  });
  afterEach(() => { window.history.replaceState({}, '', '/'); document.body.innerHTML = ''; });

  it('lets all four preference links reach their sections using native anchor navigation', () => {
    const navigate = vi.fn();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.pref-sidebar nav a')];
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
      // The icon/label, rather than the anchor itself, is often the click target.
      const event = linkEvent(link.querySelector('span')!);
      handlePageLinkClick(event, navigate);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still routes links to a different application page', () => {
    const navigate = vi.fn();
    const event = linkEvent(document.querySelector('.preferences-back-link')!);
    handlePageLinkClick(event, navigate);
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/pages/settings.html');
  });

  it('routes query changes even when the page path is the same', () => {
    const navigate = vi.fn();
    const link = document.createElement('a');
    link.href = '?view=other#pref-storage';
    const event = linkEvent(link);
    handlePageLinkClick(event, navigate);
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/pages/preferences.html?view=other#pref-storage');
  });
});
