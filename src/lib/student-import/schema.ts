import { CURRICULUM_SUBJECTS } from '../curriculum-subjects';

export const headerKey = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const cleanText = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export const nameCase = (value: unknown) => cleanText(value).toLowerCase().replace(/(^|[\s.'-])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase());
export const GUARDIAN_CONTACT_FIELDS = ['guardian', 'contact'] as const;
export function isUnavailableContact(value: unknown): boolean {
  const text = cleanText(value);
  return !text || /^(?:n\s*\/?\s*a|none|null|not\s+(?:available|applicable)|[-–—])$/i.test(text);
}

const ALIASES: Record<string, string[]> = {
  learnerId: ['lrn', 'learner reference number', 'learner id', 'student id', 'student lrn'],
  firstName: ['first name', 'given name', 'given names'],
  middleName: ['middle name', 'middle initial'],
  lastName: ['last name', 'surname', 'family name'],
  suffix: ['name extension', 'extension name', 'suffix'],
  name: ['name', 'full name', 'student name', 'learner name', 'name of learner', 'name of student', 'name last name first name middle name'],
  birthDate: ['birth date', 'birthdate', 'date of birth', 'dob', 'birth date mm dd yyyy', 'birth date dd mm yyyy'],
  age: ['age', 'age as of 1st friday june'],
  gender: ['sex', 'gender', 'sex m f'],
  gradeLevel: ['grade', 'grade level', 'year level'],
  section: ['section', 'section name'],
  schoolYear: ['school year', 'academic year', 'sy'],
  guardian: ['guardian', 'guardian name', 'parent guardian', 'parent guardian name', 'parent name', 'guardian if not parent name'],
  contact: ['contact', 'contact number', 'phone', 'phone number', 'mobile number', 'contact number of parent or guardian'],
  is4Ps: ['4ps', '4ps beneficiary', 'is 4ps'],
  isIP: ['ip', 'ip ethnic group', 'indigenous peoples', 'ip learner'],
  isSNED: ['sned', 'sned learner', 'sped'],
  isARAL: ['aral', 'aral tagged'],
  isMuslim: ['muslim learner', 'is muslim'],
  enrollmentStatus: ['enrollment status', 'enrolment status'],
  eosyStatus: ['eosy status', 'end of school year status'],
};

export const BOOLEAN_FIELDS = new Set(['is4Ps', 'isIP', 'isSNED', 'isARAL', 'isMuslim']);
export const NUMERIC_FIELDS = new Set(['age', ...CURRICULUM_SUBJECTS.map(subject => subject.id)]);
export const NAME_FIELDS = new Set(['firstName', 'lastName', 'middleName', 'name', 'guardian']);
export const ENUM_FIELDS: Record<string, string[]> = {
  gender: ['Male', 'Female'],
  enrollmentStatus: ['ACTIVE'],
  eosyStatus: ['Promoted', 'Retained'],
};
for (const phase of ['bosy', 'mosy', 'eosy']) {
  for (const measure of ['Height', 'Weight']) NUMERIC_FIELDS.add(`${phase}${measure}`);
  ENUM_FIELDS[`${phase}NutritionalStatus`] = ['Normal', 'Severely Wasted', 'Wasted', 'Overweight', 'Obese'];
  ENUM_FIELDS[`${phase}CRLA`] = ['Low Emerging', 'High Emerging', 'Developing', 'Transitioning', 'Grade Ready'];
  ENUM_FIELDS[`${phase}PhilIRI`] = ['Independent', 'Instructional', 'Frustration', 'Non reader'];
  ENUM_FIELDS[`${phase}RMA`] = ['Not Proficient', 'Low Proficient', 'Nearly-Proficient', 'Proficient', 'Highly-Proficient'];
}

export const IMPORT_FIELDS = new Set([
  ...Object.keys(ALIASES), ...NUMERIC_FIELDS, ...Object.keys(ENUM_FIELDS),
]);
const fieldByHeader = new Map<string, string>();
for (const field of IMPORT_FIELDS) {
  fieldByHeader.set(headerKey(field), field);
  for (const alias of ALIASES[field] || []) fieldByHeader.set(headerKey(alias), field);
}
for (const subject of CURRICULUM_SUBJECTS) {
  // SF1's Mother Tongue describes a language, whereas this app's field is a grade.
  // Match that field only by its canonical JSON key, not the SF1 language header.
  if (subject.id !== 'motherTongue') fieldByHeader.set(headerKey(subject.label), subject.id);
}

/** Whole normalized aliases avoid unsafe matches such as Father's Name -> learner name. */
export function matchHeader(value: unknown): string | undefined {
  const exact = fieldByHeader.get(headerKey(value));
  if (exact) return exact;
  // Ignore explanatory units/date-format notes, while retaining parent context.
  const withoutNotes = String(value ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const field = fieldByHeader.get(headerKey(withoutNotes));
  // Mother Tongue in SF1 is a language, not an academic subject mark.
  return field === 'motherTongue' ? undefined : field;
}

export function normalizeGrade(value: unknown): string {
  const key = headerKey(value);
  if (['kinder', 'kindergarten', 'kg', '0'].includes(key)) return 'Kinder';
  const match = key.match(/^(?:grade|g)?([1-6])$/);
  return match ? `Grade ${match[1]}` : '';
}
