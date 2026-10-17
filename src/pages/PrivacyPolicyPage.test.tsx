import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPolicyPage from './PrivacyPolicyPage';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('PrivacyPolicyPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('explains school responsibility, information flows, retention, and contact paths', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(PrivacyPolicyPage)));
    });

    expect(container.querySelector('h1')?.textContent).toContain('Your information deserves thoughtful care');
    expect(container.textContent).toContain('school registration requests');
    expect(container.textContent).toContain('Firebase Authentication');
    expect(container.textContent).toContain('Firestore project configured for the selected school');
    expect(container.textContent).toContain('All fields on enabled school-directory documents are readable by clients');
    expect(container.textContent).toContain('does not set one universal retention period');
    expect(container.textContent).toContain('contact your school administrator');
    expect(container.querySelectorAll('.privacy-policy-section')).toHaveLength(9);
    expect(container.querySelector('.privacy-policy-back')?.getAttribute('href')).toBe('/select-school');
  });
});
