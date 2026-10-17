import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ loginPageUrl: vi.fn(), requireAuth: vi.fn() }));
vi.mock('../lib/firebase', () => ({ auth: { onAuthStateChanged: vi.fn() } }));
vi.mock('../lib/firestore-api', () => ({
  fsGetGradeLevelGradingConfigurations: vi.fn(),
  fsGetCardPrintingPreferences: vi.fn(),
  fsGetGradeTermCount: vi.fn(),
  fsGetGradeSubjectAssignments: vi.fn(),
  fsGetLearners: vi.fn(),
  fsGetPassingThreshold: vi.fn(),
  fsGetRoundType: vi.fn(),
  fsGetSchoolYears: vi.fn(),
  fsGetSections: vi.fn(),
}));
vi.mock('../lib/app-config', () => ({
  APP_CONFIG: { branding: { schoolName: 'Sample School', schoolLogoUrl: '/sample-logo.png' } },
  appBrandAssetUrl: (url: string) => url,
}));

import { AdminCardTemplateChooser } from './PrintCardPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const mountedRoots: Root[] = [];

afterEach(() => {
  act(() => mountedRoots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

describe('Admin Card Preferences template preview', () => {
  it('uses the Card Print template for the preview and opens its full-screen inspector', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
    });

    act(() => root.render(<AdminCardTemplateChooser />));

    expect(container.querySelector('#adminCardTemplate')).toHaveProperty('value', 'sf9');
    expect(container.querySelectorAll('.sf9-report-card')).toHaveLength(2);
    expect(container.querySelectorAll('.sf9-card-front')).toHaveLength(2);
    expect(container.querySelectorAll('.sf9-card-back')).toHaveLength(2);
    expect(container.textContent).toContain('LEARNER’S PERFORMANCE REPORT');
    expect(container.textContent).toContain('ATTENDANCE RECORD');
    expect(container.textContent).toContain('Original numerical template (SF9)');

    act(() => (container.querySelector('.admin-card-inspect-button') as HTMLButtonElement).click());
    expect(showModal).toHaveBeenCalledOnce();

    act(() => (container.querySelector('.admin-card-inspector-actions button') as HTMLButtonElement).click());
    expect(container.querySelector('.admin-card-inspector')?.classList.contains('admin-card-inspector--fullscreen')).toBe(true);
  });
});
