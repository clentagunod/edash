import LegacyPage from './LegacyPage';
import html from './markup/bmi-calculator.html?raw';
import { requireAuth } from '../lib/auth';
import { initUtilities } from '../lib/utilities';

export default function BmiCalculatorPage() {
  return (
    <LegacyPage
      html={html}
      title="BMI Calculator"
      onMount={async () => {
        await requireAuth();
    initUtilities();
        
      }}
    />
  );
}
