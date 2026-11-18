import { isSchoolAdmin, isTeacher, teacherAssignmentsForProfile } from '../app-config';
import { normalizeGrade } from './schema';

/** UI filtering only; the import store verifies the current server profile again. */
export function studentImportSections<T extends { gradeLevel: string; section: string }>(year: string, sections: T[]): T[] {
  if (isSchoolAdmin()) return sections;
  if (!isTeacher()) return [];
  const assignments = teacherAssignmentsForProfile().filter(assignment => assignment.schoolYear === year);
  return sections.filter(section => assignments.some(assignment =>
    normalizeGrade(assignment.gradeLevel) === normalizeGrade(section.gradeLevel) && assignment.section === section.section));
}
