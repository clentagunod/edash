import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ loginPageUrl: vi.fn(), requireAuth: vi.fn() }));
vi.mock('../lib/firebase', () => ({ auth: { onAuthStateChanged: vi.fn() } }));
vi.mock('../lib/shell', () => ({ applySavedTheme: vi.fn() }));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => null, getRegisteredSchools: vi.fn().mockResolvedValue([]) }));
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

import PrintCardPage, { AdminCardTemplateChooser } from './PrintCardPage';
import * as firestore from '../lib/firestore-api';

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

describe('Card print studio', () => {
  it('supports precision layout editing, undo/redo, preview mode and panel switching', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
    vi.mocked(firestore.fsGetSchoolYears).mockResolvedValue([{ schoolYear: '2026-2027', isCurrent: true }] as never);
    vi.mocked(firestore.fsGetLearners).mockResolvedValue([{ learnerId: '123', firstName: 'Alex', lastName: 'Reyes', gradeLevel: 'Grade 4' }] as never);
    vi.mocked(firestore.fsGetSections).mockResolvedValue([]);
    vi.mocked(firestore.fsGetGradeSubjectAssignments).mockResolvedValue({ grades: {}, subjects: [] } as never);
    vi.mocked(firestore.fsGetGradeLevelGradingConfigurations).mockResolvedValue({ gradeLevels: {} } as never);
    vi.mocked(firestore.fsGetGradeTermCount).mockResolvedValue(4);
    vi.mocked(firestore.fsGetPassingThreshold).mockResolvedValue(75);
    vi.mocked(firestore.fsGetRoundType).mockResolvedValue('whole' as never);
    vi.mocked(firestore.fsGetCardPrintingPreferences).mockResolvedValue({ activeTemplate: 'sf9', gradeTemplates: {}, attendanceMonths: ['Jun'], attendanceRows: [{ id: 'classDays', label: 'Class days' }] } as never);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    await act(async () => root.render(<PrintCardPage />));
    const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text)!;
    const checkbox = container.querySelector<HTMLInputElement>('.student-card-learner-check input')!;
    act(() => checkbox.click());
    const geometry = () => container.querySelector<HTMLInputElement>('.student-card-layout-inspector input[type="number"]')!;
    expect(geometry().value).toBe('4');
    act(() => button('Center horizontally').click());
    expect(Number(geometry().value)).toBeGreaterThan(4);
    act(() => button('↶ Undo').click());
    expect(geometry().value).toBe('4');
    act(() => button('↷ Redo').click());
    expect(Number(geometry().value)).toBeGreaterThan(4);
    act(() => button('View only').click());
    expect(container.querySelector('fieldset.student-card-layout-inspector')).toHaveProperty('disabled', true);
    expect(button('Reset layout').disabled).toBe(true);
    act(() => button('Edit layout').click());
    act(() => button('Reset layout').click());
    expect(geometry().value).toBe('4');
    act(() => geometry().focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(geometry(), '25.5');
      geometry().dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => geometry().blur());
    expect(geometry().value).toBe('25.5');
    act(() => button('↶ Undo').click());
    expect(geometry().value).toBe('4');
    const widthInput = () => container.querySelectorAll<HTMLInputElement>('.student-card-layout-inspector input[type="number"]')[2];
    const originalWidth = widthInput().value;
    act(() => container.querySelector('.student-card-canvas-resize')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(Number(widthInput().value)).toBeLessThan(Number(originalWidth));
    expect(geometry().value).toBe('4');
    act(() => container.querySelector('main')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(widthInput().value).toBe(originalWidth);
    act(() => (container.querySelector('.student-card-learner-select') as HTMLButtonElement).click());
    act(() => button('02 / Card details').click());
    const panels = container.querySelectorAll<HTMLElement>('.student-card-editor-section');
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    // Switching paper sizes invalidates history from the previous paper geometry.
    const paperSelect = container.querySelector<HTMLSelectElement>('.student-card-paper-control select')!;
    act(() => { paperSelect.value = 'a5'; paperSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('↶ Undo').disabled).toBe(true);
    expect(container.querySelector('.student-card-canvas-caption')?.textContent).toContain('portrait');
    act(() => checkbox.click());
    expect(container.querySelector('.student-card-layout-inspector')).toBeNull();
    expect(container.querySelector('.student-card-canvas-empty')?.textContent).toContain('Choose a learner');
  });
});
