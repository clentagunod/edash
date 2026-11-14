import LegacyPage from './LegacyPage';
import html from './markup/utilities.html?raw';
import { requireAuth } from '../lib/auth';

export default function UtilitiesPage() {
  return (
    <LegacyPage
      html={html}
      title="Utilities"
      onMount={async () => {
        await requireAuth();
      }}
    />
  );
}
