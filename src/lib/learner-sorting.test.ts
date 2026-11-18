import { describe, expect, it } from 'vitest';
import { compareLearnersBySurname, compareProfileLearners, formatLearnerNameSurnameFirst, formatProfileLearnerName } from './learner-sorting';

describe('profile name convention', () => {
  it('uses the surname, full first name, and middle initial', () => {
    expect(formatProfileLearnerName({ lastName: 'Dela Cruz', firstName: 'Juan Miguel', middleName: 'Santos' })).toBe('Dela Cruz, Juan Miguel S.');
  });
  it('preserves suffixes, compound middle initials, and accented names', () => {
    expect(formatProfileLearnerName({ lastName: 'Peña', firstName: 'José', middleName: 'Ángel Luis', suffix: 'Jr.' })).toBe('Peña Jr., José Á. L.');
  });
  it('omits missing middle names and placeholders without inventing initials', () => {
    for (const middleName of ['', 'N/A', 'None', '-']) expect(formatProfileLearnerName({ lastName: 'Abad', firstName: 'Ana', middleName })).toBe('Abad, Ana');
  });
  it('handles partial names and retains an unstructured name fallback', () => {
    expect(formatProfileLearnerName({ firstName: 'Ana' })).toBe('Ana');
    expect(formatProfileLearnerName({ lastName: 'Abad' })).toBe('Abad');
    expect(formatProfileLearnerName({ name: 'Maria Clara Dela Cruz' })).toBe('Maria Clara Dela Cruz');
    expect(formatProfileLearnerName({}, '—')).toBe('—');
  });
});

describe('profile list sorting', () => {
  const records = [
    { learnerId: '010', lastName: 'Zulu', firstName: 'Ana', gradeLevel: 'Grade 10', average: 90, section: 'Section 10' },
    { learnerId: '002', lastName: 'Abad', firstName: 'Ben', gradeLevel: 'Grade 2', average: '', section: 'Section 2' },
    { learnerId: '001', lastName: 'Abad', firstName: 'Ana', gradeLevel: 'Kinder', average: 80, section: 'Section 1' },
  ];
  const sortedIds = (field: string, direction = 'asc') => [...records].sort((a, b) => compareProfileLearners(a, b, field, direction)).map(record => record.learnerId);
  it('sorts surnames and given names in either direction', () => {
    expect(sortedIds('name')).toEqual(['001', '002', '010']);
    expect(sortedIds('name', 'desc')).toEqual(['010', '002', '001']);
  });
  it('orders Kinder then grade numbers naturally', () => {
    expect(sortedIds('gradeLevel')).toEqual(['001', '002', '010']);
    expect(sortedIds('gradeLevel', 'desc')).toEqual(['010', '002', '001']);
  });
  it('orders IDs and sections naturally', () => {
    expect(sortedIds('learnerId')).toEqual(['001', '002', '010']);
    expect(sortedIds('section')).toEqual(['001', '002', '010']);
  });
  it('keeps missing averages last in either direction', () => {
    expect(sortedIds('average')).toEqual(['001', '010', '002']);
    expect(sortedIds('average', 'desc')).toEqual(['010', '001', '002']);
  });
  it('resolves equal values consistently by surname and uses numeric zero', () => {
    const cohort = [{ lastName: 'Zulu', average: 0 }, { lastName: 'Abad', average: '0' }, { lastName: 'Alpha', average: null }];
    expect(cohort.sort((a,b) => compareProfileLearners(a,b,'average','desc')).map(record => record.lastName)).toEqual(['Abad', 'Zulu', 'Alpha']);
  });
});

describe('formatLearnerNameSurnameFirst', () => {
  it('formats as surname-first, given name, middle name', () => {
    expect(formatLearnerNameSurnameFirst({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz' }))
      .toBe('Dela Cruz, Juan Santos');
  });

  it('keeps suffix after the given names', () => {
    expect(formatLearnerNameSurnameFirst({ firstName: 'Jose', lastName: 'Rizal', suffix: 'Jr.' }))
      .toBe('Rizal, Jose, Jr.');
  });

  it('handles records with only a combined name field', () => {
    expect(formatLearnerNameSurnameFirst({ name: 'Maria Clara Santos' })).toBe('Maria Clara Santos');
  });

  it('uses the provided fallback when no name data exists', () => {
    expect(formatLearnerNameSurnameFirst({}, '—')).toBe('—');
  });
});

describe('compareLearnersBySurname (default alphabetical by surname)', () => {
  it('sorts by surname then given names', () => {
    const records = [
      { firstName: 'Juan', lastName: 'Dela Cruz' },
      { firstName: 'Ana', lastName: 'Abad' },
      { firstName: 'Luis', lastName: 'Abad' },
    ];
    const sorted = [...records].sort(compareLearnersBySurname);
    expect(sorted.map((record) => `${record.lastName}, ${record.firstName}`)).toEqual([
      'Abad, Ana',
      'Abad, Luis',
      'Dela Cruz, Juan',
    ]);
  });
});
