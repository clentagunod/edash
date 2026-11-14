import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const imageResponse = (content = 'logo', type = 'image/png') => ({
  ok: true, headers: new Headers(), blob: async () => new Blob([content], { type }),
});
class StoredResponse {
  headers: Headers;
  constructor(private body: Blob, init: { headers: Record<string, string> }) { this.headers = new Headers(init.headers); }
  async blob() { return this.body; }
  clone() { return new StoredResponse(this.body, { headers: Object.fromEntries(this.headers.entries()) }); }
}
function persistentStore() {
  const stored = new Map<string, StoredResponse>();
  const cache = {
    match: vi.fn(async (key: string) => stored.get(key)?.clone()),
    put: vi.fn(async (key: string, response: StoredResponse) => { stored.set(key, response.clone()); }),
    delete: vi.fn(async (key: string) => stored.delete(key)),
    keys: vi.fn(async () => [...stored.keys()]),
  };
  vi.stubGlobal('Response', StoredResponse);
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  return { cache, stored };
}

describe('public school logo caching', () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal('caches', undefined); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
  it('shares equivalent public logo paths and resolves them from the site root on nested routes', async () => {
    window.history.replaceState(null, '', '/parent/sample-school');
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    const sources = await Promise.all([
      'public/assets/school/logo.png', 'assets/school/logo.png', '/assets/school/logo.png', './public/assets/school/logo.png',
    ].map(cachedSchoolLogoSource));
    expect(sources[0]).toMatch(/^data:image/);
    expect(new Set(sources).size).toBe(1);
    expect(fetchLogo).toHaveBeenCalledTimes(1);
    expect(fetchLogo).toHaveBeenCalledWith(`${window.location.origin}/assets/school/logo.png`, expect.any(Object));
  });

  it('shares pending downloads and completed bytes between repeated logo requests', async () => {
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    const [first, second] = await Promise.all([cachedSchoolLogoSource('https://images.test/school.png'), cachedSchoolLogoSource('https://images.test/school.png')]);
    expect(first).toMatch(/^data:image\/png;base64,/); expect(second).toBe(first);
    expect(await cachedSchoolLogoSource('https://images.test/school.png')).toBe(first);
    expect(fetchLogo).toHaveBeenCalledTimes(1);
    expect(fetchLogo).toHaveBeenCalledWith('https://images.test/school.png', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });
  it('reuses persistent logo bytes after the module/page cache is recreated', async () => {
    const { cache } = persistentStore();
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const firstModule = await import('./school-logo-cache');
    const first = await firstModule.cachedSchoolLogoSource('https://images.test/school.png');
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    vi.resetModules();
    const nextModule = await import('./school-logo-cache');
    expect(await nextModule.cachedSchoolLogoSource('https://images.test/school.png')).toBe(first);
    expect(fetchLogo).toHaveBeenCalledTimes(1);
  });
  it('refreshes expired persistent entries and keys updated logos by their full URL', async () => {
    const { stored, cache } = persistentStore();
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse('new-logo')); vi.stubGlobal('fetch', fetchLogo);
    const module = await import('./school-logo-cache');
    const url = 'https://images.test/school.png?v=1';
    stored.set(url, new StoredResponse(new Blob(['old-logo'], { type: 'image/png' }), { headers: { 'X-Edash-Cached-At': String(Date.now() - module.SCHOOL_LOGO_CACHE_TTL_MS - 1) } }));
    await module.cachedSchoolLogoSource(url);
    expect(cache.delete).toHaveBeenCalledWith(url);
    await module.cachedSchoolLogoSource('https://images.test/school.png?v=2');
    expect(fetchLogo).toHaveBeenCalledTimes(2);
  });
  it('works when persistent storage is blocked or fails', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('Storage blocked')) });
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    const source = await cachedSchoolLogoSource('https://images.test/school.png');
    expect(source).toMatch(/^data:image/);
    expect(await cachedSchoolLogoSource('https://images.test/school.png')).toBe(source);
    expect(fetchLogo).toHaveBeenCalledTimes(1);
  });
  it('uses native image loading for CORS-restricted hosts without repeating failed fetches', async () => {
    const fetchLogo = vi.fn().mockRejectedValue(new TypeError('CORS')); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    const url = 'https://images.test/school.png';
    expect(await cachedSchoolLogoSource(url)).toBe(url);
    expect(await cachedSchoolLogoSource(url)).toBe(url);
    expect(fetchLogo).toHaveBeenCalledTimes(1);
  });
  it('invalidates corrupt images and delays retrying a broken logo', async () => {
    const { cache } = persistentStore();
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource, rejectCachedSchoolLogo } = await import('./school-logo-cache');
    const url = 'https://images.test/broken.png';
    await cachedSchoolLogoSource(url); await vi.waitFor(() => expect(cache.put).toHaveBeenCalled());
    rejectCachedSchoolLogo(url);
    expect(await cachedSchoolLogoSource(url)).toBeNull();
    await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledWith(url));
    expect(fetchLogo).toHaveBeenCalledTimes(1);
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    expect(await cachedSchoolLogoSource(url)).toMatch(/^data:image/);
    expect(fetchLogo).toHaveBeenCalledTimes(2);
  });
  it('bounds in-memory entries and evicts the least recently used logo', async () => {
    const fetchLogo = vi.fn().mockResolvedValue(imageResponse()); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    for (let index = 0; index < 64; index++) await cachedSchoolLogoSource(`https://images.test/${index}.png`);
    await cachedSchoolLogoSource('https://images.test/0.png');
    await cachedSchoolLogoSource('https://images.test/64.png');
    await cachedSchoolLogoSource('https://images.test/0.png'); expect(fetchLogo).toHaveBeenCalledTimes(65);
    await cachedSchoolLogoSource('https://images.test/1.png'); expect(fetchLogo).toHaveBeenCalledTimes(66);
  });
  it('does not fetch missing/unsafe URLs or recache inline image data', async () => {
    const fetchLogo = vi.fn(); vi.stubGlobal('fetch', fetchLogo);
    const { cachedSchoolLogoSource } = await import('./school-logo-cache');
    expect(await cachedSchoolLogoSource('')).toBeNull();
    expect(await cachedSchoolLogoSource('javascript:alert(1)')).toBeNull();
    expect(await cachedSchoolLogoSource('data:image/png;base64,bG9nbw==')).toBe('data:image/png;base64,bG9nbw==');
    expect(fetchLogo).not.toHaveBeenCalled();
  });
});
