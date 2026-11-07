import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPerformanceConfig } from './performance-indicators';
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'admin' } as { uid: string } | null },
  admin: true, get: vi.fn(), onSnapshot: vi.fn(), transactionGet: vi.fn(), transactionSet: vi.fn(), audit: vi.fn(),
}));
vi.mock('./firebase', () => ({
  auth: mocks.auth,
  db: {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get: mocks.get, onSnapshot: mocks.onSnapshot }) }),
    runTransaction: (callback: (transaction: unknown) => unknown) => callback({ get: mocks.transactionGet, set: mocks.transactionSet }),
  },
}));
vi.mock('./app-config', () => ({ isSchoolAdmin: () => mocks.admin }));
vi.mock('./firestore-api', () => ({ fsAudit_: mocks.audit }));
import { getPerformanceConfig, savePerformanceConfig, subscribePerformanceConfig } from './performance-indicators-api';

describe('performance indicator persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.admin = true; mocks.auth.currentUser = { uid: 'admin' };
    mocks.get.mockResolvedValue({ exists: false });
    mocks.transactionGet.mockResolvedValue({ exists: false });
  });
  it('returns empty defaults for schools without saved performance indicators', async () => {
    expect(await getPerformanceConfig()).toEqual(emptyPerformanceConfig());
  });
  it('saves aggregate configuration in the school settings document and increments revision', async () => {
    const config = emptyPerformanceConfig();
    config.configurations['2025-2026'] = { indicators: { graduation: { numerator: 45, denominator: 45 } } };
    const saved = await savePerformanceConfig(config);
    expect(saved.revision).toBe(1);
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'settings/performanceIndicators' }), saved);
    expect(mocks.audit).toHaveBeenCalledWith('SETTINGS_UPDATE', expect.objectContaining({ recordId: 'performanceIndicators' }));
  });
  it('rejects non-administrators before attempting a write', async () => {
    mocks.admin = false;
    await expect(savePerformanceConfig(emptyPerformanceConfig())).rejects.toThrow('Only a School Admin');
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    mocks.admin = true; mocks.auth.currentUser = null;
    await expect(savePerformanceConfig(emptyPerformanceConfig())).rejects.toThrow('Only a School Admin');
  });
  it('refuses to overwrite a configuration saved by another administrator', async () => {
    mocks.transactionGet.mockResolvedValue({ exists: true, data: () => ({ ...emptyPerformanceConfig(), revision: 2 }) });
    await expect(savePerformanceConfig(emptyPerformanceConfig())).rejects.toThrow('Another administrator saved changes');
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });
  it('passes validated live data to readers and provides subscription cleanup', () => {
    const onValue = vi.fn(), onError = vi.fn(), unsubscribe = vi.fn();
    mocks.onSnapshot.mockImplementation(callback => { callback({ exists: false }); return unsubscribe; });
    expect(subscribePerformanceConfig(onValue, onError)).toBe(unsubscribe);
    expect(onValue).toHaveBeenCalledWith(emptyPerformanceConfig());
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports malformed persisted data without replacing it with empty defaults', () => {
    const onValue = vi.fn(), onError = vi.fn();
    mocks.onSnapshot.mockImplementation(callback => { callback({ exists: true, data: () => ({ windowYears: 4 }) }); return vi.fn(); });
    subscribePerformanceConfig(onValue, onError);
    expect(onValue).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
