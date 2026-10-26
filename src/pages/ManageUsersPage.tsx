import LegacyPage from './LegacyPage';
import '../styles/pages/manage-users.css';
import '../styles/components/student-card-template.css';
import html from './markup/manage-users.html?raw';
import { requireAuth } from '../lib/auth';
import { initManageUsers } from '../lib/manage-users';
import { initAdminOptions } from '../lib/admin-options';
import { AdminCardTemplateChooser } from './PrintCardPage';
import '../lib/firestore-backup';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import StudentImportPanel from '../components/StudentImportPanel';

export default function ManageUsersPage() {
  const [ready, setReady] = useState(false);
  return (
    <LegacyPage
      html={html}
      title="Admin Console"
      portalSelector="#adminCardTemplateChooser"
      children={<><AdminCardTemplateChooser />{ready && <StudentImportPortal />}</>}
      onMount={async () => {
        await requireAuth();
        setReady(true);
        await Promise.all([initManageUsers(), initAdminOptions()]);
      }}
    />
  );
}

function StudentImportPortal() {
  const target = document.getElementById('adminStudentImportRoot');
  return target ? createPortal(<StudentImportPanel />, target) : null;
}
