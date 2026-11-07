import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ directory: vi.fn(), stored: vi.fn(), signOut: vi.fn(), store: vi.fn(), clearSession: vi.fn() }));
vi.mock('../lib/firebase', () => ({ auth: { signOut: mocks.signOut } }));
vi.mock('../lib/auth', () => ({ forceLoginPageLightTheme: vi.fn() }));
vi.mock('../lib/lazy-video', () => ({ loadVideoWhenVisible: () => () => {} }));
vi.mock('../lib/tenant-session', () => ({ clearTenantSession: mocks.clearSession }));
vi.mock('../lib/school-registry', () => ({ getRegisteredSchools: mocks.directory, getStoredSchool: mocks.stored, sameSchoolRegistration: () => false, storeActiveSchool: mocks.store }));
vi.mock('../components/TestModeStamp', () => ({ default: () => null }));
vi.mock('../lib/school-registration-api', () => ({ schoolRegistrationApi: vi.fn() }));
import SchoolSelectionPage from './SchoolSelectionPage';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('school selection search integration', () => {
  let host: HTMLDivElement, root: Root;
  const schools = [
    { id: 'san-roque', enabled: true, name: 'San Roque Elementary School', nickname: 'San Roque ES', schoolInfo: { id: '123456' } },
    { id: 'mapaso', enabled: true, name: 'Mapaso Elementary School', nickname: 'Mapaso ES' },
  ];
  const input = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const continueButton = () => host.querySelector<HTMLButtonElement>('#schoolContinueBtn')!;
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  beforeEach(() => {
    vi.clearAllMocks(); mocks.directory.mockResolvedValue(schools); mocks.stored.mockReturnValue(null);
    mocks.signOut.mockRejectedValue(new Error('Test sign-out failure'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  it('only enables Continue after selecting a registered suggestion', async () => {
    await act(async () => root.render(<SchoolSelectionPage />));
    expect(continueButton().disabled).toBe(true);
    await type('123456'); expect(continueButton().disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(continueButton().disabled).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('#schoolSelect')?.value).toBe('san-roque');
    await type('Unregistered'); expect(continueButton().disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('#schoolSelect')?.value).toBe('');
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it('prefills the stored school only when it is present in the active directory', async () => {
    mocks.stored.mockReturnValue(schools[0]);
    await act(async () => root.render(<SchoolSelectionPage />));
    expect(input().value).toBe(schools[0].name); expect(continueButton().disabled).toBe(false);
  });
  it('disables search on a directory failure and restores it after retry', async () => {
    mocks.directory.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => root.render(<SchoolSelectionPage />));
    expect(input().disabled).toBe(true); expect(continueButton().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('#schoolRetryBtn')?.hidden).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('#schoolRetryBtn')!.click());
    expect(input().disabled).toBe(false); await type('Mapaso');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  });
  it('does not restore a stored school that is no longer registered', async () => {
    mocks.stored.mockReturnValue({ ...schools[0], id: 'removed-school' });
    await act(async () => root.render(<SchoolSelectionPage />));
    expect(input().value).toBe(''); expect(continueButton().disabled).toBe(true);
  });
  it('keeps search disabled and explains an empty school directory', async () => {
    mocks.directory.mockResolvedValue([]);
    await act(async () => root.render(<SchoolSelectionPage />));
    expect(input().disabled).toBe(true); expect(continueButton().disabled).toBe(true);
    expect(host.querySelector('#schoolPickerAlert')?.textContent).toContain('No active schools');
  });
  it('preserves the safe school-switching flow and permits retry after sign-out failure', async () => {
    await act(async () => root.render(<SchoolSelectionPage />));
    await type('Mapaso'); await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    await act(async () => continueButton().click());
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.clearSession).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
    expect(host.querySelector('#schoolPickerAlert')?.textContent).toContain('safely switch');
    expect(input().disabled).toBe(false); expect(continueButton().disabled).toBe(false);
  });
});
