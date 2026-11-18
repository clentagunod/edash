import { gradeForTerm } from './academic-grades';
import { gradeLevelConfigKey, normalizeGradeLevelGrading } from './grading-config';
import { CRLA_CATEGORIES, PHIL_IRI_CATEGORIES, RMA_CATEGORIES } from './profile-charts';

export type EditableProfileKind = 'grades' | 'reading' | 'math';
export interface ProfileValueEdit {
  kind: EditableProfileKind;
  field: string;
  value: string;
  previousValue: string;
  term?: string;
}

export function readingProfileInstrument(learner: Record<string, any>) {
  if (learner.bosyCRLA || learner.mosyCRLA || learner.eosyCRLA) return 'CRLA';
  if (learner.bosyPhilIRI || learner.mosyPhilIRI || learner.eosyPhilIRI) return 'Phil-IRI';
  return /^grade[123]$/.test(gradeLevelConfigKey(learner.gradeLevel))
    ? 'CRLA' : 'Phil-IRI';
}

export function profileStoredValue(learner: Record<string, any>, edit: ProfileValueEdit) {
  if (edit.kind !== 'grades') return String(learner[edit.field] ?? '').trim();
  return String(gradeForTerm(learner, edit.term, edit.field) ?? '').trim();
}

export function validateProfileValue(edit: ProfileValueEdit, learner: Record<string, any>, grading?: unknown) {
  const value = String(edit.value ?? '').trim();
  if (edit.kind === 'grades') {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(edit.field)) throw new Error('Choose a valid subject.');
    const config = normalizeGradeLevelGrading(grading);
    if (!value) return '';
    if (config.gradingType === 'letter') {
      const letter = config.letterScale.find(row => row.letter === value.toUpperCase());
      if (!letter) throw new Error('Choose a letter grade from the configured scale.');
      return letter.letter;
    }
    if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0 || Number(value) > 100) {
      throw new Error('Enter a numerical grade from 0 to 100, or clear the value.');
    }
    return String(Number(value));
  }
  const suffix = edit.kind === 'math' ? 'RMA' : readingProfileInstrument(learner) === 'CRLA' ? 'CRLA' : 'PhilIRI';
  if (!['bosy', 'mosy', 'eosy'].some(period => edit.field === `${period}${suffix}`)) {
    throw new Error('Choose a valid assessment field for this learner.');
  }
  const categories = suffix === 'RMA' ? RMA_CATEGORIES : suffix === 'CRLA' ? CRLA_CATEGORIES : PHIL_IRI_CATEGORIES;
  if (value && !categories.some(category => category.label === value)) throw new Error('Choose a valid assessment classification.');
  return value;
}
