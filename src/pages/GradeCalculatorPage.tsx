import LegacyPage from './LegacyPage';
import html from './markup/grade-calculator.html?raw';
import { requireAuth } from '../lib/auth';
import { initUtilities } from '../lib/utilities';

export default function GradeCalculatorPage() {
  return (
    <LegacyPage
      html={html}
      title="Grade Calculator"
      onMount={async () => {
        await requireAuth();
    initUtilities();
        
      }}
    />
  );
}
