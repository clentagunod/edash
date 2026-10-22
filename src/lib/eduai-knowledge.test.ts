import { describe, expect, it } from 'vitest';
import { buildEduAiProductGuide } from './eduai-knowledge';

describe('EduAI product guidance', () => {
  it('returns grounded guidance relevant to a website workflow question', () => {
    const guide = buildEduAiProductGuide('How do I use the Masterlist to find a learner?', 'Registrar');
    expect(guide).toContain('Masterlist');
    expect(guide).toContain('search and filters');
  });

  it('explains the sidebar hierarchy and routes from Dashboard through Feedback', () => {
    const guide = buildEduAiProductGuide('Show me all dashboard to feedback navigation menu components', 'Registrar');
    expect(guide).toContain('Dashboard — /pages/dashboard.html');
    expect(guide).toContain('Programs');
    expect(guide).toContain('Nutrition');
    expect(guide).toContain('Statistics');
    expect(guide).toContain('Profiles');
    expect(guide).toContain('Movement');
    expect(guide).toContain('Utilities');
    expect(guide).toContain('Trash — /pages/trash.html');
    expect(guide).toContain('Feedback — /pages/feedback.html');
  });

  it('describes the Utilities landing page tools and distinguishes its sibling links', () => {
    const guide = buildEduAiProductGuide('What components and tools are on the Utilities page?', 'Teacher');
    expect(guide).toContain('Utilities landing page /pages/utilities.html');
    expect(guide).toContain('Grade Calculator');
    expect(guide).toContain('excludes empty subjects');
    expect(guide).toContain('BMI Calculator');
    expect(guide).toContain('age- and sex-specific percentile interpretation');
    expect(guide).toContain('Data is a separate export workspace');
    expect(guide).toContain('EduAI is a separate AI assistant page');
  });

  it('returns every registered authenticated page route for a complete route query', () => {
    const guide = buildEduAiProductGuide('List every authenticated app route path from the complete route directory', 'Registrar');
    [
      'dashboard', 'masterlist', 'program-4ps', 'program-ip', 'program-sned', 'program-aral', 'program-muslim',
      'enrollment-data', 'data', 'reports', 'eosy-report', 'grades-profile', 'print-card', 'reading-profile',
      'math-profile', 'nutritional-status', 'transfer-info', 'dropout', 'promotion', 'retention', 'audit-log',
      'feedback', 'trash', 'utilities', 'bmi-calculator', 'grade-calculator', 'settings', 'preferences',
      'manage-users', 'eduai',
    ].forEach((route) => expect(guide).toContain(`/pages/${route}.html`));
  });

  it('explains global search shortcuts and navigation to indexed components', () => {
    const guide = buildEduAiProductGuide('How do I use global search Ctrl K to jump to a page component?', 'Teacher');
    expect(guide).toContain('Ctrl+K');
    expect(guide).toContain('jump to the indexed component');
  });

  it('describes the Feedback page form and its route', () => {
    const guide = buildEduAiProductGuide('Where can I send feedback and how does the rating form work?', 'Teacher');
    expect(guide).toContain('/pages/feedback.html');
    expect(guide).toContain('1=Poor to 5=Excellent');
    expect(guide).toContain('Submit feedback');
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
