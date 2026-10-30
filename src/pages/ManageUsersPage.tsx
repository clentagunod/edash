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
import CertificatePreferencesPanel from '../components/CertificatePreferencesPanel';
import { isSchoolAdmin } from '../lib/app-config';
import ParentPortalLinkPanel from '../components/ParentPortalLinkPanel';

export default function ManageUsersPage() {
  const [ready, setReady] = useState(false);
  return (
    <LegacyPage
      html={html}
      title="Admin Console"
      portalSelector="#adminCardTemplateChooser"
      children={<><AdminCardTemplateChooser />{ready && <><StudentImportPortal /><CertificatePreferencesPortal /><ParentPortalLinkPortal /></>}</>}
      onMount={async () => {
        await requireAuth();
        setReady(isSchoolAdmin());
        await Promise.all([initManageUsers(), initAdminOptions()]);
      }}
    />
  );
}

function CertificatePreferencesPortal() {
  const target = document.getElementById('adminCertificatePreferencesRoot');
  return target ? createPortal(<CertificatePreferencesPanel />, target) : null;
}

function ParentPortalLinkPortal() {
  const target = document.getElementById('adminParentPortalLinkRoot');
  return target ? createPortal(<ParentPortalLinkPanel />, target) : null;
}

function StudentImportPortal() {
  const target = document.getElementById('adminStudentImportRoot');
  return target ? createPortal(<StudentImportPanel />, target) : null;
}
