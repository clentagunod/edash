// Keep photo bytes across table renders and route changes within this tab.
// Data URLs also let separate <img> elements reuse the browser's decoded image.
const MAX_PHOTOS = 80;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const photos = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const imageRequests = new WeakMap<HTMLImageElement, string>();
let cacheBytes = 0;
let enabled = true;
let generation = 0;

function notifyCacheChange() {
  window.dispatchEvent(new Event('edash:photo-cache-change'));
}
export function profilePhotoCacheStats() {
  return { count: photos.size, bytes: cacheBytes, maxBytes: MAX_CACHE_BYTES, enabled };
}
export function clearProfilePhotoCache() {
  generation++;
  photos.clear();
  pending.clear();
  cacheBytes = 0;
  notifyCacheChange();
}
export function configureProfilePhotoCache(nextEnabled: boolean) {
  if (enabled === nextEnabled) return;
  enabled = nextEnabled;
  clearProfilePhotoCache();
}

function readPhoto(url: string) {
  const source = photos.get(url);
  if (source) {
    photos.delete(url);
    photos.set(url, source);
  }
  return source;
}

function rememberPhoto(url: string, source: string) {
  // Approximate UTF-16 string storage; avoid filling memory with large originals.
  const size = source.length * 2;
  if (size > MAX_CACHE_BYTES) return;
  while (photos.size >= MAX_PHOTOS || cacheBytes + size > MAX_CACHE_BYTES) {
    const oldest = photos.keys().next().value;
    const removed = photos.get(oldest)!;
    photos.delete(oldest);
    cacheBytes -= removed.length * 2;
  }
  photos.set(url, source);
  cacheBytes += size;
  notifyCacheChange();
}

function photoDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to cache profile photo.'));
    reader.onabort = () => reject(new Error('Profile photo caching was interrupted.'));
    reader.readAsDataURL(blob);
  });
}

/** Deduplicate downloads and retain successful photos using their complete URL. */
export function cachedProfilePhotoSource(url: string): Promise<string> {
  if (!enabled) return Promise.resolve(url);
  const cached = readPhoto(url);
  if (cached) return Promise.resolve(cached);
  const loading = pending.get(url);
  if (loading) return loading;

  const requestGeneration = generation;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        cache: 'force-cache', credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Unable to download profile photo.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Invalid profile photo response.');
      const source = await photoDataURL(blob);
      if (enabled && generation === requestGeneration) rememberPhoto(url, source);
      return source;
    } finally {
      clearTimeout(timeout);
    }
  })();
  pending.set(url, request);
  // Failures are retryable. Do not cache an unsuccessful response or URL fallback.
  const finished = () => { if (pending.get(url) === request) pending.delete(url); };
  void request.then(finished, finished);
  return request;
}

/** Fall back to normal image loading for hosts that do not permit CORS fetches. */
export function setCachedProfilePhotoSource(image: HTMLImageElement, url: string) {
  imageRequests.set(image, url);
  if (!enabled) { image.src = url; return; }
  image.addEventListener('error', () => {
    if (imageRequests.get(image) !== url) return;
    const source = photos.get(url);
    if (source) {
      photos.delete(url);
      cacheBytes -= source.length * 2;
      notifyCacheChange();
    }
  }, { once: true });
  const cached = readPhoto(url);
  if (cached) {
    image.src = cached;
    return;
  }
  void cachedProfilePhotoSource(url).then(
    (source) => { if (imageRequests.get(image) === url) image.src = source; },
    () => { if (imageRequests.get(image) === url) image.src = url; },
  );
}
