import { describe, expect, it } from 'vitest';
import { compareLearnersBySurname, formatLearnerNameSurnameFirst } from './learner-sorting';

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