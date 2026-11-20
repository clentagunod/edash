import { APP_CONFIG, isRegistrar, isSchoolAdmin, isTeacher, teacherAssignmentsForProfile } from '../app-config';
import { auth, db } from '../firebase';
import { fsAudit_, fsInvalidateReadCaches_, fsIsActiveLearner_ } from '../firestore-api';
import { attendanceClassDays, isAttendanceCount } from '../attendance';
import { normalizeGrade } from '../student-import/schema';
import type { AttendanceImportEntry, AttendanceTarget } from './sf2';
import { attendanceMonthNeedsReplacement, canonicalAttendanceMonth, equivalentAttendanceCount } from './months';

export interface AttendancePlacement { gradeLevel: string; section: string }
interface Access { teacher: boolean; assignmentKeys: string[] }
type Read = (reference: any) => Promise<{ exists: boolean; data(): Record<string, any> }>;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const rows = ['classDays', 'daysPresent', 'daysAbsent'] as const;
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown) => String(value ?? '').trim();
const key = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const monthKey = canonicalAttendanceMonth;
const placementKey = (year: string, placement: AttendancePlacement) => `${year}::${normalizeGrade(placement.gradeLevel)}::${text(placement.section)}`;
const learnerCollection = (year: string) => db.collection('schoolYears').doc(year).collection('learners');
const identity = (learner: Record<string, unknown>) => Object.fromEntries(['firstName', 'middleName', 'lastName', 'suffix', 'name', 'gradeLevel', 'section'].map(field => [field, text(learner[field])]));

/** UI scope only; server profile and assignments are rechecked for reads and saves. */
export function attendanceImportSections<T extends AttendancePlacement>(year: string, sections: T[]): T[] {
  if (isSchoolAdmin() || isRegistrar()) return sections;
  if (!isTeacher()) return [];
  const assignments = teacherAssignmentsForProfile().filter(assignment => assignment.schoolYear === year);
  return sections.filter(section => assignments.some(assignment => normalizeGrade(assignment.gradeLevel) === normalizeGrade(section.gradeLevel) && text(assignment.section) === text(section.section)));
}

async function authorize(read: Read, year: string, placement: AttendancePlacement): Promise<Access> {
  if (!/^\d{4}-\d{4}$/.test(year) || !normalizeGrade(placement.gradeLevel) || !text(placement.section)) throw new Error('Select a valid school year, grade and section.');
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in with an active account to import attendance.');
  const profile = (await read(db.collection('users').doc(uid))).data();
  if (profile?.status !== 'Active') throw new Error('An active account is required to import attendance.');
  const teacher = profile.role === 'Teacher';
  if (!teacher && !['Developer', 'School Admin', 'Registrar'].includes(profile.role)) throw new Error('Your role does not have access to attendance imports.');
  const assignmentKeys = Array.isArray(profile.teacherAssignmentSecurityKeys) ? profile.teacherAssignmentSecurityKeys : [];
  if (teacher) {
    const configuration = (await read(db.collection('settings').doc('toggles'))).data();
    if (configuration?.canTeacherImportAttendance !== true) throw new Error('Attendance imports are disabled for teachers. Contact your school administrator.');
    if (!assignmentKeys.includes(placementKey(year, placement))) throw new Error('Import attendance only into your assigned school year, grade and section.');
  }
  const section = await read(db.collection('schoolYears').doc(year).collection('grades').doc(key(normalizeGrade(placement.gradeLevel))).collection('sections').doc(key(placement.section)));
  if (!section.exists) throw new Error('The selected section is no longer configured. Reload the import options.');
  return { teacher, assignmentKeys };
}

function assertTarget(learner: Record<string, unknown>, placement: AttendancePlacement) {
  if (normalizeGrade(learner.gradeLevel) !== normalizeGrade(placement.gradeLevel) || text(learner.section) !== text(placement.section)) throw new Error('A learner is no longer in the selected section. Validate the file again.');
  if (!fsIsActiveLearner_(learner)) throw new Error('A learner is no longer active. Validate the file again.');
}

export async function loadAttendanceImportTargets(year: string, placement: AttendancePlacement): Promise<AttendanceTarget[]> {
  await authorize(reference => reference.get({ source: 'server' }), year, placement);
  const snapshot = await learnerCollection(year).where('gradeLevel', '==', normalizeGrade(placement.gradeLevel)).where('section', '==', text(placement.section)).get({ source: 'server' });
  return snapshot.docs.map(document => ({ ...document.data(), learnerId: document.id })).filter(fsIsActiveLearner_).map(learner => ({ ...learner, expectedIdentity: identity(learner) })) as AttendanceTarget[];
}

function monthlySnapshot(value: unknown, month: string) {
  const attendance = object(value);
  return rows.map(row => Object.entries(object(attendance[row])).filter(([key]) => monthKey(key) === month).map(([key, count]) => [key, text(count)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

export async function importSf2Attendance(input: {
  schoolYear: string; placement: AttendancePlacement; month: string; entries: AttendanceImportEntry[]; overwriteExisting: boolean;
}): Promise<{ updated: number; unchanged: number }> {
  const { schoolYear, placement, entries } = input;
  const month = months.includes(input.month) ? input.month : '';
  if (!month) throw new Error('Choose a valid attendance month.');
  if (!entries.length || entries.length > 300) throw new Error('Import between 1 and 300 learners from one section at a time.');
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!text(entry.learnerId) || entry.learnerId.includes('/') || ids.has(entry.learnerId)) throw new Error('Every attendance row must match one unique learner. Validate the file again.');
    ids.add(entry.learnerId);
    if (!isAttendanceCount(entry.daysPresent) || !isAttendanceCount(entry.daysAbsent) || attendanceClassDays(entry.daysPresent, entry.daysAbsent) !== entry.classDays || Number(entry.classDays) > 31) throw new Error('Attendance counts must be non-negative, total no more than 31, and Total Classes must equal Present + Absent.');
    if (!entry.expectedIdentity) throw new Error('The learner review is incomplete. Validate the file again.');
  }
  const result = await db.runTransaction(async transaction => {
    const read: Read = reference => transaction.get(reference);
    await authorize(read, schoolYear, placement);
    const preferences = object((await read(db.collection('settings').doc('cardPrintingPreferences'))).data());
    const configured = Array.isArray(preferences.attendanceMonths) ? preferences.attendanceMonths.filter(value => monthKey(value) === month).map(text) : [];
    if (configured.length > 1) throw new Error('Learner Card settings contain more than one label for this month. Keep one attendance column per month before importing.');
    const outputMonth = configured[0] || month;
    const snapshots = await Promise.all(entries.map(entry => read(learnerCollection(schoolYear).doc(entry.learnerId))));
    const updates: { learnerId: string; attendance: Record<string, unknown> }[] = [];
    let unchanged = 0;
    entries.forEach((entry, index) => {
      const snapshot = snapshots[index];
      if (!snapshot.exists) throw new Error('A matched learner no longer exists. Validate the file again.');
      const learner = snapshot.data();
      assertTarget(learner, placement);
      if (JSON.stringify(identity(learner)) !== JSON.stringify(identity(entry.expectedIdentity))) throw new Error('A learner name or placement changed after review. Validate the file again.');
      if (JSON.stringify(monthlySnapshot(learner.attendance, month)) !== JSON.stringify(monthlySnapshot(entry.expectedAttendance, month))) throw new Error('Attendance changed after review. Validate the file again before saving.');
      const attendance = { ...object(learner.attendance) };
      const values = { classDays: entry.classDays, daysPresent: entry.daysPresent, daysAbsent: entry.daysAbsent };
      let same = true;
      for (const row of rows) {
        const existing = object(attendance[row]);
        const aliases = Object.keys(existing).filter(key => monthKey(key) === month);
        for (const alias of aliases) {
          if (!equivalentAttendanceCount(text(existing[alias]), values[row])) same = false;
        }
        if (!aliases.length || !equivalentAttendanceCount(text(existing[outputMonth]), values[row])) same = false;
        attendance[row] = { ...existing, ...Object.fromEntries([...new Set([...aliases, outputMonth])].map(key => [key, values[row]])) };
      }
      if (same) { unchanged++; return; }
      if (attendanceMonthNeedsReplacement(learner.attendance, month, values) && !input.overwriteExisting) throw new Error('Attendance already exists for this month. Review it and allow replacement before importing.');
      updates.push({ learnerId: entry.learnerId, attendance });
    });
    const importId = `${Date.now()}-${crypto.randomUUID()}`;
    for (const update of updates) transaction.update(learnerCollection(schoolYear).doc(update.learnerId), { attendance: update.attendance, __attendanceImportId: importId });
    return { updated: updates.length, unchanged };
  });
  fsInvalidateReadCaches_(schoolYear);
  if (result.updated) fsAudit_('ATTENDANCE_IMPORT', { sheet: `learners_${schoolYear}`, newValue: JSON.stringify({ schoolId: APP_CONFIG.schoolId, schoolYear, gradeLevel: placement.gradeLevel, section: placement.section, month, ...result }) });
  return result;
}
