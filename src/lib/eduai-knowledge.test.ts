import { describe, expect, it } from 'vitest';
import { buildEduAiProductGuide } from './eduai-knowledge';

describe('EduAI product guidance', () => {
  it('returns grounded guidance relevant to a website workflow question', () => {
    const guide = buildEduAiProductGuide('How do I use the Masterlist to find a learner?', 'Registrar');
    expect(guide).toContain('Masterlist');
    expect(guide).toContain('search and filters');
  });

  it('does not supply School Admin console instructions to teachers', () => {
    const teacherGuide = buildEduAiProductGuide('How do I manage users in Admin Console?', 'Teacher');
    const adminGuide = buildEduAiProductGuide('How do I manage users in Admin Console?', 'School Admin');
    expect(teacherGuide).not.toContain('Manage Users');
    expect(adminGuide).toContain('Manage Users');
  });

  it('returns no unsupported workflow instructions when the question is unmatched', () => {
    expect(buildEduAiProductGuide('Tell me a joke about the weather', 'Teacher')).toBe('');
  });
});
