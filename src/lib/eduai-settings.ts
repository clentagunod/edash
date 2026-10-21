import modelOptions from './eduai-models.json';
import tenantDefaults from './eduai-tenant-defaults.json';

export interface EduAiSettings {
  model: string;
  maxOutputTokens: number;
  timeoutSeconds: number;
  temperature: number;
  historyMessages: number;
  learnerNameLimit: number;
}

export const EDUAI_MODELS = modelOptions;
export const EDUAI_ROLE_DEFAULTS = tenantDefaults.roleDefaults;
export const EDUAI_REPLY_LENGTH_OPTIONS = [256, 512, 768, 1024, 1536, 2048] as const;
export const EDUAI_TIMEOUT_OPTIONS = [30, 45, 60, 90, 120] as const;
export const EDUAI_HISTORY_MESSAGE_OPTIONS = [0, 2, 4, 6, 8] as const;
export const EDUAI_NAME_LIMIT_OPTIONS = [0, 25, 50, 100, 150] as const;

export const DEFAULT_EDUAI_SETTINGS: EduAiSettings = {
  model: EDUAI_MODELS[0].id,
  maxOutputTokens: 768,
  timeoutSeconds: 90,
  temperature: 0.2,
  historyMessages: 8,
  learnerNameLimit: 150,
};

function isAllowed(value: number, options: readonly number[]): boolean {
  return options.some((option) => option === value);
}

export function normalizeEduAiSettings(value: unknown): EduAiSettings {
  const candidate = value && typeof value === 'object'
    ? value as Partial<EduAiSettings>
    : {};
  const validModel = EDUAI_MODELS.some((model) => model.id === candidate.model);
  const temperature = Number(candidate.temperature);

  return {
    model: validModel ? candidate.model! : DEFAULT_EDUAI_SETTINGS.model,
    maxOutputTokens: isAllowed(Number(candidate.maxOutputTokens), EDUAI_REPLY_LENGTH_OPTIONS)
      ? Number(candidate.maxOutputTokens)
      : DEFAULT_EDUAI_SETTINGS.maxOutputTokens,
    timeoutSeconds: isAllowed(Number(candidate.timeoutSeconds), EDUAI_TIMEOUT_OPTIONS)
      ? Number(candidate.timeoutSeconds)
      : DEFAULT_EDUAI_SETTINGS.timeoutSeconds,
    temperature: Number.isFinite(temperature) && temperature >= 0 && temperature <= 0.6
      ? Math.round(temperature * 10) / 10
      : DEFAULT_EDUAI_SETTINGS.temperature,
    historyMessages: isAllowed(Number(candidate.historyMessages), EDUAI_HISTORY_MESSAGE_OPTIONS)
      ? Number(candidate.historyMessages)
      : DEFAULT_EDUAI_SETTINGS.historyMessages,
    learnerNameLimit: isAllowed(Number(candidate.learnerNameLimit), EDUAI_NAME_LIMIT_OPTIONS)
      ? Number(candidate.learnerNameLimit)
      : DEFAULT_EDUAI_SETTINGS.learnerNameLimit,
  };
}

export function defaultEduAiSettingsForRole(role: string): EduAiSettings {
  const roleSettings = EDUAI_ROLE_DEFAULTS[role as keyof typeof EDUAI_ROLE_DEFAULTS];
  return normalizeEduAiSettings(roleSettings || DEFAULT_EDUAI_SETTINGS);
}

export function resolveEduAiUserSettings(
  role: string,
  tenantSettings: unknown,
  userSettings: unknown,
): { settings: EduAiSettings; roleDefaults: EduAiSettings } {
  const tenant = tenantSettings && typeof tenantSettings === 'object'
    ? tenantSettings as { roleDefaults?: Record<string, unknown> }
    : {};
  const saved = userSettings && typeof userSettings === 'object'
    ? userSettings as { role?: string } & Partial<EduAiSettings>
    : {};
  const roleDefaults = normalizeEduAiSettings(
    tenant.roleDefaults?.[role] || defaultEduAiSettingsForRole(role),
  );
  return {
    settings: saved.role === role
      ? normalizeEduAiSettings({ ...roleDefaults, ...saved })
      : roleDefaults,
    roleDefaults,
  };
}
