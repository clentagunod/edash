/** Route legacy page links while preserving the browser's section navigation. */
export function handlePageLinkClick(event: MouseEvent, navigate: (path: string) => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

  const current = new URL(window.location.href);
  const destination = new URL(anchor.href, current);
  if (destination.origin !== current.origin || !destination.pathname.startsWith('/pages/')) return;
  // React Router updates the URL but does not perform the browser's anchor scroll.
  if (destination.pathname === current.pathname && destination.search === current.search && destination.hash) return;

  event.preventDefault();
  navigate(`${destination.pathname}${destination.search}${destination.hash}`);
}
