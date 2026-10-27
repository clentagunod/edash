import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const photoResponse = (content = 'photo') => ({
  ok: true, blob: async () => new Blob([content], { type: 'image/png' }),
});

describe('profile photo cache', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('downloads a repeated photo once, sharing pending and completed requests', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource, setCachedProfilePhotoSource } = await import('./profile-photo-cache');
    const url = 'https://images.test/avatar.jpg';
    const [first, second] = await Promise.all([cachedProfilePhotoSource(url), cachedProfilePhotoSource(url)]);
    expect(first).toMatch(/^data:image\/png;base64,/);
    expect(second).toBe(first);
    expect(await cachedProfilePhotoSource(url)).toBe(first);
    // Changing audit pages creates new image elements, which should use cached bytes immediately.
    const nextPageImage = document.createElement('img');
    setCachedProfilePhotoSource(nextPageImage, url);
    expect(nextPageImage.src).toBe(first);
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
    expect(fetchPhoto).toHaveBeenCalledWith(url, expect.objectContaining({ cache: 'force-cache', credentials: 'omit' }));
  });

  it('uses separate entries for a new uploaded photo and its full-size preview', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource } = await import('./profile-photo-cache');
    for (const url of ['thumbnail.jpg', 'full-size.jpg', 'replacement.jpg', 'full-size.jpg']) {
      await cachedProfilePhotoSource(`https://images.test/${url}`);
    }
    expect(fetchPhoto).toHaveBeenCalledTimes(3);
  });

  it('falls back to native image loading and retries after a failed download', async () => {
    const fetchPhoto = vi.fn().mockRejectedValueOnce(new Error('CORS')).mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource, setCachedProfilePhotoSource } = await import('./profile-photo-cache');
    const image = document.createElement('img');
    const url = 'https://images.test/photo.jpg';
    setCachedProfilePhotoSource(image, url);
    await vi.waitFor(() => expect(image.src).toBe(url));
    expect(await cachedProfilePhotoSource(url)).toMatch(/^data:image\/png;base64,/);
    expect(fetchPhoto).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used photo when the entry limit is reached', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource } = await import('./profile-photo-cache');
    for (let index = 0; index < 80; index++) await cachedProfilePhotoSource(`https://images.test/${index}.jpg`);
    await cachedProfilePhotoSource('https://images.test/0.jpg');
    await cachedProfilePhotoSource('https://images.test/80.jpg');
    await cachedProfilePhotoSource('https://images.test/0.jpg');
    expect(fetchPhoto).toHaveBeenCalledTimes(81);
    await cachedProfilePhotoSource('https://images.test/1.jpg');
    expect(fetchPhoto).toHaveBeenCalledTimes(82);
  });

  it('does not let an older download replace a newer photo on the same image', async () => {
    let finishOld: (value: unknown) => void;
    const fetchPhoto = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue(photoResponse('new'));
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource, setCachedProfilePhotoSource } = await import('./profile-photo-cache');
    const image = document.createElement('img');
    setCachedProfilePhotoSource(image, 'https://images.test/old.jpg');
    setCachedProfilePhotoSource(image, 'https://images.test/new.jpg');
    const latest = await cachedProfilePhotoSource('https://images.test/new.jpg');
    finishOld!(photoResponse('old'));
    await cachedProfilePhotoSource('https://images.test/old.jpg');
    expect(image.src).toBe(latest);
  });

  it('discards photos that the browser cannot display', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource, setCachedProfilePhotoSource } = await import('./profile-photo-cache');
    const url = 'https://images.test/broken.jpg';
    await cachedProfilePhotoSource(url);
    const image = document.createElement('img');
    setCachedProfilePhotoSource(image, url);
    image.dispatchEvent(new Event('error'));
    await cachedProfilePhotoSource(url);
    expect(fetchPhoto).toHaveBeenCalledTimes(2);
  });

  it('reports usage, clears stored photos, and supports disabling the cache', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(photoResponse());
    vi.stubGlobal('fetch', fetchPhoto);
    const { cachedProfilePhotoSource, clearProfilePhotoCache, configureProfilePhotoCache, profilePhotoCacheStats } = await import('./profile-photo-cache');
    await cachedProfilePhotoSource('https://images.test/photo.jpg');
    expect(profilePhotoCacheStats().count).toBe(1);
    expect(profilePhotoCacheStats().bytes).toBeGreaterThan(0);
    clearProfilePhotoCache();
    expect(profilePhotoCacheStats().count).toBe(0);
    configureProfilePhotoCache(false);
    expect(await cachedProfilePhotoSource('https://images.test/disabled.jpg')).toBe('https://images.test/disabled.jpg');
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
    configureProfilePhotoCache(true);
    await cachedProfilePhotoSource('https://images.test/photo.jpg');
    expect(fetchPhoto).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the cache when an old request completes after clearing', async () => {
    let finish: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const { cachedProfilePhotoSource, clearProfilePhotoCache, profilePhotoCacheStats } = await import('./profile-photo-cache');
    const loading = cachedProfilePhotoSource('https://images.test/slow.jpg');
    clearProfilePhotoCache();
    finish!(photoResponse());
    await loading;
    expect(profilePhotoCacheStats().count).toBe(0);
  });
});
