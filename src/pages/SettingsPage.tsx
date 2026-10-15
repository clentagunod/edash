import LegacyPage from './LegacyPage';
import html from './markup/settings.html?raw';
import { requireAuth } from '../lib/auth';
import { initSettingsPage } from '../lib/settings';

export default function SettingsPage() {
  return (
    <LegacyPage
      html={html}
      title="Settings"
      onMount={async () => {
        await requireAuth();
        return initSettingsPage();
      }}
    />
  );
}
