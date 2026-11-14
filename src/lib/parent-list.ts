import { compareGradeLevelLabels } from './grade-level-order';

export interface ParentLearner {
  learnerId: string;
  guardian?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  name?: string;
  gradeLevel?: string;
  section?: string;
  contact?: string;
}

export interface ParentEntry {
  key: string;
  name: string;
  children: ParentLearner[];
}

export type ParentSort = 'name-asc' | 'name-desc' | 'children-desc' | 'children-asc';
export type ParentExportFormat = 'xlsx' | 'csv' | 'tsv';
export const parentText = (value: unknown) => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const keyFor = (value: unknown) => parentText(value).toLowerCase();
const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function hasGuardianName(value: unknown): boolean {
  return !['', 'n/a', 'n / a', 'na', 'none', 'null', 'undefined', 'not available', 'not applicable', '-', '—'].includes(keyFor(value));
}

export function parentLearnerName(learner: ParentLearner): string {
  const given = [learner.firstName, learner.middleName].map(parentText).filter(Boolean).join(' ');
  const name = [parentText(learner.lastName), given].filter(Boolean).join(', ');
  return [name || parentText(learner.name), parentText(learner.suffix)].filter(Boolean).join(' ') || learner.learnerId;
}

/** Input must come from the role-scoped learner store; never fetch siblings outside that scope. */
export function buildParentList(learners: ParentLearner[], filters: { grade?: string; section?: string } = {}): ParentEntry[] {
  const parents = new Map<string, ParentEntry>();
  for (const learner of learners) {
    if (!hasGuardianName(learner.guardian)
      || (filters.grade && keyFor(learner.gradeLevel) !== keyFor(filters.grade))
      || (filters.section && keyFor(learner.section) !== keyFor(filters.section))) continue;
    const key = keyFor(learner.guardian);
    if (!parents.has(key)) parents.set(key, { key, name: parentText(learner.guardian), children: [] });
    parents.get(key)!.children.push(learner);
  }
  return [...parents.values()].map(parent => ({
    ...parent,
    children: [...parent.children].sort((a, b) => compareNames(parentLearnerName(a), parentLearnerName(b)) || compareNames(a.learnerId, b.learnerId)),
  }));
}

export function sortParentList(parents: ParentEntry[], sort: ParentSort): ParentEntry[] {
  return [...parents].sort((a, b) => {
    const nameOrder = compareNames(a.name, b.name) || a.key.localeCompare(b.key);
    if (sort === 'name-desc') return -nameOrder;
    if (sort === 'children-desc') return b.children.length - a.children.length || nameOrder;
    if (sort === 'children-asc') return a.children.length - b.children.length || nameOrder;
    return nameOrder;
  });
}

export function parentGradeOptions(learners: ParentLearner[]): string[] {
  return [...new Set(learners.map(l => parentText(l.gradeLevel)).filter(Boolean))].sort(compareGradeLevelLabels);
}

/** One row per child keeps each grade, section, and contact paired with its learner. */
export function parentExportRows(parents: ParentEntry[], schoolYear: string): string[][] {
  return [
    ['Parent / Guardian', 'Learner Name', 'Learner ID', 'Grade Level', 'Section', 'Contact Number', 'School Year'],
    ...parents.flatMap(parent => parent.children.map(child => [
      parent.name, parentLearnerName(child), child.learnerId, parentText(child.gradeLevel),
      parentText(child.section), parentText(child.contact), schoolYear,
    ])),
  ];
}

// Quote fields and neutralize spreadsheet formulas in user-entered text.
export function parentDelimitedFile(rows: string[][], delimiter: ',' | '\t'): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text.trimStart()) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(delimiter)).join('\r\n');
}
