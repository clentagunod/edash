import { describe, expect, it } from 'vitest';
import { parentPortalPath, parentPortalUrl } from './parent-portal-links';

describe('school-specific parent portal links', () => {
  it('builds stable links from registry document IDs for any school', () => {
    expect(parentPortalPath('san-roque-es')).toBe('/parent/san-roque-es');
    expect(parentPortalUrl('128528', 'https://edash.example')).toBe('https://edash.example/parent/128528');
  });
  it.each(['', '../other', 'school/other', 'School A', 'https://other.test', 'a'.repeat(64)])('rejects invalid registry ID %s', (id) => {
    expect(() => parentPortalPath(id)).toThrow();
  });
});
