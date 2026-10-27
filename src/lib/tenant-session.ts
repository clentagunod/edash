import { clearVisitorSession } from './app-config';
import { LPSCache } from './cache';
import { clearProfilePhotoCache } from './profile-photo-cache';

export function clearTenantSession(): void {
  clearVisitorSession();
  LPSCache.clear();
  clearProfilePhotoCache();
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('lps_')) sessionStorage.removeItem(key);
  }
}
