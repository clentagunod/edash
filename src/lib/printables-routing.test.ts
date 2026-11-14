import { describe, expect, it } from 'vitest';
import { PRINTABLES, printableWorkspaceHref, type PrintableKind } from './printables';

describe('printable workspace URLs', () => {
  it.each(Object.keys(PRINTABLES) as PrintableKind[])('opens %s with an extensionless absolute path and an encoded school year', kind => {
    const href = printableWorkspaceHref(kind, '2026/2027 & review');
    const url = new URL(href, 'https://school.example/parent/sample-school');
    expect(url.origin).toBe('https://school.example');
    expect(url.pathname).toMatch(/^\/pages\/print-[a-z0-9-]+$/);
    expect(url.searchParams.get('schoolYear')).toBe('2026/2027 & review');
    expect(href).not.toContain('.html');
  });

  it('does not append an empty query string when the school year is omitted', () => {
    expect(printableWorkspaceHref('student-card', '')).toBe('/pages/print-card');
  });
});
