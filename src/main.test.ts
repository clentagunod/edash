import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entries = vi.hoisted(() => ({ registration: vi.fn(), application: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock('./registration-entry', () => {
    entries.registration(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    return {};
  });
  vi.doMock('./application-entry', () => {
    entries.application(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    return {};
  });
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('canonical startup before tenant initialization', () => {
  it('loads the registration entry for an old registration link without importing tenant code', async () => {
    window.history.replaceState({ draft: 1 }, '', '/register.html?school=sample#form');
    await import('./main');
    await vi.waitFor(() => expect(entries.registration).toHaveBeenCalledWith('/register?school=sample#form'));
    expect(entries.application).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ draft: 1 });
  });

  it('makes legacy page links canonical before application modules inspect the location', async () => {
    window.history.replaceState({ remembered: true }, '', '/pages/preferences.html?view=storage#pref-storage');
    await import('./main');
    await vi.waitFor(() => expect(entries.application).toHaveBeenCalledWith('/pages/preferences?view=storage#pref-storage'));
    expect(entries.registration).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ remembered: true });
  });

  it('leaves a canonical parent link intact for tenant verification', async () => {
    window.history.replaceState(null, '', '/parent/school-a?learner=123');
    await import('./main');
    await vi.waitFor(() => expect(entries.application).toHaveBeenCalledWith('/parent/school-a?learner=123'));
    expect(entries.registration).not.toHaveBeenCalled();
  });
});
