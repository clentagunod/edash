import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/firestore-api', () => ({ fsGetCertificatePreferences: vi.fn(), fsSetCertificatePreferences: vi.fn() }));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => null }));
vi.mock('../lib/app-config', () => ({ appBrandAssetUrl: (value: string) => value }));

import CertificatePreferencesPanel from './CertificatePreferencesPanel';
import { fsGetCertificatePreferences, fsSetCertificatePreferences } from '../lib/firestore-api';
import { normalizeCertificatePreferences } from '../lib/certificate-preferences';

let root: Root;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  vi.mocked(fsGetCertificatePreferences).mockReset().mockResolvedValue(normalizeCertificatePreferences());
  vi.mocked(fsSetCertificatePreferences).mockReset().mockImplementation(async (value) => normalizeCertificatePreferences(value));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === text)!;
}
function control<T extends HTMLInputElement | HTMLSelectElement>(label: string) {
  return [...container.querySelectorAll('label')].find((entry) => entry.textContent?.includes(label))!.querySelector<T>('input, select')!;
}

describe('certificate preferences administration', () => {
  it('keeps at least one template enabled and persists an enabled replacement default', async () => {
    await act(async () => root.render(<CertificatePreferencesPanel />));
    expect(control<HTMLInputElement>('Default Good Moral').disabled).toBe(true);
    expect(button('Save certificate preferences').disabled).toBe(true);
    act(() => control<HTMLInputElement>('Default COE').click());
    expect(control<HTMLSelectElement>('Default COE template').value).toBe('sres');
    expect(control<HTMLInputElement>('SRES COE').disabled).toBe(true);
    act(() => control<HTMLInputElement>('Show school-seal notice').click());
    expect(fsSetCertificatePreferences).not.toHaveBeenCalled();
    await act(async () => button('Save certificate preferences').click());
    expect(fsSetCertificatePreferences).toHaveBeenCalledWith(expect.objectContaining({ showSealNotice: false, templates: expect.objectContaining({ enrollment: expect.objectContaining({ enabledTemplates: ['sres'], defaultTemplate: 'sres' }) }) }));
    expect(container.textContent).toContain('saved for everyone in this school');
    expect(button('Save certificate preferences').disabled).toBe(true);
  });

  it('preserves the draft after a failed save and allows retry', async () => {
    vi.mocked(fsSetCertificatePreferences).mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => root.render(<CertificatePreferencesPanel />));
    act(() => control<HTMLInputElement>('Allow registrars to edit school details').click());
    await act(async () => button('Save certificate preferences').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection lost');
    expect(control<HTMLInputElement>('Allow registrars to edit school details').checked).toBe(false);
    expect(button('Save certificate preferences').disabled).toBe(false);
    await act(async () => button('Save certificate preferences').click());
    expect(fsSetCertificatePreferences).toHaveBeenCalledTimes(2);
    expect(button('Save certificate preferences').disabled).toBe(true);
  });

  it('cannot overwrite settings after a failed read and can retry loading', async () => {
    vi.mocked(fsGetCertificatePreferences).mockRejectedValueOnce(new Error('Settings unavailable'));
    await act(async () => root.render(<CertificatePreferencesPanel />));
    expect(button('Save certificate preferences').closest('fieldset')?.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Settings unavailable');
    expect(fsSetCertificatePreferences).not.toHaveBeenCalled();
    await act(async () => button('Retry preferences').click());
    expect(button('Save certificate preferences').closest('fieldset')?.disabled).toBe(false);
    act(() => control<HTMLInputElement>('Show school-seal notice').click());
    act(() => button('Discard changes').click());
    expect(control<HTMLInputElement>('Show school-seal notice').checked).toBe(true);
    expect(fsSetCertificatePreferences).not.toHaveBeenCalled();
  });
});
