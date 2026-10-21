import { useState } from 'react';
import {
  EDUAI_HISTORY_MESSAGE_OPTIONS,
  EDUAI_MODELS,
  EDUAI_NAME_LIMIT_OPTIONS,
  EDUAI_REPLY_LENGTH_OPTIONS,
  EDUAI_TIMEOUT_OPTIONS,
  type EduAiSettings,
} from '../lib/eduai-settings';
import {
  EDUAI_PROVIDER_OPTIONS,
  type EduAiProviderSettings,
  type EduAiProviderSettingsDraft,
} from '../lib/eduai';
import type { EduAiRole } from '../lib/eduai-context';

interface EduAiSettingsDialogProps {
  settings: EduAiSettings;
  roleDefaults: EduAiSettings;
  role: EduAiRole;
  providerSettings: EduAiProviderSettings;
  onClose: () => void;
  onSave: (settings: EduAiSettings, provider: EduAiProviderSettingsDraft) => Promise<void>;
  onReset: () => Promise<void>;
}

function formatReplyLength(tokens: number): string {
  if (tokens <= 512) return 'Short';
  if (tokens <= 1024) return 'Standard';
  return 'Detailed';
}

export default function EduAiSettingsDialog({
  settings,
  roleDefaults,
  role,
  providerSettings,
  onClose,
  onSave,
  onReset,
}: EduAiSettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  const [providerDraft, setProviderDraft] = useState<EduAiProviderSettingsDraft>({
    provider: providerSettings.provider,
    personalProvider: providerSettings.personalProvider,
    model: providerSettings.model,
    endpoint: providerSettings.endpoint,
    apiKey: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProvider = providerDraft.provider === 'default'
    ? providerDraft.personalProvider
    : providerDraft.provider;
  const selectedProviderInfo = EDUAI_PROVIDER_OPTIONS.find(({ id }) => id === selectedProvider);
  const hasSavedSelectedCredential = providerSettings.credentialConfigured
    && providerSettings.personalProvider === selectedProvider;

  const chooseProvider = (provider: string) => {
    if (provider === 'default') {
      setProviderDraft({ ...providerDraft, provider: 'default', removeCredentials: false });
      return;
    }
    const nextProvider = EDUAI_PROVIDER_OPTIONS.find(({ id }) => id === provider);
    if (!nextProvider) return;
    setProviderDraft({
      ...providerDraft,
      provider: nextProvider.id,
      personalProvider: nextProvider.id,
      model: providerSettings.personalProvider === nextProvider.id && providerSettings.model
        ? providerSettings.model
        : nextProvider.model,
      endpoint: providerSettings.personalProvider === nextProvider.id && providerSettings.endpoint
        ? providerSettings.endpoint
        : nextProvider.endpoint,
      apiKey: '',
      removeCredentials: false,
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(draft, providerDraft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save EduAI settings.');
    } finally {
      setSaving(false);
    }
  };

  const removeSavedCredential = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(draft, { ...providerDraft, provider: 'default', apiKey: '', removeCredentials: true });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the saved provider key.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError('');
    try {
      await onReset();
      setDraft(roleDefaults);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not restore role defaults.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="eduai-settings-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="eduai-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eduaiSettingsTitle"
      >
        <header className="eduai-settings-header">
          <div>
            <span className="eduai-workspace-kicker"><span aria-hidden="true">⚙</span> Preferences</span>
            <h2 id="eduaiSettingsTitle">EduAI settings</h2>
            <p>Choose an AI provider and adjust EduAI for your account and role.</p>
          </div>
          <button className="eduai-settings-close" type="button" onClick={onClose} aria-label="Close EduAI settings">×</button>
        </header>

        <form
          className="eduai-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <section className="eduai-settings-section" aria-labelledby="eduaiProviderSection">
            <div className="eduai-settings-section-heading">
              <span className="eduai-settings-number">00</span>
              <div><h3 id="eduaiProviderSection">AI provider</h3><p>Use the school-managed Gemini setup or connect a provider account of your own.</p></div>
            </div>
            <label className="eduai-setting-field">
              <span>Provider option</span>
              <select
                value={providerDraft.provider === 'default' ? 'default' : 'personal'}
                onChange={(event) => {
                  if (event.target.value === 'default') chooseProvider('default');
                  else chooseProvider(providerSettings.personalProvider || EDUAI_PROVIDER_OPTIONS[0].id);
                }}
              >
                <option value="default">Default · shared school Gemini usage</option>
                <option value="personal">I have my own provider options</option>
              </select>
              <small>Personal requests use your provider account and API key. Keys are encrypted on the server and never shown again.</small>
            </label>
            {providerDraft.provider !== 'default' && selectedProviderInfo && (
              <>
                <label className="eduai-setting-field">
                  <span>AI provider</span>
                  <select value={providerDraft.provider} onChange={(event) => chooseProvider(event.target.value)}>
                    {EDUAI_PROVIDER_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <label className="eduai-setting-field">
                  <span>Model ID</span>
                  <input
                    type="text"
                    value={providerDraft.model}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(event) => setProviderDraft({ ...providerDraft, model: event.target.value })}
                    placeholder={selectedProviderInfo.model}
                  />
                  <small>Suggested model: <code>{selectedProviderInfo.model}</code>. Check your provider account for available model IDs.</small>
                </label>
                <label className="eduai-setting-field">
                  <span>API endpoint</span>
                  <input
                    type="url"
                    value={providerDraft.endpoint}
                    maxLength={500}
                    autoComplete="url"
                    onChange={(event) => setProviderDraft({ ...providerDraft, endpoint: event.target.value })}
                    placeholder={selectedProviderInfo.endpoint}
                  />
                  <small>Pre-filled with the official {selectedProviderInfo.label} endpoint. Other hosts are blocked for security.</small>
                </label>
                <label className="eduai-setting-field">
                  <span>API key {hasSavedSelectedCredential && <strong>Key saved · leave blank to keep</strong>}</span>
                  <input
                    type="password"
                    value={providerDraft.apiKey}
                    maxLength={2048}
                    autoComplete="new-password"
                    onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value, removeCredentials: false })}
                    placeholder={hasSavedSelectedCredential ? 'Saved securely · enter a new key to replace' : 'Paste your provider API key'}
                  />
                  <small>Sent only through Firebase’s authenticated connection, encrypted before storage, and decrypted only to call your provider. It is not stored in browser storage or readable Firestore settings.</small>
                </label>
              </>
            )}
            <div className="eduai-provider-usage" aria-live="polite">
              <strong>{providerDraft.provider === 'default' ? 'Shared provider usage' : 'Your provider usage'}</strong>
              <span>{providerSettings.usage.requests.toLocaleString()} requests · {providerSettings.usage.inputTokens.toLocaleString()} input tokens · {providerSettings.usage.outputTokens.toLocaleString()} output tokens</span>
              <small>EduAI usage this month ({providerSettings.usagePeriod || 'current month'}). Provider free limits and billing are managed by each provider.</small>
            </div>
            {providerSettings.credentialConfigured && (
              <button className="eduai-remove-key-button" type="button" onClick={() => void removeSavedCredential()} disabled={saving}>
                Remove saved personal API key
              </button>
            )}
          </section>

          {providerDraft.provider === 'default' && (
          <section className="eduai-settings-section" aria-labelledby="eduaiModelSection">
            <div className="eduai-settings-section-heading">
              <span className="eduai-settings-number">01</span>
              <div><h3 id="eduaiModelSection">Model</h3><p>Choose a lightweight model to control response speed.</p></div>
            </div>
            <label className="eduai-setting-field">
              <span>Shared Gemini model</span>
              <select
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              >
                {EDUAI_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
              <small>{EDUAI_MODELS.find((model) => model.id === draft.model)?.description}</small>
            </label>
            <p className="eduai-settings-note">This setting is used only with the Default provider. Access and quotas depend on the school’s Google AI Studio project. EduAI never switches models automatically.</p>
          </section>
          )}

          <section className="eduai-settings-section" aria-labelledby="eduaiResponseSection">
            <div className="eduai-settings-section-heading">
              <span className="eduai-settings-number">02</span>
              <div><h3 id="eduaiResponseSection">Response</h3><p>Balance reply detail and creativity.</p></div>
            </div>
            <label className="eduai-setting-field">
              <span>Maximum reply length <strong>{draft.maxOutputTokens} tokens · {formatReplyLength(draft.maxOutputTokens)}</strong></span>
              <select
                value={draft.maxOutputTokens}
                onChange={(event) => setDraft({ ...draft, maxOutputTokens: Number(event.target.value) })}
              >
                {EDUAI_REPLY_LENGTH_OPTIONS.map((tokens) => (
                  <option key={tokens} value={tokens}>{tokens} tokens · {formatReplyLength(tokens)}</option>
                ))}
              </select>
              <small>This is an upper bound; actual answers may be shorter.</small>
            </label>
            <label className="eduai-setting-field">
              <span>Creativity <strong>{draft.temperature.toFixed(1)}</strong></span>
              <input
                type="range"
                min="0"
                max="0.6"
                step="0.1"
                value={draft.temperature}
                onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
              />
              <small>Lower values favor consistent, data-grounded replies. Maximum is capped to reduce speculation.</small>
            </label>
          </section>

          <section className="eduai-settings-section" aria-labelledby="eduaiPerformanceSection">
            <div className="eduai-settings-section-heading">
              <span className="eduai-settings-number">03</span>
              <div><h3 id="eduaiPerformanceSection">Performance & context</h3><p>Limit wait time and the context sent per request.</p></div>
            </div>
            <label className="eduai-setting-field">
              <span>Proxy timeout <strong>{draft.timeoutSeconds} seconds</strong></span>
              <select
                value={draft.timeoutSeconds}
                onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })}
              >
                {EDUAI_TIMEOUT_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
              </select>
              <small>Requests stop waiting when this limit is reached.</small>
            </label>
            <label className="eduai-setting-field">
              <span>Previous messages included <strong>{draft.historyMessages === 0 ? 'None' : `${draft.historyMessages} messages`}</strong></span>
              <select
                value={draft.historyMessages}
                onChange={(event) => setDraft({ ...draft, historyMessages: Number(event.target.value) })}
              >
                {EDUAI_HISTORY_MESSAGE_OPTIONS.map((messages) => (
                  <option key={messages} value={messages}>{messages === 0 ? 'None' : `${messages} messages`}</option>
                ))}
              </select>
              <small>Recent messages from this chat help EduAI follow up. Saved chat history is unchanged.</small>
            </label>
            <label className="eduai-setting-field">
              <span>Learner names shared with the AI provider <strong>{draft.learnerNameLimit === 0 ? 'None' : `Up to ${draft.learnerNameLimit}`}</strong></span>
              <select
                value={draft.learnerNameLimit}
                onChange={(event) => setDraft({ ...draft, learnerNameLimit: Number(event.target.value) })}
              >
                {EDUAI_NAME_LIMIT_OPTIONS.map((count) => (
                  <option key={count} value={count}>{count === 0 ? 'None (most private)' : `Up to ${count} names`}</option>
                ))}
              </select>
              <small>Names are personally identifying. No student IDs, marks, contact, health, or guardian details are sent.</small>
            </label>
          </section>

          <div className="eduai-settings-footer">
            <span>Preferences are saved under your {role} account. Provider API keys are encrypted server-side and are never returned to this page.</span>
            <div>
              <button className="eduai-secondary-button" type="button" onClick={() => void reset()} disabled={saving}>Reset role defaults</button>
              <button className="eduai-send-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
            </div>
          </div>
          {error && <div className="eduai-inline-alert" role="alert">{error}</div>}
        </form>
      </section>
    </div>
  );
}
