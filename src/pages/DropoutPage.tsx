import LegacyPage from './LegacyPage';
import html from './markup/dropout.html?raw';
import { requireAuth } from '../lib/auth';
import { initDropout } from '../lib/dropout';

export default function DropoutPage() {
  return (
    <LegacyPage
      html={html}
      title="Dropout"
      onMount={async () => {
        await requireAuth();
    await initDropout();
        
      }}
    />
  );
}
