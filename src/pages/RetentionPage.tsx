import LegacyPage from './LegacyPage';
import '../styles/pages/promotion.css';
import html from './markup/retention.html?raw';
import { requireAuth } from '../lib/auth';
import { initRetention } from '../lib/promotion';

export default function RetentionPage() {
  return (
    <LegacyPage
      html={html}
      title="Retention"
      onMount={async () => {
        await requireAuth();
        await initRetention();
      }}
    />
  );
}
