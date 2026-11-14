const ASSET_ORIGIN = 'https://edash.invalid';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function safePath(path) {
  try {
    return path.split('/').every(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded !== '..' && !/[\\/]/.test(decoded) && !CONTROL_CHARACTERS.test(decoded);
    });
  } catch {
    return false;
  }
}

/** Resolve public-folder filenames and hosted HTTPS assets independently of the current route. */
export function normalizeAssetReference(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const input = value.trim();
  if (!input || CONTROL_CHARACTERS.test(input)) return null;

  if (/^https:\/\//i.test(input)) {
    if (input.includes('\\')) return null;
    try {
      if (!/^https:\/\/[^/?#]+/i.test(input)) return null;
      // Validate before URL resolves dot segments, including encoded traversal.
      const path = input.replace(/^https:\/\/[^/?#]*/i, '').split(/[?#]/, 1)[0];
      const url = new URL(input);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || !safePath(path)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  // A browser cannot load a file from an operator's disk or a network share.
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || /^[\\/]{2}/.test(input) || input.startsWith('\\')) return null;
  let reference = input.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (reference.startsWith('//')) return null;
  reference = reference.replace(/^\//, '').replace(/^public\//, '');
  const path = reference.split(/[?#]/, 1)[0];
  if (!path || path === 'public' || !safePath(path)) return null;
  try {
    const url = new URL(`/${reference}`, ASSET_ORIGIN);
    if (url.origin !== ASSET_ORIGIN || url.pathname === '/') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
