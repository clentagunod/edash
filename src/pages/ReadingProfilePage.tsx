import LegacyPage from './LegacyPage';
import html from './markup/reading-profile.html?raw';
import { requireAuth } from '../lib/auth';
import { initReadingProfiles } from '../lib/reading-profile';

export default function ReadingProfilePage() {
  return (
    <LegacyPage
      html={html}
      title="Reading Profile"
      onMount={async () => {
        await requireAuth();
    await initReadingProfiles();
        
      }}
    />
  );
}
