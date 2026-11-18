import { describe, expect, it } from 'vitest';
import { profileStoredValue, readingProfileInstrument, validateProfileValue, type ProfileValueEdit } from './profile-editing';

const gradeEdit = (value: string, overrides: Partial<ProfileValueEdit> = {}): ProfileValueEdit => ({
  kind: 'grades', field: 'math', term: 'quarter2', value, previousValue: '', ...overrides,
});
const assessmentEdit = (kind: 'reading' | 'math', field: string, value: string): ProfileValueEdit => ({ kind, field, value, previousValue: '' });

describe('profile value validation', () => {
  it.each(['0', '75', '89.5', '100'])('accepts numerical grades including boundaries: %s', value => {
    expect(validateProfileValue(gradeEdit(value), {})).toBe(value);
  });

  it('normalizes padded numeric values and allows clearing a grade', () => {
    expect(validateProfileValue(gradeEdit(' 089.50 '), {})).toBe('89.5');
    expect(validateProfileValue(gradeEdit('  '), {})).toBe('');
  });

  it.each(['-1', '101', 'NaN', 'Infinity', '1e2', '90abc'])('rejects invalid or out-of-range grades: %s', value => {
    expect(() => validateProfileValue(gradeEdit(value), {})).toThrow('0 to 100');
  });

  it('validates custom letter scales rather than accepting arbitrary text', () => {
    const grading = { gradingType: 'letter', letterScale: [{ letter: 'P', min: 75, max: 100 }, { letter: 'F', min: 0, max: 74 }] };
    expect(validateProfileValue(gradeEdit(' p '), {}, grading)).toBe('P');
    expect(validateProfileValue(gradeEdit(''), {}, grading)).toBe('');
    expect(() => validateProfileValue(gradeEdit('A'), {}, grading)).toThrow('configured scale');
  });

  it('rejects field paths while accepting canonical custom subject identifiers', () => {
    expect(() => validateProfileValue(gradeEdit('90', { field: 'gradesByTerm.final.math' }), {})).toThrow('valid subject');
    expect(validateProfileValue(gradeEdit('90', { field: 'subjectRobotics' }), {})).toBe('90');
  });

  it('uses CRLA classifications and rejects switching a learner to a different instrument', () => {
    const learner = { gradeLevel: 'Grade 2' };
    expect(validateProfileValue(assessmentEdit('reading', 'mosyCRLA', 'Developing'), learner)).toBe('Developing');
    expect(() => validateProfileValue(assessmentEdit('reading', 'mosyCRLA', 'Independent'), learner)).toThrow('valid assessment classification');
    expect(() => validateProfileValue(assessmentEdit('reading', 'mosyPhilIRI', 'Independent'), learner)).toThrow('valid assessment field');
  });

  it('validates Phil-IRI and RMA classifications and allows clearing an assessment', () => {
    expect(validateProfileValue(assessmentEdit('reading', 'eosyPhilIRI', 'Instructional'), { gradeLevel: 'Grade 5' })).toBe('Instructional');
    expect(validateProfileValue(assessmentEdit('math', 'bosyRMA', 'Nearly-Proficient'), {})).toBe('Nearly-Proficient');
    expect(validateProfileValue(assessmentEdit('math', 'bosyRMA', ''), {})).toBe('');
    expect(() => validateProfileValue(assessmentEdit('math', 'gradeLevel', 'Grade 6'), {})).toThrow('valid assessment field');
    expect(() => validateProfileValue(assessmentEdit('math', 'eosyRMA', 'Low Emerging'), {})).toThrow('valid assessment classification');
  });
});

describe('profile stored values', () => {
  it('keeps term grades separate from final and legacy grades', () => {
    const learner = { math: '94', gradesByTerm: { quarter2: { math: '81' }, final: { math: '95' } } };
    expect(profileStoredValue(learner, gradeEdit(''))).toBe('81');
    expect(profileStoredValue(learner, gradeEdit('', { term: 'final' }))).toBe('95');
    expect(profileStoredValue(learner, gradeEdit('', { term: 'quarter1' }))).toBe('');
    expect(profileStoredValue({ math: '94' }, gradeEdit('', { term: 'final' }))).toBe('94');
    expect(profileStoredValue({ extra: { math: '93' } }, gradeEdit('', { term: 'final' }))).toBe('93');
  });

  it('preserves explicit blanks and compares zero grades correctly', () => {
    expect(profileStoredValue({ math: '94', gradesByTerm: { final: { math: '' } } }, gradeEdit('', { term: 'final' }))).toBe('');
    expect(profileStoredValue({ math: 0 }, gradeEdit('', { term: 'final' }))).toBe('0');
    expect(profileStoredValue({ bosyRMA: ' Proficient ' }, assessmentEdit('math', 'bosyRMA', ''))).toBe('Proficient');
  });

  it('chooses the appropriate instrument for blank profiles and preserves recorded instruments', () => {
    expect(readingProfileInstrument({ gradeLevel: 'Grade 1' })).toBe('CRLA');
    expect(readingProfileInstrument({ gradeLevel: 'Grade 3' })).toBe('CRLA');
    expect(readingProfileInstrument({ gradeLevel: 'Grade 4' })).toBe('Phil-IRI');
    expect(readingProfileInstrument({ gradeLevel: 'Grade 2', bosyPhilIRI: 'Instructional' })).toBe('Phil-IRI');
    expect(readingProfileInstrument({ gradeLevel: 'Grade 5', bosyCRLA: 'Developing' })).toBe('CRLA');
  });
});
