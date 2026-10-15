import LegacyPage from './LegacyPage';
import html from './markup/enrollment-data.html?raw';
import { requireAuth } from '../lib/auth';
import { initEnrollmentData } from '../lib/enrollment-data';

export default function EnrollmentDataPage() {
  return (
    <LegacyPage
      html={html}
      title="Enrollment Data"
      onMount={async () => {
        await requireAuth();
        await initEnrollmentData();
      }}
    />
  );
}
