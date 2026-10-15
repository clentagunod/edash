import { describe, expect, it } from 'vitest';
import { parentGradeProfiles } from './parent-grades';

describe('parent learner grade profiles', () => {
  it('shows configured grade terms and the manually entered final grade', () => {
    const profiles = parentGradeProfiles({
      gradesByTerm: {
        quarter1: { math: '85', eppTle: '91' },
        quarter2: { math: '88' },
        quarter3: { math: '92' },
        quarter4: { math: '96' },
      },
      math: '93',
    }, 3);

    expect(profiles.map(({ id }) => id)).toEqual(['quarter1', 'quarter2', 'quarter3', 'final']);
    expect(profiles[0].grades).toEqual([
      { id: 'math', label: 'Math', value: '85' },
      { id: 'eppTle', label: 'EPP/TLE', value: '91' },
    ]);
    expect(profiles[3].grades).toEqual([{ id: 'math', label: 'Math', value: '93' }]);
  });

  it('prefers explicitly stored final grades and includes custom subjects', () => {
    const profiles = parentGradeProfiles({
      gradesByTerm: {
        final: { math: '95', customSubject: '89' },
      },
      math: '90',
    }, 1);

    expect(profiles[1].grades).toEqual([
      { id: 'math', label: 'Math', value: '95' },
      { id: 'customSubject', label: 'Custom Subject', value: '89' },
    ]);
  });

  it('reports empty configured terms when no grades are available', () => {
    expect(parentGradeProfiles({}, 2).map(({ grades }) => grades)).toEqual([[], [], []]);
  });
});
