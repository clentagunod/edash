import { useEffect, useState } from 'react';
import { isSchoolAdmin, isTeacher } from '../lib/app-config';
import { fsSubscribeImportConfiguration } from '../lib/firestore-api';
import StudentImportPanel from './StudentImportPanel';
import ImportDialogLauncher from './ImportDialogLauncher';

/** Mounted only after the Masterlist authentication guard has completed. */
export default function StudentImportLauncher({ onComplete }: { onComplete: () => void }) {
  const [allowed, setAllowed] = useState(isSchoolAdmin);

  useEffect(() => {
    if (isSchoolAdmin()) { setAllowed(true); return; }
    setAllowed(false);
    if (!isTeacher()) return;
    return fsSubscribeImportConfiguration(
      configuration => setAllowed(configuration.canTeacherImport === true),
      () => setAllowed(false),
    );
  }, []);

  return <ImportDialogLauncher allowed={allowed} buttonId="importStudentsBtn" id="studentImport" title="Import Students (SF1)"
    description="Choose a file, review the records, then confirm the import." closeLabel="Close student import">
    {props => <StudentImportPanel {...props} onComplete={onComplete} />}
  </ImportDialogLauncher>;
}
