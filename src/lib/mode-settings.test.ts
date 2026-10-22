import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
}));

vi.mock('./school-registry', () => ({
  getCentralRegistryFirestore: () => ({
    collection: () => ({
      doc: () => ({ onSnapshot: mocks.onSnapshot }),
    }),
  }),
}));

const { getModeSettings, resolveMaintenanceMode, startModeSettingsListener } = await import('./mode-settings');

describe('central mode settings', () => {
  let nextSnapshot: (snapshot: { exists: boolean; data: () => Record<string, unknown> }) => void;

  beforeEach(() => {
    mocks.onSnapshot.mockImplementation((onNext) => {
      nextSnapshot = onNext;
      return vi.fn();
    });
  });

  it('lets a local maintenance override win while preserving Firestore behavior otherwise', () => {
    expect(resolveMaintenanceMode(false, true)).toBe(true);
    expect(resolveMaintenanceMode(true, false)).toBe(false);
    expect(resolveMaintenanceMode(true, null)).toBe(true);
    expect(resolveMaintenanceMode(false, false)).toBe(false);
  });

  it('loads both booleans from settings/modes and rejects malformed values', () => {
    const unsubscribe = vi.fn();
    mocks.onSnapshot.mockImplementation((onNext) => {
      nextSnapshot = onNext;
      return unsubscribe;
    });

    const stop = startModeSettingsListener();
    expect(getModeSettings().status).toBe('loading');

    nextSnapshot({ exists: false, data: () => ({}) });
    expect(getModeSettings()).toMatchObject({
      status: 'ready',
      isMaintenanceMode: false,
      isTestMode: false,
    });

    nextSnapshot({
      exists: true,
      data: () => ({ isMaintenanceMode: true, isTestMode: true }),
    });
    expect(getModeSettings()).toMatchObject({
      status: 'ready',
      isMaintenanceMode: true,
      isTestMode: true,
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    nextSnapshot({
      exists: true,
      data: () => ({ isMaintenanceMode: 'true', isTestMode: false }),
    });
    expect(getModeSettings()).toMatchObject({ status: 'error', isMaintenanceMode: true });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
