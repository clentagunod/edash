import { useState } from 'react';
import LegacyPage from './LegacyPage';
import EduAiAssistant from '../components/EduAiAssistant';
import '../styles/pages/eduai.css';
import html from './markup/eduai.html?raw';
import { requireAuth } from '../lib/auth';
import { renderShell } from '../lib/shell';

export default function EduaiPage() {
  const [authReady, setAuthReady] = useState(false);
  return (
    <LegacyPage
      html={html}
      title="EduAI"
      portalSelector="#eduaiMount"
      onMount={async () => {
        await requireAuth();
        renderShell('eduai', 'EduAI');
        setAuthReady(true);
      }}
    >
      {authReady ? <EduAiAssistant /> : (
        <div className="eduai-state-card" role="status" aria-live="polite">
          <span className="eduai-state-spinner" aria-hidden="true" />
          <div><strong>Opening your EduAI workspace</strong><p>Verifying your sign-in session.</p></div>
        </div>
      )}
    </LegacyPage>
  );
}
