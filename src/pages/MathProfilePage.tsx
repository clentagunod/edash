import LegacyPage from './LegacyPage';
import html from './markup/math-profile.html?raw';
import { requireAuth } from '../lib/auth';
import { initMathProfiles } from '../lib/math-profile';

export default function MathProfilePage() {
  return (
    <LegacyPage
      html={html}
      title="Math Profile"
      onMount={async () => {
        await requireAuth();
    await initMathProfiles();
        
      }}
    />
  );
}
