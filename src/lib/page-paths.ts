/** Canonical browser paths; persisted legacy page filenames remain compatible. */
export function canonicalPagePath(pathname: string): string {
  if (/^\/(?:index(?:\.html)?)?\/?$/i.test(pathname)) return '/';
  if (/^\/pages\/?$/i.test(pathname)) return '/pages/dashboard';
  const page = /^\/pages\/([a-z0-9-]+)(?:\.html)?\/?$/i.exec(pathname);
  if (page) return `/pages/${page[1]}`;
  const publicPage = /^\/(login|select-school|privacy-policy|register|parent)(?:\.html)?\/?$/i.exec(pathname);
  if (publicPage) return `/${publicPage[1]}`;
  const parent = /^\/parent\/([a-z0-9-]+)\/$/i.exec(pathname);
  return parent ? `/parent/${parent[1]}` : pathname;
}

/** Build a root-relative page URL, independently of the current route depth. */
export function appPagePath(fileName: string): string {
  const input = String(fileName || '').replace(/^(?:\.\/)?(?:\/)?(?:pages\/)?/, '');
  const match = /^([a-z0-9-]+)(?:\.html)?([?#].*)?$/i.exec(input);
  return match ? `/pages/${match[1]}${match[2] || ''}` : '/pages/dashboard';
}
