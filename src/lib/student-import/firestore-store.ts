import { APP_CONFIG } from '../app-config';
import { auth, db } from '../firebase';
import { fsAudit_, fsInvalidateReadCaches_, fsSchedulePublicStatsRefresh_ } from '../firestore-api';
import { normalizeGrade } from './schema';
import type { StudentRecord } from './types';
import type { StudentImportStore, StudentSnapshot } from './upload';

interface ImportAccess { teacher: boolean; assignmentKeys: string[] }
type ReadDocument = (reference: any) => Promise<StudentSnapshot>;
const key = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const placementKey = (year: string, record: Record<string, unknown>) => `${year}::${normalizeGrade(record.gradeLevel)}::${String(record.section ?? '').trim()}`;
const sectionRef = (year: string, record: Record<string, unknown>) => db.collection('schoolYears').doc(year)
  .collection('grades').doc(key(normalizeGrade(record.gradeLevel))).collection('sections').doc(key(record.section));

async function importAccess(read: ReadDocument): Promise<ImportAccess> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in with an active account to import students.');
  const profile = (await read(db.collection('users').doc(uid))).data();
  if (profile?.status !== 'Active') throw new Error('An active account is required to import students.');
  if (['Developer', 'School Admin'].includes(String(profile.role))) return { teacher: false, assignmentKeys: [] };
  if (profile.role !== 'Teacher') throw new Error('Your role does not have access to student imports.');
  const toggles = (await read(db.collection('settings').doc('toggles'))).data();
  if (toggles?.canTeacherImport !== true) throw new Error('Student imports are disabled for teachers. Contact your school administrator.');
  const assignmentKeys = Array.isArray(profile.teacherAssignmentSecurityKeys)
    ? profile.teacherAssignmentSecurityKeys.filter((value): value is string => typeof value === 'string') : [];
  return { teacher: true, assignmentKeys };
}

function assertPlacement(access: ImportAccess, year: string, student: Record<string, unknown>) {
  if (access.teacher && !access.assignmentKeys.includes(placementKey(year, student))) {
    throw new Error('Import students only into your assigned school year, grade and section. A matching LRN outside your assignments must be handled by a school administrator.');
  }
}

async function importTargets(access: ImportAccess, year: string, students: StudentRecord[], read: ReadDocument) {
  if (!/^\d{4}-\d{4}$/.test(year)) throw new Error('Select a valid school year before importing.');
  const targets = new Map<string, StudentRecord>();
  for (const student of students) {
    if (student.schoolYear !== year || !normalizeGrade(student.gradeLevel) || !String(student.section ?? '').trim()) {
      throw new Error('Every imported student needs the selected school year, grade and section.');
    }
    assertPlacement(access, year, student);
    targets.set(placementKey(year, student), student);
  }
  await Promise.all([...targets.values()].map(async student => {
    const target = await read(sectionRef(year, student));
    if (!target.exists) throw new Error('The selected section is no longer configured. Reload the import options.');
  }));
}

export const studentImportStore: StudentImportStore = {
  async authorize(year, students = []) {
    const read: ReadDocument = reference => reference.get({ source: 'server' });
    const access = await importAccess(read);
    if (year) await importTargets(access, year, students, read);
    // Five Teacher records leave room for both archive lookups per record
    // under Firestore's 20-document transaction security-rule read budget.
    return { maxBatchSize: access.teacher ? 5 : 25, assertExisting: (selectedYear, learner) => assertPlacement(access, selectedYear, learner) };
  },
  read: (year, collection, id) => db.collection('schoolYears').doc(year).collection(collection).doc(id).get({ source: 'server' }),
  transaction: (callback, year, students = []) => db.runTransaction(async transaction => {
    const read: ReadDocument = reference => transaction.get(reference);
    // Transactional reads force a retry if access or assignments are revoked.
    const access = await importAccess(read);
    await importTargets(access, year, students, read);
    const importId = `${Date.now()}-${crypto.randomUUID()}`;
    const targets = new Set(students.map(student => placementKey(year, student)));
    return callback({
      async read(collection, id) {
        const snapshot = await read(db.collection('schoolYears').doc(year).collection(collection).doc(id));
        if (collection === 'learners' && snapshot.exists) assertPlacement(access, year, snapshot.data() || {});
        return snapshot;
      },
      write(id, data, merge) {
        assertPlacement(access, year, data);
        if (!targets.has(placementKey(year, data))) throw new Error('The import target changed. Scan the file again.');
        if (['__trashRestoreId', 'progressionSourceSchoolYear', 'progressionType'].some(field => data[field])) {
          throw new Error('Use the learner restore or progression tools for these records.');
        }
        const ref = db.collection('schoolYears').doc(year).collection('learners').doc(id);
        transaction.set(ref, { ...data, ...(!merge ? { dateAdded: new Date().toISOString() } : {}), __studentImportId: importId }, { merge });
      },
    });
  }),
  refresh(year) {
    fsInvalidateReadCaches_(year);
    fsSchedulePublicStatsRefresh_();
    fsAudit_('LEARNERS_IMPORT', { sheet: `learners_${year}`, newValue: JSON.stringify({ schoolId: APP_CONFIG.schoolId, schoolYear: year }) });
  },
};
