import { useSyncExternalStore } from 'react';
import { getCentralRegistryFirestore } from './school-registry';

export interface ModeSettings {
  status: 'loading' | 'ready' | 'error';
  isMaintenanceMode: boolean;
  isTestMode: boolean;
  error?: Error;
}

function readLocalMaintenanceOverride(): boolean | null {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return null;
  const value = import.meta.env.MAINTENANCE_MODE?.trim().toLowerCase();
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('MAINTENANCE_MODE must be set to "true" or "false".');
}

const localMaintenanceOverride = readLocalMaintenanceOverride();

export function resolveMaintenanceMode(
  firestoreMaintenanceMode: boolean,
  localOverride = localMaintenanceOverride,
): boolean {
  return localOverride ?? firestoreMaintenanceMode;
}

let modeSettings: ModeSettings = {
  status: localMaintenanceOverride === null ? 'loading' : 'ready',
  isMaintenanceMode: localMaintenanceOverride ?? false,
  isTestMode: false,
};
const subscribers = new Set<() => void>();

function publish(nextSettings: ModeSettings): void {
  modeSettings = nextSettings;
  subscribers.forEach((subscriber) => subscriber());
}

function parseModeFlag(settings: Record<string, unknown>, name: string): boolean {
  const value = settings[name];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new Error(`Central settings/modes field "${name}" must be a boolean.`);
  }
  return value;
}

export function getModeSettings(): ModeSettings {
  return modeSettings;
}

export function subscribeModeSettings(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function useModeSettings(): ModeSettings {
  return useSyncExternalStore(subscribeModeSettings, getModeSettings, getModeSettings);
}

export function startModeSettingsListener(): () => void {
  publish({
    status: localMaintenanceOverride === null ? 'loading' : 'ready',
    isMaintenanceMode: modeSettings.isMaintenanceMode,
    isTestMode: modeSettings.isTestMode,
  });
  let unsubscribe: (() => void) | undefined;

  try {
    unsubscribe = getCentralRegistryFirestore()
      .collection('settings')
      .doc('modes')
      .onSnapshot((snapshot: { exists: boolean; data: () => Record<string, unknown> | undefined }) => {
        try {
          const settings = snapshot.exists ? snapshot.data() || {} : {};
          publish({
            status: 'ready',
            isMaintenanceMode: localMaintenanceOverride ?? parseModeFlag(settings, 'isMaintenanceMode'),
            isTestMode: parseModeFlag(settings, 'isTestMode'),
          });
        } catch (error) {
          const settingsError = error instanceof Error ? error : new Error(String(error));
          console.error('Central mode settings are invalid:', settingsError);
          publish({
            ...modeSettings,
            status: 'error',
            error: settingsError,
          });
        }
      }, (error: Error) => {
        console.error('Could not read central mode settings:', error);
        publish({ ...modeSettings, status: 'error', error });
      });
  } catch (error) {
    const settingsError = error instanceof Error ? error : new Error(String(error));
    console.error('Could not initialize central mode settings:', settingsError);
    publish({ ...modeSettings, status: 'error', error: settingsError });
  }

  return () => unsubscribe?.();
}
