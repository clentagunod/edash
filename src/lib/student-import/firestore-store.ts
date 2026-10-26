import { APP_CONFIG } from '../app-config';
import { auth, db } from '../firebase';
import { fsAudit_, fsInvalidateReadCaches_, fsSchedulePublicStatsRefresh_ } from '../firestore-api';
import type { StudentImportStore } from './upload';

export const studentImportStore: StudentImportStore = {
  async authorize() {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Sign in with an active School Admin account.');
    const profile = await db.collection('users').doc(uid).get({ source: 'server' });
    if (profile.data()?.role !== 'School Admin' || profile.data()?.status !== 'Active') {
      throw new Error('An active School Admin account is required to import students.');
    }
  },
  read: (year, collection, id) => db.collection('schoolYears').doc(year).collection(collection).doc(id).get({ source: 'server' }),
  transaction: (callback, year) => db.runTransaction(transaction => callback({
    read: (collection, id) => transaction.get(db.collection('schoolYears').doc(year).collection(collection).doc(id)),
    write: (id, data, merge) => {
      const ref = db.collection('schoolYears').doc(year).collection('learners').doc(id);
      transaction.set(ref, merge ? data : { ...data, dateAdded: new Date().toISOString() }, { merge });
    },
  })),
  refresh(year) {
    fsInvalidateReadCaches_(year);
    fsSchedulePublicStatsRefresh_();
    fsAudit_('LEARNERS_IMPORT', { sheet: `learners_${year}`, newValue: JSON.stringify({ schoolId: APP_CONFIG.schoolId, schoolYear: year }) });
  },
};
