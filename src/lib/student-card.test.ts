import { describe, expect, it } from 'vitest';
import { isLetterGradedLevel } from './student-card';

describe('student card template availability', () => {
  it('identifies letter-graded levels by their normalized grade key', () => {
    const configurations = {
      kinder: { gradingType: 'letter' },
      grade3: { gradingType: 'letter' },
      grade4: { gradingType: 'numerical' },
    };

    expect(isLetterGradedLevel('Kinder', configurations)).toBe(true);
    expect(isLetterGradedLevel('Kindergarten', configurations)).toBe(true);
    expect(isLetterGradedLevel('Grade 3', configurations)).toBe(true);
    expect(isLetterGradedLevel('Grade 4', configurations)).toBe(false);
  });

  it('treats unconfigured grade levels as numerical', () => {
    expect(isLetterGradedLevel('Grade 5', {})).toBe(false);
  });
});