import { normalizeCurriculumGrade } from './curriculum-subjects';

type SectionRecord = { gradeLevel?: unknown; section?: unknown };

const sectionText = (value: unknown) => String(value ?? '').trim();
const sectionKey = (value: unknown) => sectionText(value).toLowerCase();

/** Build section choices from the loaded school year's complete, authorized list. */
export function updateProfileSectionFilter(prefix: string, records: SectionRecord[]): string {
  const select = document.getElementById(`${prefix}SectionFilter`) as HTMLSelectElement | null;
  if (!select) return '';
  const grade = normalizeCurriculumGrade((document.getElementById(`${prefix}GradeFilter`) as HTMLSelectElement | null)?.value);
  const current = sectionKey(select.value);
  const sections = new Map<string, string>();
  for (const record of records) {
    if (grade && normalizeCurriculumGrade(record?.gradeLevel) !== grade) continue;
    const section = sectionText(record?.section);
    if (section && !sections.has(sectionKey(section))) sections.set(sectionKey(section), section);
  }
  const values = [...sections.values()].sort((first, second) => first.localeCompare(second, undefined, { numeric: true, sensitivity: 'base' }));
  const selection = sections.get(current) ?? '';
  // Keep the select node (and keyboard focus) while updating only changed choices.
  if (select.options.length !== values.length + 1 || values.some((value, index) => select.options[index + 1]?.value !== value)) {
    select.replaceChildren(new Option('All Sections', ''), ...values.map(value => new Option(value, value)));
  }
  select.value = selection;
  return selection;
}

export function matchesProfileSection(record: SectionRecord, section: string): boolean {
  return !section || sectionKey(record?.section) === sectionKey(section);
}
