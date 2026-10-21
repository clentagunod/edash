import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDUAI_SETTINGS,
  EDUAI_ROLE_DEFAULTS,
  defaultEduAiSettingsForRole,
  normalizeEduAiSettings,
  resolveEduAiUserSettings,
} from './eduai-settings';

describe('EduAI preferences', () => {
  it('provides a fast, bounded default configuration', () => {
    expect(DEFAULT_EDUAI_SETTINGS).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      maxOutputTokens: 768,
      timeoutSeconds: 90,
      historyMessages: 8,
      learnerNameLimit: 150,
    });
  });

  it('validates every configurable value against supported options', () => {
    expect(normalizeEduAiSettings({
      model: 'unknown-model',
      maxOutputTokens: 99_999,
      timeoutSeconds: 999,
      temperature: 1,
      historyMessages: 100,
      learnerNameLimit: 999,
    })).toEqual(DEFAULT_EDUAI_SETTINGS);
  });

  it('provides distinct safe defaults for each supported account role', () => {
    expect(Object.keys(EDUAI_ROLE_DEFAULTS)).toEqual(['School Admin', 'Registrar', 'Teacher']);
    expect(defaultEduAiSettingsForRole('Teacher').learnerNameLimit).toBe(0);
    expect(defaultEduAiSettingsForRole('Registrar').learnerNameLimit).toBe(50);
    expect(defaultEduAiSettingsForRole('School Admin').learnerNameLimit).toBe(150);
  });

  it('uses role defaults and applies only a preference saved for the active role', () => {
    const tenant = {
      roleDefaults: {
        Teacher: { ...DEFAULT_EDUAI_SETTINGS, learnerNameLimit: 0 },
        Registrar: { ...DEFAULT_EDUAI_SETTINGS, learnerNameLimit: 25 },
      },
    };
    const ownPreference = {
      role: 'Teacher',
      timeoutSeconds: 60,
    };
    expect(resolveEduAiUserSettings('Teacher', tenant, ownPreference).settings).toMatchObject({
      learnerNameLimit: 0,
      timeoutSeconds: 60,
    });
    expect(resolveEduAiUserSettings('Registrar', tenant, ownPreference).settings).toMatchObject({
      learnerNameLimit: 25,
      timeoutSeconds: 90,
    });
  });

  it('falls back to the maintained defaults when a tenant config is missing', () => {
    expect(resolveEduAiUserSettings('Teacher', null, null).settings)
      .toEqual(defaultEduAiSettingsForRole('Teacher'));
  });
});
