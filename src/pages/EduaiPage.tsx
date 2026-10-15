import LegacyPage from './LegacyPage';
import '../styles/pages/eduai.css';
import html from './markup/eduai.html?raw';
import { requireAuth } from '../lib/auth';
import { renderShell } from '../lib/shell';

export default function EduaiPage() {
  return (
    <LegacyPage
      html={html}
      title="EduAI"
      onMount={async () => {
        await requireAuth();
    renderShell("eduai", "EduAI");
        
      }}
    />
  );
}
