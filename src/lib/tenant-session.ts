import { clearVisitorSession } from './app-config';
import { LPSCache } from './cache';

export function clearTenantSession(): void {
  clearVisitorSession();
  LPSCache.clear();
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('lps_')) sessionStorage.removeItem(key);
  }
}
