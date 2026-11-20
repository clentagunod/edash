import { describe, expect, it } from 'vitest';
import { matchSf2Rows, type AttendanceTarget, type Sf2Report } from './sf2';

const junior: AttendanceTarget = {
  learnerId: '000000000001', firstName: 'Ben', middleName: 'Reyes', lastName: 'Santos', suffix: 'Jr.',
  gradeLevel: 'Grade 2', section: 'MELON',
};

function report(...names: string[]): Sf2Report {
  return {
    month: 'Oct', errors: [], warnings: [],
    rows: names.map((sourceName, index) => ({ rowNumber: 13 + index, sourceName, daysPresent: '21.5', daysAbsent: '0.5', classDays: '22' })),
  };
}

function matched(sourceName: string, learner = junior) {
  const review = matchSf2Rows(report(sourceName), [learner]);
  expect(review.errors).toEqual([]);
  expect(review.entries.map(entry => entry.learnerId)).toEqual([learner.learnerId]);
}

describe('SF2 suffix matching', () => {
  it.each([
    'SANTOS JR., BEN REYES',
    'SANTOS, BEN JR. REYES',
    'SANTOS, BEN REYES JR.',
    'SANTOS, BEN, JR., REYES',
    'SANTOS, BEN, REYES, JR.',
    'BEN REYES SANTOS JR.',
    'BEN JR. REYES SANTOS',
    'BEN REYES JR. SANTOS',
  ])('matches JR when placed in %s', sourceName => {
    matched(sourceName);
  });

  it.each(['JR', 'J.R.', '(J.R.)', 'Junior', 'Jnr'])('recognizes the equivalent suffix %s in the worksheet', suffix => {
    matched(`SANTOS, BEN REYES ${suffix}`);
  });

  it.each(['JR', 'J.R.', '(J.R.)', 'Junior', 'Jnr'])('recognizes the equivalent stored suffix %s', suffix => {
    matched('SANTOS, BEN JR. REYES', { ...junior, suffix });
  });

  it.each([
    { firstName: 'Ben Jr.', suffix: '' },
    { firstName: 'Ben Junior', suffix: '' },
    { lastName: 'Santos Jr.', suffix: '' },
    { middleName: 'Reyes Jr.', suffix: '' },
    { firstName: 'Ben Jr.', suffix: 'Junior' },
    { lastName: 'Santos J.R.', suffix: 'Jr.' },
    { firstName: 'Ben Jr.', middleName: 'Reyes Jr.', lastName: 'Santos Jr.', suffix: 'Jr.' },
  ])('finds an embedded suffix without changing the stored name (%j)', fields => {
    const learner = { ...junior, ...fields };
    const before = JSON.stringify(learner);
    matched('SANTOS, BEN REYES JR.', learner);
    expect(JSON.stringify(learner)).toBe(before);
  });

  it.each([
    'Santos Jr., Ben Reyes',
    'Santos, Ben Jr., Reyes',
    'Ben Reyes Santos Jr.',
    'Ben Jr. Reyes Santos',
  ])('supports legacy full-name-only records: %s', name => {
    const learner: AttendanceTarget = { learnerId: junior.learnerId, gradeLevel: junior.gradeLevel, section: junior.section, name };
    matched('SANTOS, BEN REYES JR.', learner);
  });

  it.each(['Senior', 'Snr', 'S.R.'])('supports the corresponding senior suffix form %s', suffix => {
    matched(`SANTOS, BEN REYES ${suffix}`, { ...junior, suffix: 'Sr.' });
  });

  it('keeps a father and junior with otherwise identical names distinct', () => {
    const father = { ...junior, learnerId: '000000000002', suffix: '' };
    const review = matchSf2Rows(report('SANTOS, BEN REYES', 'SANTOS, BEN REYES JR.'), [father, junior]);
    expect(review.errors).toEqual([]);
    expect(review.entries.map(entry => entry.learnerId)).toEqual([father.learnerId, junior.learnerId]);
    expect(matchSf2Rows(report('SANTOS, BEN REYES'), [junior]).errors.join(' ')).toContain('no matching learner');
  });

  it('rejects a conflicting stored suffix and a different worksheet suffix', () => {
    const conflict = { ...junior, firstName: 'Ben Sr.' };
    expect(matchSf2Rows(report('SANTOS, BEN REYES JR.'), [conflict]).errors.join(' ')).toContain('no matching learner');
    expect(matchSf2Rows(report('SANTOS, BEN REYES SR.'), [junior]).errors.join(' ')).toContain('no matching learner');
  });

  it('continues blocking ambiguous identities, repeated rows and spelling differences', () => {
    const duplicate = { ...junior, learnerId: '000000000002', suffix: 'Junior' };
    expect(matchSf2Rows(report('SANTOS, BEN REYES JR.'), [junior, duplicate]).errors.join(' ')).toContain('ambiguous match');
    expect(matchSf2Rows(report('SANTOS JR., BEN REYES', 'SANTOS, BEN JR. REYES'), [junior]).errors.join(' ')).toContain('occurs more than once');
    expect(matchSf2Rows(report('SANTOS, BENN REYES JR.'), [junior]).errors.join(' ')).toContain('no matching learner');
  });

  it('retains Junior when it is the complete given name rather than a suffix', () => {
    matched('CRUZ, JUNIOR SANTOS', { ...junior, firstName: 'Junior', middleName: 'Santos', lastName: 'Cruz', suffix: '' });
  });

  it('preserves a fully spelled source middle name instead of reducing it to an initial', () => {
    const other = { ...junior, middleName: 'Raul' };
    expect(matchSf2Rows(report('SANTOS, BEN, REYES, JR.'), [other]).errors.join(' ')).toContain('no matching learner');
    matched('SANTOS, BEN, REYES, JR.');
    matched('SANTOS, BEN, R., JR.', other);
  });

  it('only matches a worksheet middle initial when it identifies one learner', () => {
    const other = { ...junior, learnerId: '000000000002', middleName: 'Raul' };
    expect(matchSf2Rows(report('SANTOS, BEN, R., JR.'), [junior, other]).errors.join(' ')).toContain('ambiguous match');
    const exact = matchSf2Rows(report('SANTOS, BEN, REYES, JR.'), [junior, other]);
    expect(exact.errors).toEqual([]);
    expect(exact.entries[0].learnerId).toBe(junior.learnerId);
  });
});
