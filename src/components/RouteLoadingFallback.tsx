import { useEffect } from 'react';

/**
 * Route and authentication loading state. Auth/public routes use the
 * standalone state; authenticated page chunks load within the shared shell.
 */
export default function RouteLoadingFallback({ pageLoading = false }: { pageLoading?: boolean }) {
  useEffect(() => {
    if (!pageLoading) return;
    let active = true;
    import('../lib/shell')
      .then(({ renderShell }) => {
        if (active) renderShell('', 'Loading');
      })
      .catch((error: unknown) => {
        console.error('Could not render the application shell while loading a page:', error);
      });
    return () => {
      active = false;
    };
  }, [pageLoading]);

  if (pageLoading) {
    return (
      <div className="app-shell">
        <div id="sidebarMount" />
        <div className="main-area">
          <div id="topbarMount" />
          <main className="page app-route-loading" role="status" aria-live="polite" aria-label="Loading page">
            <span className="app-route-loading-spinner" aria-hidden="true" />
            <span>Loading page…</span>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      Loading...
    </div>
  );
}
