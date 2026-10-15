import LegacyPage from './LegacyPage';
import html from './markup/program-aral.html?raw';
import { requireAuth } from '../lib/auth';
import { initLearnerListPage } from '../lib/learner-list';

export default function ProgramAralPage() {
  return (
    <LegacyPage
      html={html}
      title="ARAL Tagged Learners"
      onMount={async () => {
        await requireAuth();
    await initLearnerListPage({ program: "ARAL", activeNavKey: "aral", title: "ARAL Tagged Learners" });
        
      }}
    />
  );
}
