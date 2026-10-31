import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const role = vi.hoisted(() => ({ value: 'School Admin' }));

vi.mock('./app-config', () => ({
  APP_PAGE_PREFIX: 'pages/',
  isVisitorSession: () => false,
  isSchoolAdmin: () => role.value === 'School Admin',
  appRole: () => role.value,
  normalizedAppRole: (value: string) => value,
  canViewGradesProfile: () => true,
}));

vi.mock('./icons', () => ({
  Icon: new Proxy({}, { get: () => '<svg></svg>' }),
}));

import { mountGlobalSearch } from './global-search';

const NAV = [
  { key: 'masterlist', label: 'Learner Masterlist', href: 'masterlist.html', icon: 'users', group: null },
  { key: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings', group: null },
];

function setupTopbar() {
  document.body.innerHTML = `
    <header class="topbar">
      <div class="global-search" id="globalSearch">
        <div class="global-search-input-wrap">
          <input id="globalSearchInput" type="search" aria-expanded="false" />
        </div>
        <div class="global-search-panel" id="globalSearchPanel" hidden>
          <div class="global-search-results" id="globalSearchResults"></div>
        </div>
      </div>
    </header>
    <main class="page"></main>`;
}

describe('global search', () => {
  beforeEach(() => {
    role.value = 'School Admin';
    window.localStorage.clear();
    setupTopbar();
    mountGlobalSearch(NAV);
  });

  afterEach(() => {
    // Ensure the shared panel state closes between tests (mirrors outside-click).
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows page quick links when opened with an empty query', () => {
    document.getElementById('globalSearchInput').focus();
    const results = document.getElementById('globalSearchResults');
    const items = results.querySelectorAll('.global-search-item');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(results.querySelector('.gsi-group')?.textContent).toBe('Pages');
    expect(results.querySelector('.gsi-recent-remove')).toBeNull();
  });

  it('does not offer restricted printable search actions to a teacher', () => {
    role.value = 'Teacher';
    mountGlobalSearch(NAV);
    const input = document.querySelector<HTMLInputElement>('#globalSearchInput')!;
    for (const query of ['good moral', 'permanent records', 'outgoing envelope']) {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const links = [...document.querySelectorAll('.global-search-item')].map((node) => node.textContent);
      expect(links.join(' ')).not.toMatch(/Good Moral|SF10|Outgoing Records/);
    }
    input.value = 'print card';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('#globalSearchResults')?.textContent).toContain('Print Card');
  });

  it('does not add suggested pages to recent component history', () => {
    const input = document.getElementById('globalSearchInput');
    input.focus();
    document.querySelector('.global-search-item').click();

    expect(window.localStorage.getItem('edash.globalSearch.recent.v1')).toBeNull();
    input.focus();
    expect(document.querySelector('.gsi-group')?.textContent).toBe('Pages');
    expect(document.querySelector('.gsi-recent-remove')).toBeNull();
  });

  it('filters subcomponents by label and shows the page breadcrumb', () => {
    const input = document.getElementById('globalSearchInput');
    input.value = 'add learner';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const results = document.getElementById('globalSearchResults');
    const items = results.querySelectorAll('.global-search-item');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].querySelector('strong')?.textContent).toBe('Add Learner');
    expect(items[0].querySelector('small')?.textContent).toContain('Learner Masterlist');
  });

  it('groups subcomponents under a "Within <page>" heading', () => {
    const input = document.getElementById('globalSearchInput');
    input.value = 'account';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const results = document.getElementById('globalSearchResults');
    const groups = [...results.querySelectorAll('.gsi-group')].map((el) => el.textContent);
    expect(groups).toContain('Within Settings');
    const labels = [...results.querySelectorAll('.global-search-item strong')].map((el) => el.textContent);
    expect(labels).toContain('Account Settings');
  });

  it('searches inside Settings sub-elements such as theme selector', () => {
    const input = document.getElementById('globalSearchInput');
    input.value = 'theme';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const results = document.getElementById('globalSearchResults');
    const labels = [...results.querySelectorAll('.global-search-item strong')].map((el) => el.textContent);
    expect(labels).toContain('Theme selector');
  });

  it('shows a no-matches message when nothing is found', () => {
    const input = document.getElementById('globalSearchInput');
    input.value = 'zzzz-no-such-thing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const results = document.getElementById('globalSearchResults');
    expect(results.querySelector('.gsi-empty')?.textContent).toContain('No matches');
  });

  it('closes the panel when Esc is pressed', () => {
    document.getElementById('globalSearchInput').focus();
    const panel = document.getElementById('globalSearchPanel');
    expect(panel.hidden).toBe(false);
    const input = document.getElementById('globalSearchInput');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('shows a selected component from the recent-search cache', () => {
    window.history.replaceState({}, '', '/pages/masterlist.html');
    const input = document.getElementById('globalSearchInput');
    input.value = 'add learner';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.global-search-item').click();

    expect(JSON.parse(window.localStorage.getItem('edash.globalSearch.recent.v1'))).toHaveLength(1);
    mountGlobalSearch(NAV);
    input.focus();
    expect(document.querySelector('.gsi-group')?.textContent).toBe('Recently opened');
    expect(document.querySelector('.global-search-item strong')?.textContent).toBe('Add Learner');

    document.querySelector('.gsi-recent-remove').click();
    expect(JSON.parse(window.localStorage.getItem('edash.globalSearch.recent.v1'))).toEqual([]);
    expect(document.querySelector('.gsi-group')?.textContent).toBe('Pages');
    expect(document.querySelector('.global-search-item strong')?.textContent).toBe('Learner Masterlist');
  });

  it('uses the same search input when results are opened', () => {
    const input = document.getElementById('globalSearchInput');
    input.value = 'account';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelectorAll('#globalSearchInput')).toHaveLength(1);
    expect(document.getElementById('globalSearchPanel').hidden).toBe(false);
    expect(document.querySelector('.global-search-item strong')?.textContent).toBe('Account Settings');
  });

  it('opens and focuses the existing input with Ctrl+K', () => {
    const input = document.getElementById('globalSearchInput');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

    expect(document.activeElement).toBe(input);
    expect(document.getElementById('globalSearchPanel').hidden).toBe(false);
    expect(document.querySelectorAll('#globalSearchInput')).toHaveLength(1);
  });
});
