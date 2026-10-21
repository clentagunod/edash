import { useModeSettings } from '../lib/mode-settings';

export default function TestModeStamp() {
  const { isTestMode } = useModeSettings();
  if (!isTestMode) return null;
  return <div className="test-mode-stamp" aria-hidden="true">TEST MODE</div>;
}
