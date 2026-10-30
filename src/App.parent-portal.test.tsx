import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const school = { id: 'school-a', name: 'School A', nickname: 'A', enabled: true, logoUrl: '/logo.png', videoUrl: '', firebaseConfig: { projectId: 'project-a' } };
  return {
    school,
    stored: vi.fn(() => school),
    lookup: vi.fn(),
    directory: vi.fn(),
    pin: vi.fn(),
    store: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn(),
    replace: vi.fn(),
  };
});
vi.mock('./lib/school-registry', () => ({
  getStoredSchool: mocks.stored,
  getRegisteredSchool: mocks.lookup,
  getRegisteredSchools: mocks.directory,
  storeParentPortalSchool: mocks.pin,
  storeActiveSchool: mocks.store,
  clearStoredSchool: vi.fn(),
  sameSchoolRegistration: (a: typeof mocks.school, b: typeof mocks.school) => a.id === b.id && a.firebaseConfig.projectId === b.firebaseConfig.projectId,
}));
vi.mock('./lib/firebase', () => ({ auth: { signOut: mocks.signOut } }));
vi.mock('./lib/app-config', () => ({ APP_CONFIG: {}, isVisitorSession: () => false }));
vi.mock('./lib/tenant-session', () => ({ clearTenantSession: mocks.clearSession }));
vi.mock('./lib/parent-portal-links', () => ({ replaceWithParentPortal: mocks.replace }));
vi.mock('./lib/mode-settings', () => ({}));
vi.mock('./lib/page-navigation', () => ({}));
vi.mock('./pages/LoginPage', () => ({ default: () => null }));
vi.mock('./pages/SchoolSelectionPage', () => ({ default: () => null }));
vi.mock('./pages/ParentPortalPage', () => ({ default: () => null }));
vi.mock('./pages/MaintenancePage', () => ({ default: () => null }));
vi.mock('./components/RouteLoadingFallback', () => ({ default: () => <div>Loading school</div> }));

import { SchoolRegistrationGate } from './App';

let root: Root;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stored.mockReturnValue(mocks.school);
  mocks.lookup.mockResolvedValue(mocks.school);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function render(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SchoolRegistrationGate><p>Verified parent portal</p></SchoolRegistrationGate></MemoryRouter>));
}

describe('school-specific parent portal entry', () => {
  it('opens a matching school directly and reads no school directory', async () => {
    await render('/parent/school-a');
    expect(mocks.lookup).toHaveBeenCalledWith('school-a');
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Verified parent portal');
    expect(mocks.pin).toHaveBeenCalledWith(mocks.school);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it.each(['school-b', 'school-a'])('reloads before showing parent data when school %s needs a different Firebase configuration', async (id) => {
    const other = { ...mocks.school, id, firebaseConfig: { projectId: 'project-b' } };
    mocks.lookup.mockResolvedValue(other);
    await render(`/parent/${id}`);
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(mocks.pin).toHaveBeenCalledWith(other);
    expect(mocks.replace).toHaveBeenCalledWith(id);
    expect(mocks.pin.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Verified parent portal');
  });

  it('handles a first visit with no saved school', async () => {
    mocks.stored.mockReturnValue(null as never);
    await render('/parent/school-a');
    expect(mocks.pin).toHaveBeenCalledWith(mocks.school);
    expect(mocks.replace).toHaveBeenCalledWith('school-a');
    expect(container.textContent).not.toContain('Verified parent portal');
  });

  it('shows unavailable schools without falling back to the previously selected school', async () => {
    mocks.lookup.mockResolvedValue(null);
    await render('/parent/missing-school');
    expect(container.textContent).toContain('This school’s parent portal is unavailable');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/select-school');
    expect(mocks.pin).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Verified parent portal');
  });

  it('retries a registry failure without changing the school selection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.lookup.mockRejectedValueOnce(new Error('Offline'));
    await render('/parent/school-a');
    expect(container.textContent).toContain('unavailable');
    expect(mocks.pin).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.textContent).toContain('Verified parent portal');
  });

  it('stops showing the portal when the linked school is revoked', async () => {
    vi.useFakeTimers();
    await render('/parent/school-a');
    mocks.lookup.mockResolvedValue(null);
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
    expect(container.textContent).not.toContain('Verified parent portal');
    expect(container.textContent).toContain('unavailable');
  });
});
