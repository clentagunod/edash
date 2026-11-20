import LegacyPage from './LegacyPage';
import html from './markup/masterlist.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage, refreshLearnersFromLive } from '../lib/learner-list';
import { useState } from 'react';
import StudentImportLauncher from '../components/StudentImportLauncher';
import AttendanceImportLauncher from '../components/AttendanceImportLauncher';

function refreshImportedLearners() { void refreshLearnersFromLive(); }

export default function MasterlistPage() {
  const [ready, setReady] = useState(false);
  return (
    <LegacyPage
      html={html}
      title="Learner Masterlist"
      portalSelector="#masterlistImportRoot"
      children={ready ? <><StudentImportLauncher onComplete={refreshImportedLearners} /><AttendanceImportLauncher onComplete={refreshImportedLearners} /></> : null}
      onMount={async () => {
        await requireAuth();
        await initLearnerListPage({ program: "", activeNavKey: "masterlist", title: "Learner Masterlist" });
        setReady(true);
      }}
    />
  );
}
