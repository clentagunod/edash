import { auth, db } from './firebase';
import { isSchoolAdmin } from './app-config';
import { fsAudit_ } from './firestore-api';
import { emptyPerformanceConfig, validatePerformanceConfig, type PerformanceConfig } from './performance-indicators';

// Aggregate counts only. This one settings document is also included in tenant backups.
function configRef() { return db.collection('settings').doc('performanceIndicators'); }
export async function getPerformanceConfig(): Promise<PerformanceConfig> {
  const snapshot = await configRef().get();
  return snapshot.exists ? validatePerformanceConfig(snapshot.data()) : emptyPerformanceConfig();
}
export function subscribePerformanceConfig(onValue: (config: PerformanceConfig) => void, onError: (error: Error) => void): () => void {
  return configRef().onSnapshot(snapshot => {
    try { onValue(snapshot.exists ? validatePerformanceConfig(snapshot.data()) : emptyPerformanceConfig()); }
    catch (error) { onError(error instanceof Error ? error : new Error('Could not read performance indicators.')); }
  }, onError);
}
export async function savePerformanceConfig(input: PerformanceConfig): Promise<PerformanceConfig> {
  if (!auth.currentUser || !isSchoolAdmin()) throw new Error('Only a School Admin can change performance indicators.');
  const config = validatePerformanceConfig(input);
  const saved = { ...config, revision: config.revision + 1 };
  // Protect another administrator's changes made while this editor was open.
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(configRef());
    const current = snapshot.exists ? validatePerformanceConfig(snapshot.data()) : emptyPerformanceConfig();
    if (current.revision !== config.revision) throw new Error('Another administrator saved changes. Export your draft, then reload before saving again.');
    transaction.set(configRef(), saved);
  });
  fsAudit_('SETTINGS_UPDATE', { sheet: 'settings', recordId: 'performanceIndicators', newValue: JSON.stringify(saved) });
  return saved;
}
