import LegacyPage from './LegacyPage';
import html from './markup/program-ip.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function ProgramIpPage() {
  return (
    <LegacyPage
      html={html}
      title="IP Learners"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "IP", activeNavKey: "ip", title: "IP Learners" });
        
      }}
    />
  );
}
