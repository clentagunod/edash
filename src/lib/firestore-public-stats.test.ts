import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null, setPersistence: vi.fn().mockResolvedValue(undefined), onAuthStateChanged: vi.fn() },
  db: { enablePersistence: vi.fn().mockResolvedValue(undefined), collection: vi.fn(), runTransaction: vi.fn() },
}));

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mocks.auth, firestore: () => mocks.db, functions: () => ({}) })),
  auth: Object.assign(vi.fn(() => mocks.auth), { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
  firestore: Object.assign(vi.fn(() => mocks.db), { FieldValue: { serverTimestamp: () => 'server-time' } }),
});

const { fsPublicActive_, fsUpdatePublicStatsForChange_ } = await import('./firestore-api');
const { LPSCache } = await import('./cache');

describe('incremental public learner statistics', () => {
  const year = '2026-2027';
  const untagged = { learnerId: 'learner', gender: 'Male' };
  let stats: Record<string, any> | undefined;
  let transaction: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    LPSCache.clear();
    stats = { schoolYear: year, totalLearners: 4, maleCount: 2, femaleCount: 2, fourPsCount: 2, ipCount: 2, snedCount: 0, aralCount: 0, muslimCount: 0, notTaggedCount: 2 };
    const ref = { path: 'publicStats/summary' };
    mocks.db.collection.mockReset().mockReturnValue({ doc: () => ref });
    transaction = {
      get: vi.fn(async () => ({ exists: Boolean(stats), data: () => stats })),
      set: vi.fn((_ref, update) => Object.assign(stats!, update)),
    };
    mocks.db.runTransaction.mockReset().mockImplementation(async action => action(transaction));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('preserves unique untagged counts when the same learners belong to several programs', async () => {
    LPSCache.write('firestore_public_stats', { stale: true }, 60_000);
    await fsUpdatePublicStatsForChange_(year, {}, {});

    expect(stats?.notTaggedCount).toBe(2);
    expect(stats?.totalLearners).toBe(4);
    expect(LPSCache.read('firestore_public_stats')).toBeNull();
  });

  it('changes the unique count only when a learner enters or leaves all program groups', async () => {
    const fourPs = { ...untagged, is4Ps: true };
    const overlapping = { ...fourPs, isIP: true };
    await fsUpdatePublicStatsForChange_(year, fourPs, overlapping);
    expect(stats?.notTaggedCount).toBe(2);
    expect(stats?.ipCount).toBe(3);

    await fsUpdatePublicStatsForChange_(year, overlapping, untagged);
    expect(stats?.notTaggedCount).toBe(3);
    expect(stats?.fourPsCount).toBe(1);
    expect(stats?.ipCount).toBe(2);

    await fsUpdatePublicStatsForChange_(year, untagged, { ...untagged, isMuslim: true });
    expect(stats?.notTaggedCount).toBe(2);
    expect(stats?.muslimCount).toBe(1);
  });

  it.each([
    ['add', undefined, untagged, 5, 3],
    ['delete', untagged, null, 3, 1],
    ['transfer out', untagged, { ...untagged, enrollmentStatus: 'TRANSFERRED_OUT' }, 3, 1],
    ['drop out', untagged, { ...untagged, eosyStatus: 'Dropped Out' }, 3, 1],
    ['restore', { ...untagged, transferOut: true }, untagged, 5, 3],
  ])('updates total and untagged counts on %s', async (_label, before, after, total, notTagged) => {
    await fsUpdatePublicStatsForChange_(year, before, after);
    expect(stats?.totalLearners).toBe(total);
    expect(stats?.notTaggedCount).toBe(notTagged);
  });

  it('does not treat absent or empty records as active learners', () => {
    expect(fsPublicActive_(undefined)).toBe(false);
    expect(fsPublicActive_(null)).toBe(false);
    expect(fsPublicActive_({})).toBe(false);
    expect(fsPublicActive_(untagged)).toBe(true);
  });

  it.each([-1, 20])('bounds an invalid stored untagged count of %s to enrollment', async storedCount => {
    stats!.notTaggedCount = storedCount;
    await fsUpdatePublicStatsForChange_(year, {}, {});
    expect(stats?.notTaggedCount).toBe(storedCount < 0 ? 0 : 4);
  });

  it('schedules a full recount when the unique count is missing instead of inferring it from overlapping totals', async () => {
    delete stats!.notTaggedCount;
    await fsUpdatePublicStatsForChange_(year, {}, {});
    expect(transaction.set.mock.calls[0][1]).not.toHaveProperty('notTaggedCount');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('leaves unavailable statistics and a different school year unchanged', async () => {
    await fsUpdatePublicStatsForChange_('2025-2026', untagged, null);
    expect(transaction.set).not.toHaveBeenCalled();
    stats = undefined;
    await fsUpdatePublicStatsForChange_(year, undefined, untagged);
    expect(transaction.set).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
