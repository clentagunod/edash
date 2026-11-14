import { describe, expect, it } from 'vitest';
import { appPagePath, canonicalPagePath } from './page-paths';

describe('canonical application URLs', () => {
  it.each([
    ['dashboard.html', '/pages/dashboard'],
    ['/pages/masterlist.html', '/pages/masterlist'],
    ['pages/preferences', '/pages/preferences'],
    ['print-card.html?schoolYear=2026-2027#preview', '/pages/print-card?schoolYear=2026-2027#preview'],
    ['settings?view=privacy', '/pages/settings?view=privacy'],
  ])('builds an absolute, extensionless link from %s', (input, expected) => {
    expect(appPagePath(input)).toBe(expected);
  });
  it.each([
    ['/index.html', '/'], ['/index', '/'], ['/pages/', '/pages/dashboard'],
    ['/pages/dashboard.html', '/pages/dashboard'], ['/pages/preferences/', '/pages/preferences'],
    ['/register.html', '/register'], ['/parent.html', '/parent'], ['/parent/school-a/', '/parent/school-a'],
  ])('canonicalizes %s without redirect loops', (input, expected) => {
    expect(canonicalPagePath(input)).toBe(expected);
    expect(canonicalPagePath(expected)).toBe(expected);
  });
  it.each(['/api/school-registration', '/assets/school/logo.png', '/assets/video.mp4', '/other/file.html'])('preserves non-page resource paths: %s', path => {
    expect(canonicalPagePath(path)).toBe(path);
  });
  it.each(['//other.test/path', 'https://other.test', '../settings.html', 'javascript:alert(1)'])('does not build an external or directory link from %s', path => {
    expect(appPagePath(path)).toBe('/pages/dashboard');
  });
});
