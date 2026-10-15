import LegacyPage from './LegacyPage';
import html from './markup/preferences.html?raw';
import { requireAuth } from '../lib/auth';
import { initPreferencesPage } from '../lib/settings';

export default function PreferencesPage() {
  return (
    <LegacyPage
      html={html}
      title="Preferences"
      onMount={async () => {
        await requireAuth();
        return initPreferencesPage();
      }}
    />
  );
}
