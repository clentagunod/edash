import { describe, expect, it } from 'vitest';
import { buildParentList, hasGuardianName, parentExportRows, parentGradeOptions, sortParentList, type ParentLearner } from './parent-list';

const learners: ParentLearner[] = [
  { learnerId: '001234567890', guardian: ' Ana  Cruz ', firstName: 'Ella', middleName: 'Reyes', lastName: 'Cruz', gradeLevel: 'Grade 2', section: 'Ruby', contact: '09123456789' },
  { learnerId: '001234567891', guardian: 'ANA CRUZ', firstName: 'Ben', lastName: 'Cruz', gradeLevel: 'Kinder', section: 'Amber' },
  { learnerId: '001234567892', guardian: 'Zoe Santos', firstName: 'Jo', lastName: 'Santos', gradeLevel: 'Grade 1', section: 'Ruby' },
  { learnerId: '001234567893', guardian: 'N/A', firstName: 'Sam' },
  { learnerId: '001234567894', guardian: '  ', firstName: 'Kim' },
];

describe('derived parent directory', () => {
  it('groups normalized guardian names, keeps all children, and excludes unavailable names', () => {
    const entries = buildParentList(learners);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('Ana Cruz');
    expect(entries[0].children.map(child => child.firstName)).toEqual(['Ben', 'Ella']);
    for (const name of ['', 'n/a', 'N / A', '—', 'Not Available', null, undefined]) expect(hasGuardianName(name)).toBe(false);
    expect(learners[0].guardian).toBe(' Ana  Cruz ');
  });

  it('filters children before grouping and never adds siblings absent from the scoped input', () => {
    expect(buildParentList(learners, { grade: 'Grade 2' })[0].children.map(child => child.firstName)).toEqual(['Ella']);
    expect(buildParentList(learners, { section: 'Ruby' })).toHaveLength(2);
    expect(buildParentList(learners, { grade: 'Kinder', section: 'Ruby' })).toEqual([]);
    expect(buildParentList([learners[0]])[0].children).toHaveLength(1);
    expect(parentGradeOptions(learners)).toEqual(['Kinder', 'Grade 1', 'Grade 2']);
  });

  it('sorts by names and number of linked learners with deterministic name ties', () => {
    const entries = buildParentList(learners);
    expect(sortParentList(entries, 'name-asc').map(p => p.name)).toEqual(['Ana Cruz', 'Zoe Santos']);
    expect(sortParentList(entries, 'name-desc').map(p => p.name)).toEqual(['Zoe Santos', 'Ana Cruz']);
    expect(sortParentList(entries, 'children-desc')[0].name).toBe('Ana Cruz');
    expect(sortParentList(entries, 'children-asc')[0].name).toBe('Zoe Santos');
    expect(entries[0].name).toBe('Ana Cruz');
  });

  it('numbers each parent once and keeps every learner detail on its own export row', () => {
    const rows = parentExportRows(buildParentList(learners), '2026-2027');
    expect(rows).toEqual([
      ['No.', 'Parent / Guardian', 'Learner Name', 'Learner ID', 'Grade Level', 'Section', 'Contact Number', 'School Year'],
      [1, 'Ana Cruz', 'Cruz, Ben', '001234567891', 'Kinder', 'Amber', 'N/A', '2026-2027'],
      ['', '', 'Cruz, Ella Reyes', '001234567890', 'Grade 2', 'Ruby', '09123456789', '2026-2027'],
      [2, 'Zoe Santos', 'Santos, Jo', '001234567892', 'Grade 1', 'Ruby', 'N/A', '2026-2027'],
    ]);
  });

  it('restarts export numbering for the selected order and filtered parent groups', () => {
    const parents = sortParentList(buildParentList(learners), 'name-desc');
    const rows = parentExportRows(parents, '2026-2027');
    expect(rows.slice(1).map(row => row.slice(0, 2))).toEqual([[1, 'Zoe Santos'], [2, 'Ana Cruz'], ['', '']]);
    const filtered = parentExportRows(buildParentList(learners, { grade: 'Grade 2' }), '2026-2027');
    expect(filtered.slice(1).map(row => row.slice(0, 2))).toEqual([[1, 'Ana Cruz']]);
    expect(parentExportRows([], '2026-2027')).toEqual([rows[0]]);
  });
});
