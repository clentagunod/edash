import { isSchoolRegistryId } from './school-registry';

/** Use the registry document ID here; schoolInfo.id is for printed records. */
export function parentPortalPath(schoolId: string): string {
  if (!isSchoolRegistryId(schoolId)) throw new Error('A valid school registry ID is required.');
  return `/parent/${encodeURIComponent(schoolId)}`;
}

export function parentPortalUrl(schoolId: string, origin: string = window.location.origin): string {
  return new URL(parentPortalPath(schoolId), origin).href;
}

/** A full reload initializes Firebase with the newly selected tenant config. */
export function replaceWithParentPortal(schoolId: string): void {
  window.location.replace(parentPortalPath(schoolId));
}
