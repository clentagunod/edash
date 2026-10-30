import { describe, expect, it } from 'vitest';
import { normalizeCertificatePreferences, resolveCertificateTemplate, validateCertificatePreferences } from './certificate-preferences';

describe('certificate preference policy', () => {
  it('offers only the default Good Moral and both COE templates for a new school', () => {
    const value = normalizeCertificatePreferences();
    expect(value.templates['good-moral'].enabledTemplates).toEqual(['default']);
    expect(value.templates.enrollment.enabledTemplates).toEqual(['default', 'sres']);
    expect(value.templates.enrollment.defaultTemplate).toBe('default');
    expect(value.defaultPaperSize).toBe('a4');
  });

  it('recovers from malformed and retired stored settings without sharing mutable defaults', () => {
    const value = normalizeCertificatePreferences({ templates: { enrollment: { defaultTemplate: 'retired', enabledTemplates: ['retired'] } }, defaultPaperSize: '__proto__' });
    expect(value.templates.enrollment.enabledTemplates).toEqual(['default']);
    expect(value.templates.enrollment.defaultTemplate).toBe('default');
    expect(value.defaultPaperSize).toBe('a4');
    value.templates.enrollment.enabledTemplates.push('sres');
    expect(normalizeCertificatePreferences(null).templates.enrollment.enabledTemplates).toEqual(['default', 'sres']);
    expect(normalizeCertificatePreferences({ templates: { enrollment: { enabledTemplates: ['sres', 'sres'] } } }).templates.enrollment.enabledTemplates).toEqual(['sres']);
  });

  it('rejects empty sets, mismatched defaults, unsupported templates, duplicate IDs, and invalid options on save', () => {
    const preferences = normalizeCertificatePreferences();
    for (const enabledTemplates of [[], ['retired'], ['sres'], ['default', 'default']]) {
      expect(() => validateCertificatePreferences({ ...preferences, templates: { ...preferences.templates, enrollment: { ...preferences.templates.enrollment, enabledTemplates } } })).toThrow();
    }
    expect(() => validateCertificatePreferences({ ...preferences, defaultPaperSize: 'poster' })).toThrow();
    expect(() => validateCertificatePreferences({ ...preferences, showSealNotice: 'false' })).toThrow();
    expect(() => validateCertificatePreferences({ ...preferences, templates: { ...preferences.templates, 'good-moral': { ...preferences.templates['good-moral'], enabledTemplates: ['sres'], defaultTemplate: 'sres' } } })).toThrow();
  });

  it('honors disabled choices and fixed school defaults', () => {
    const value = normalizeCertificatePreferences();
    expect(resolveCertificateTemplate('enrollment', value, 'sres')).toBe('sres');
    value.templates.enrollment.allowTeacherTemplateChoice = false;
    expect(resolveCertificateTemplate('enrollment', value, 'sres')).toBe('default');
    value.templates.enrollment.defaultTemplate = 'sres';
    expect(resolveCertificateTemplate('enrollment', value, 'default')).toBe('sres');
    expect(resolveCertificateTemplate('good-moral', value, 'sres')).toBe('default');
  });
});
