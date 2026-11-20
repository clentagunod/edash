import { lazy, Suspense, useEffect, useState } from 'react';
import { isRegistrar, isSchoolAdmin, isTeacher } from '../lib/app-config';
import { fsSubscribeAttendanceImportConfiguration } from '../lib/firestore-api';
import ImportDialogLauncher from './ImportDialogLauncher';

const AttendanceImportPanel = lazy(() => import('./AttendanceImportPanel'));

export default function AttendanceImportLauncher({ onComplete }: { onComplete: () => void }) {
  const [allowed, setAllowed] = useState(() => isSchoolAdmin() || isRegistrar());
  useEffect(() => {
    if (isSchoolAdmin() || isRegistrar()) { setAllowed(true); return; }
    setAllowed(false);
    if (!isTeacher()) return;
    return fsSubscribeAttendanceImportConfiguration(
      value => setAllowed(value.canTeacherImportAttendance === true),
      () => setAllowed(false),
    );
  }, []);
  return <ImportDialogLauncher allowed={allowed} buttonId="importAttendanceBtn" id="attendanceImport"
    title="Import Daily Attendance Report (SF2)" description="Match an SF2 worksheet to a section, review monthly totals, then save attendance."
    closeLabel="Close attendance import">
    {props => <Suspense fallback={<p className="student-import-access-denied" role="status">Loading attendance import…</p>}>
      <AttendanceImportPanel {...props} onComplete={onComplete} />
    </Suspense>}
  </ImportDialogLauncher>;
}
