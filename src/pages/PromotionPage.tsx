import LegacyPage from './LegacyPage';
import '../styles/pages/promotion.css';
import html from './markup/promotion.html?raw';
import { requireAuth } from '../lib/auth';
import { initPromotion } from '../lib/promotion';

export default function PromotionPage() {
  return (
    <LegacyPage
      html={html}
      title="Promotion"
      onMount={async () => {
        await requireAuth();
        await initPromotion();
      }}
    />
  );
}
