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
    window.history.replaceState({}, '', '/pages/preferences');
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
    expect(navigate).toHaveBeenCalledWith('/pages/settings');
  });

  it('routes query changes even when the page path is the same', () => {
    const navigate = vi.fn();
    const link = document.createElement('a');
    link.href = '?view=other#pref-storage';
    const event = linkEvent(link);
    handlePageLinkClick(event, navigate);
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/pages/preferences?view=other#pref-storage');
  });

  it('canonicalizes an old page link while keeping its query and fragment', () => {
    const link = document.createElement('a');
    link.href = '/pages/settings.html?section=privacy#details';
    const navigate = vi.fn();
    handlePageLinkClick(linkEvent(link), navigate);
    expect(navigate).toHaveBeenCalledWith('/pages/settings?section=privacy#details');
  });

  it.each(['external', 'download', 'new-tab', 'modified'])('preserves normal browser handling for %s links', kind => {
    const link = document.createElement('a');
    link.href = kind === 'external' ? 'https://other.test/pages/settings.html' : '/pages/settings';
    if (kind === 'download') link.download = 'settings';
    if (kind === 'new-tab') link.target = '_blank';
    const event = linkEvent(link);
    if (kind === 'modified') Object.defineProperty(event, 'ctrlKey', { value: true });
    const navigate = vi.fn();
    handlePageLinkClick(event, navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
