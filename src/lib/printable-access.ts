import { appRole, normalizedAppRole } from './app-config';
import type { PrintableKind } from './printables';

/** One policy for navigation, search, and direct printable URLs. Unknown roles fail closed. */
export function canAccessPrintable(kind: PrintableKind, role = appRole()): boolean {
  const normalized = normalizedAppRole(role);
  return normalized === 'School Admin' || normalized === 'Registrar' || (normalized === 'Teacher' && kind === 'student-card');
}
