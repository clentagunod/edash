// Public school branding has a separate cache from private learner/profile photos.
export const SCHOOL_LOGO_CACHE_NAME = 'edash-school-logos-v1';
export const SCHOOL_LOGO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 64;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
const CACHED_AT_HEADER = 'X-Edash-Cached-At';
type LogoEntry = { source: string | null; bytes: number; expiresAt: number };
const memory = new Map<string, LogoEntry>();
const pending = new Map<string, Promise<string | null>>();
let memoryBytes = 0;
let storage: Promise<Cache | null> | undefined;
let storageWrites = Promise.resolve();

function logoUrl(value: string): string | null {
  if (!value?.trim()) return null;
  if (/^data:image\//i.test(value)) return value;
  try {
    const url = new URL(value, window.location.href);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function persistentCache() {
  if (!storage) storage = typeof caches === 'undefined' ? Promise.resolve(null)
    : caches.open(SCHOOL_LOGO_CACHE_NAME).catch(() => null);
  return storage;
}
function forget(url: string) {
  const previous = memory.get(url);
  if (previous) memoryBytes -= previous.bytes;
  memory.delete(url);
}
function remember(url: string, source: string | null, ttl = SCHOOL_LOGO_CACHE_TTL_MS) {
  forget(url);
  const bytes = (source?.length || 0) * 2;
  if (bytes > MAX_MEMORY_BYTES) return source;
  while (memory.size >= MAX_ENTRIES || memoryBytes + bytes > MAX_MEMORY_BYTES) forget(memory.keys().next().value!);
  memory.set(url, { source, bytes, expiresAt: Date.now() + ttl }); memoryBytes += bytes;
  return source;
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => reject(new Error('Logo could not be cached.'));
    reader.readAsDataURL(blob);
  });
}
function validImage(blob: Blob) { return blob.type.startsWith('image/') && blob.size > 0 && blob.size <= MAX_IMAGE_BYTES; }
function queueStorageWrite(action: (cache: Cache) => Promise<void>) {
  // Serialize puts/pruning to keep simultaneous logo loads within the entry limit.
  storageWrites = storageWrites.then(async () => { const cache = await persistentCache(); if (cache) await action(cache); }).catch(() => {});
}

/** Shares in-flight requests and cached bytes across searches, controls, and reloads. */
export function cachedSchoolLogoSource(value: string): Promise<string | null> {
  const url = logoUrl(value);
  if (!url || url.startsWith('data:')) return Promise.resolve(url);
  const cached = memory.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    memory.delete(url); memory.set(url, cached);
    return Promise.resolve(cached.source);
  }
  if (cached) forget(url);
  const existing = pending.get(url);
  if (existing) return existing;
  const request = (async () => {
    try {
      const cache = await persistentCache();
      const saved = await cache?.match(url);
      if (saved) {
        const savedAt = Number(saved.headers.get(CACHED_AT_HEADER));
        const age = Date.now() - savedAt;
        if (savedAt > 0 && age >= 0 && age < SCHOOL_LOGO_CACHE_TTL_MS) {
          const blob = await saved.blob();
          if (validImage(blob)) return remember(url, await dataUrl(blob), SCHOOL_LOGO_CACHE_TTL_MS - age);
        }
        await cache!.delete(url);
      }
    } catch { /* Storage may be blocked, full, or unavailable; normal loading still works. */ }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { cache: 'default', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error('Logo download failed.');
      const length = Number(response.headers.get('Content-Length'));
      if (length > MAX_IMAGE_BYTES) throw new Error('Logo is too large to cache.');
      const blob = await response.blob();
      if (!validImage(blob)) throw new Error('Logo response is not a cacheable image.');
      const source = await dataUrl(blob);
      remember(url, source);
      queueStorageWrite(async cache => {
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type, [CACHED_AT_HEADER]: String(Date.now()) } }));
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map(key => cache.delete(key)));
      });
      return source;
    } catch {
      // Some image hosts allow <img> but prohibit CORS fetch. Let the browser's
      // native HTTP image cache handle those URLs without repeating CORS attempts.
      return remember(url, url, 10 * 60 * 1000);
    } finally { clearTimeout(timeout); }
  })();
  pending.set(url, request);
  const finished = () => { if (pending.get(url) === request) pending.delete(url); };
  void request.then(finished, finished);
  return request;
}

/** A broken/corrupt image gets a short retry delay rather than repeated downloads. */
export function rejectCachedSchoolLogo(value: string) {
  const url = logoUrl(value);
  if (!url || url.startsWith('data:')) return;
  remember(url, null, 60_000);
  queueStorageWrite(async cache => { await cache.delete(url); });
}
