// Test the production bootstrap, since dev mode does not extract/preload CSS.
// Run after npm run build: node --test scripts/registration-styles.node.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';

const output = resolve('dist');
const html = readFileSync(resolve(output, 'index.html'), 'utf8');
const bootstrapPath = /<script\b[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
assert.ok(bootstrapPath, 'Production HTML must reference its bootstrap module');
const bootstrap = readFileSync(resolve(output, bootstrapPath.slice(1)), 'utf8')
  // Replace module loading with a recorder; test only bootstrap dependency choice.
  .replace(/\bimport\(/g, '__recordImport(')
  .replace(/export\s*\{[^}]*\}\s*;?/g, '');

async function runBootstrap(hostname, pathname) {
  const links = [];
  const imports = [];
  const context = {
    Promise, Event,
    __recordImport: async (path) => { imports.push(path); return {}; },
    window: { location: { hostname, pathname }, dispatchEvent: () => true },
    document: {
      createElement: () => ({ relList: { supports: () => true },
        setAttribute() {}, addEventListener(type, callback) { if (type === 'load') callback(); } }),
      getElementsByTagName: () => [], querySelector: () => null,
      head: { appendChild: (link) => links.push(link) },
    },
  };
  vm.runInNewContext(bootstrap, context);
  // Drain the async preload and import continuations.
  await new Promise((done) => setImmediate(done));
  const styles = links.filter((link) => link.rel === 'stylesheet');
  return { imports, styles, css: styles.map((link) => readFileSync(resolve(output, link.href.slice(1)), 'utf8')).join('\n') };
}

for (const [label, hostname, pathname] of [
  ['registration subdomain', 'register.edash.online', '/'],
  ['registration fallback route', 'www.edash.online', '/register'],
]) {
  test(`${label} loads its production layout stylesheet`, async () => {
    const result = await runBootstrap(hostname, pathname);
    assert.match(result.imports.join(' '), /registration-entry-/);
    assert.doesNotMatch(result.imports.join(' '), /application-entry-/);
    assert.match(result.css, /\.enrollment-layout\{display:grid/);
    assert.match(result.css, /\.enrollment-card\{/);
    assert.ok(result.styles.every((link) => !link.href.includes('application-entry-')),
      'Registration must not load the tenant application stylesheet');
  });
}

test('main school selection loads the application stylesheet', async () => {
  const result = await runBootstrap('www.edash.online', '/select-school');
  assert.match(result.imports.join(' '), /application-entry-/);
  assert.doesNotMatch(result.imports.join(' '), /registration-entry-/);
  assert.match(result.css, /\.school-selection-page/);
});
