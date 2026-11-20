import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchesProfileSection, updateProfileSectionFilter } from './profile-section-filter';

const records = [
  { gradeLevel: 'Grade 1', section: ' Section 10 ' },
  { gradeLevel: '1', section: 'Section 2' },
  { gradeLevel: 'Grade 1', section: 'section 2' },
  { gradeLevel: 'Grade 2', section: 'Sampaguita' },
  { gradeLevel: 'Kindergarten', section: 'Kinder A' },
  { gradeLevel: 'Grade 1', section: '' },
  { gradeLevel: 'Grade 1' },
];

beforeEach(() => {
  document.body.innerHTML = '<select id="testGradeFilter"><option value="">All Grade Levels</option><option>Grade 1</option><option>Grade 2</option><option>Kinder</option></select><select id="testSectionFilter"><option value="">All Sections</option></select>';
});
afterEach(() => { document.body.innerHTML = ''; });

describe('profile section choices', () => {
  const grade = () => document.getElementById('testGradeFilter') as HTMLSelectElement;
  const section = () => document.getElementById('testSectionFilter') as HTMLSelectElement;
  const choices = () => [...section().options].map(option => option.value);

  it('deduplicates names, trims whitespace and sorts numbered sections naturally', () => {
    grade().value = 'Grade 1';
    updateProfileSectionFilter('test', records);
    expect(choices()).toEqual(['', 'Section 2', 'Section 10']);
    section().value = 'Section 2';
    expect(records.filter(record => matchesProfileSection(record, section().value))).toHaveLength(2);
    expect(matchesProfileSection({}, '')).toBe(true);
    expect(matchesProfileSection({}, 'Section 2')).toBe(false);
  });

  it('clears unavailable choices on grade and school-year changes, preserving valid selections', () => {
    updateProfileSectionFilter('test', records);
    section().value = 'Section 2';
    grade().value = 'Grade 1';
    expect(updateProfileSectionFilter('test', records)).toBe('Section 2');
    grade().value = 'Grade 2';
    expect(updateProfileSectionFilter('test', records)).toBe('');
    expect(choices()).toEqual(['', 'Sampaguita']);
    section().value = 'Sampaguita';
    expect(updateProfileSectionFilter('test', [{ gradeLevel: 'Grade 2', section: 'New section' }])).toBe('');
    expect(choices()).toEqual(['', 'New section']);
    updateProfileSectionFilter('test', []);
    expect(choices()).toEqual(['']);
  });

  it('handles grade aliases and preserves a selection when record capitalization changes', () => {
    grade().value = 'Kinder';
    updateProfileSectionFilter('test', records);
    expect(choices()).toEqual(['', 'Kinder A']);
    section().value = 'Kinder A';
    expect(updateProfileSectionFilter('test', [{ gradeLevel: 'kg', section: 'kinder a' }])).toBe('kinder a');
  });

  it('treats section names as text and keeps existing options and focus on unchanged renders', () => {
    const safeRecords = [{ section: '<img src=x onerror=alert(1)>' }];
    updateProfileSectionFilter('test', safeRecords);
    expect(section().querySelector('img')).toBeNull();
    expect(section().options[1].text).toBe(safeRecords[0].section);
    const option = section().options[1];
    section().focus();
    updateProfileSectionFilter('test', safeRecords);
    expect(section().options[1]).toBe(option);
    expect(document.activeElement).toBe(section());
    document.body.innerHTML = '';
    expect(updateProfileSectionFilter('missing', records)).toBe('');
  });
});
