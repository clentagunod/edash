import type { StudentRecord } from './types';

export function downloadStudentJson(students: StudentRecord[], schoolId: string, schoolYear: string, filename = 'edash-students.json') {
  const blob = new Blob([JSON.stringify({ format: 'edash-students', version: 1, schoolId, schoolYear, students }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function studentTemplate(year: string, grade: string, section: string): StudentRecord[] {
  return [{
    learnerId: '123456789012', firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz',
    birthDate: '2014-06-15', gender: 'Male', gradeLevel: grade || 'Grade 6', section: section || 'YOUR SECTION',
    schoolYear: year, guardian: 'Maria Dela Cruz', contact: '09123456789',
    enrollmentStatus: 'ACTIVE', is4Ps: false, isIP: false, isSNED: false, isARAL: false, isMuslim: false,
  }];
}
