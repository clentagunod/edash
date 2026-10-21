import { describe, expect, it } from 'vitest';
import { buildEduAiContext } from './eduai-context';

describe('EduAI context', () => {
  it('includes aggregate summaries and student names without sending student records or marks', () => {
    const context = buildEduAiContext('School Admin', '2026-2027', [{
      firstName: 'Ari',
      lastName: 'Santos',
      learnerId: 'PRIVATE-ID',
      age: 12,
      guardian: 'Private guardian',
      contact: 'Private contact',
      math: '98',
      gradeLevel: 'Grade 6',
      section: 'A',
      gender: 'Female',
      is4Ps: true,
    }]);

    expect(context.learnerNames).toEqual(['Ari Santos']);
    expect(context.summary).toMatchObject({
      totalLearners: 1,
      byGradeLevel: [{ gradeLevel: 'Grade 6', count: 1 }],
      byGradeAndSection: [{ gradeLevel: 'Grade 6', section: 'A', count: 1 }],
      genderCounts: { male: 0, female: 1, otherOrUnspecified: 0 },
      programCounts: { fourPs: 1 },
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('PRIVATE-ID');
    expect(serialized).not.toContain('Private guardian');
    expect(serialized).not.toContain('Private contact');
    expect(serialized).not.toContain('"math"');
    expect(serialized).not.toContain('"age"');
  });

  it('limits names sent to Gemini while preserving the full count', () => {
    const learners = Array.from({ length: 160 }, (_, index) => ({ name: `Learner ${index + 1}` }));
    const context = buildEduAiContext('Registrar', '2026-2027', learners);

    expect(context.learnerNames).toHaveLength(150);
    expect(context.learnerNameCount).toBe(160);
    expect(context.summary.totalLearners).toBe(160);
  });

  it('rejects unsupported account roles', () => {
    expect(() => buildEduAiContext('Visitor', '2026-2027', [])).toThrow(
      'Your account role is not allowed to use EduAI.',
    );
  });
});