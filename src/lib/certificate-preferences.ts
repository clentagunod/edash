import type { CertificateKind } from './printables';
import { PAPER_SIZES, type PaperOrientation, type PaperSizeId } from './student-card-layout';

export const CERTIFICATE_PREFERENCES_DOCUMENT = 'certificatePreferences';
export type CertificateTemplateId = 'default' | 'sres';
export const CERTIFICATE_KINDS: CertificateKind[] = ['good-moral', 'enrollment'];
export const CERTIFICATE_TEMPLATES: Record<CertificateKind, ReadonlyArray<{
  id: CertificateTemplateId; name: string; description: string;
}>> = {
  'good-moral': [{ id: 'default', name: 'Default Good Moral', description: 'Department of Education letterhead, verified conduct, and school contact footer.' }],
  enrollment: [
    { id: 'default', name: 'Default COE', description: 'Department of Education letterhead with the full logo and contact footer.' },
    { id: 'sres', name: 'SRES COE', description: 'Based on CERTIFICATE OF ENROLLMENT_SRES.docx, with a school logo, school ID, email, and motto footer.' },
  ],
};

export interface CertificateTemplatePreference {
  defaultTemplate: CertificateTemplateId;
  enabledTemplates: CertificateTemplateId[];
  allowTeacherTemplateChoice: boolean;
}
export interface CertificatePreferences {
  version: 1;
  templates: Record<CertificateKind, CertificateTemplatePreference>;
  defaultPaperSize: PaperSizeId;
  defaultOrientation: PaperOrientation;
  allowSchoolDetailsOverride: boolean;
  showSealNotice: boolean;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Missing or retired template IDs never leave a studio without a valid layout. */
export function normalizeCertificatePreferences(input?: unknown): CertificatePreferences {
  const value = object(input);
  const configured = object(value.templates);
  const templates = {} as CertificatePreferences['templates'];
  for (const kind of CERTIFICATE_KINDS) {
    const config = object(configured[kind]);
    const available = CERTIFICATE_TEMPLATES[kind].map(({ id }) => id);
    const enabled = Array.isArray(config.enabledTemplates)
      ? available.filter((id) => (config.enabledTemplates as unknown[]).includes(id)) : available;
    const enabledTemplates = enabled.length ? enabled : ['default'] as CertificateTemplateId[];
    templates[kind] = {
      enabledTemplates,
      defaultTemplate: enabledTemplates.includes(config.defaultTemplate as CertificateTemplateId) ? config.defaultTemplate as CertificateTemplateId : enabledTemplates[0],
      allowTeacherTemplateChoice: typeof config.allowTeacherTemplateChoice === 'boolean' ? config.allowTeacherTemplateChoice : true,
    };
  }
  return {
    version: 1, templates,
    defaultPaperSize: Object.prototype.hasOwnProperty.call(PAPER_SIZES, value.defaultPaperSize) ? value.defaultPaperSize as PaperSizeId : 'a4',
    defaultOrientation: value.defaultOrientation === 'landscape' ? 'landscape' : 'portrait',
    allowSchoolDetailsOverride: typeof value.allowSchoolDetailsOverride === 'boolean' ? value.allowSchoolDetailsOverride : true,
    showSealNotice: typeof value.showSealNotice === 'boolean' ? value.showSealNotice : true,
  };
}

/** Writes are strict so invalid form data cannot silently replace school policy. */
export function validateCertificatePreferences(input: unknown): CertificatePreferences {
  const value = object(input);
  const templates = object(value.templates);
  for (const kind of CERTIFICATE_KINDS) {
    const config = object(templates[kind]);
    const ids = CERTIFICATE_TEMPLATES[kind].map(({ id }) => id);
    if (!Array.isArray(config.enabledTemplates) || !config.enabledTemplates.length ||
      config.enabledTemplates.some((id) => !ids.includes(id)) ||
      new Set(config.enabledTemplates).size !== config.enabledTemplates.length ||
      !config.enabledTemplates.includes(config.defaultTemplate) || typeof config.allowTeacherTemplateChoice !== 'boolean') {
      throw new Error('Enable at least one valid template and choose an enabled default for each certificate.');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(PAPER_SIZES, value.defaultPaperSize) ||
    !['portrait', 'landscape'].includes(String(value.defaultOrientation)) ||
    typeof value.allowSchoolDetailsOverride !== 'boolean' || typeof value.showSealNotice !== 'boolean') {
    throw new Error('Choose valid certificate layout and editing preferences.');
  }
  return normalizeCertificatePreferences(value);
}

export function resolveCertificateTemplate(kind: CertificateKind, preferences: CertificatePreferences, requested?: CertificateTemplateId): CertificateTemplateId {
  const config = preferences.templates[kind];
  return config.allowTeacherTemplateChoice && requested && config.enabledTemplates.includes(requested) ? requested : config.defaultTemplate;
}
