// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

// The rewrite sources are regular expressions. Match the actual deployed
// expressions rather than a second maintained list of application routes.
function rewrite(pathname) {
  return config.rewrites.find(rule => new RegExp(`^${rule.source}$`).test(pathname));
}

describe('Vercel application routing', () => {
  it('uses clean URLs without rewriting to a redirecting HTML destination', () => {
    expect(config.cleanUrls).toBe(true);
    expect(config.trailingSlash).toBe(false);
    for (const rule of config.rewrites) {
      expect(rule.destination).toBe('/');
      expect(rewrite(rule.destination)).toBeUndefined();
      expect(config.redirects.some(redirect => redirect.source === rule.destination)).toBe(false);
    }
  });

  it('serves every concrete React page route on a direct request or refresh', () => {
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]);
    expect(paths.length).toBeGreaterThan(30);
    for (const path of paths) {
      if (path === '*' || path === '/' || path === '/index.html' || path.includes(':')) continue;
      const canonical = path.replace(/\.html$/, '');
      expect(rewrite(canonical), canonical).toBeDefined();
    }
    expect(rewrite('/register')).toBeDefined();
    expect(rewrite('/parent/sample-elementary')).toBeDefined();
    expect(rewrite(`/parent/${'a'.repeat(63)}`)).toBeDefined();
  });

  it.each([
    '/api', '/api/', '/api/school-registration', '/api/school-registration.mjs', '/api/missing',
    '/assets', '/assets/', '/assets/missing', '/assets/missing.js', '/assets/missing.css',
    '/assets/school/logo.png', '/assets/school/video.mp4', '/favicon.ico', '/robots.txt',
    '/missing.js', '/missing.css', '/missing.png', '/missing.mp4', '/src/main.tsx',
    '/pages/missing', '/pages/dashboard.js', '/pages/dashboard/nested', '/pages/dashboard.html',
    '/parent/missing/logo.png', '/parent/a', '/parent/UPPERCASE', `/parent/${'a'.repeat(64)}`,
    '/not-a-page', '/.well-known/missing', '/node_modules', '/src',
  ])('keeps API, missing files, and unknown directories out of the SPA: %s', path => {
    expect(rewrite(path)).toBeUndefined();
  });

  it('retains registration function and existing response-header policies', () => {
    expect(config.functions['api/school-registration.mjs'].maxDuration).toBe(30);
    expect(config.headers.some(rule => rule.has?.some(condition => condition.type === 'host' && condition.value === 'register.edash.online'))).toBe(true);
    expect(config.headers.some(rule => rule.source === '/assets/:path*.mp4')).toBe(true);
  });

  it('has permanent legacy redirects with canonical, extensionless destinations', () => {
    for (const source of ['/index.html', '/index', '/pages', '/parent.html', '/login.html', '/register.html']) {
      const rule = config.redirects.find(rule => rule.source === source);
      expect(rule, source).toBeDefined();
      expect(rule.permanent).toBe(true);
      expect(rule.destination).not.toContain('.html');
      expect(rule.destination).not.toContain('?');
      expect(rule.destination).not.toBe(source);
    }
    const legacyPage = config.redirects.find(rule => rule.destination === '/pages/:page');
    expect(legacyPage?.permanent).toBe(true);
    // Check the configured regex portion, including its escaped literal dot.
    const source = legacyPage.source.replace(':page', '');
    expect(new RegExp(`^${source}$`).test('/pages/dashboard.html')).toBe(true);
    expect(new RegExp(`^${source}$`).test('/pages/dashboardXhtml')).toBe(false);
    expect(new RegExp(`^${source}$`).test('/pages/dashboard')).toBe(false);
  });
});
