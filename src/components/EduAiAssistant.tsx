import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  createEduAiConversation,
  deleteEduAiConversation,
  EDUAI_PROVIDER_OPTIONS,
  listEduAiConversations,
  loadEduAiContext,
  loadEduAiMessages,
  loadEduAiProviderSettings,
  loadEduAiUserSettings,
  requestEduAiReply,
  resetEduAiUserSettings,
  saveEduAiProviderSettings,
  saveEduAiUserSettings,
  saveEduAiMessage,
  isEduAiQuotaExhaustedError,
  type EduAiContext,
  type EduAiConversation,
  type EduAiMessage,
  type EduAiMessagePage,
  type EduAiProviderSettings,
  type EduAiProviderSettingsDraft,
} from '../lib/eduai';
import EduAiSettingsDialog from './EduAiSettingsDialog';
import EduAiMessageContent from './EduAiMessageContent';
import EduAiProviderCatalog from './EduAiProviderCatalog';
import { auth } from '../lib/firebase';
import { storedAppProfile } from '../lib/app-config';
import { getRegisteredSchools, getStoredSchool } from '../lib/school-registry';
import {
  DEFAULT_EDUAI_SETTINGS,
  EDUAI_MODELS,
  defaultEduAiSettingsForRole,
  type EduAiSettings,
} from '../lib/eduai-settings';

type PageState = 'checking' | 'ready' | 'unavailable' | 'error' | 'unauthorized';

function EduAiUserAvatar({ photoURL }: { photoURL: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <span className="eduai-message-avatar" aria-hidden="true">
      {photoURL && !imageFailed ? (
        <img src={photoURL} alt="" onError={() => setImageFailed(true)} />
      ) : 'You'}
    </span>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'EduAI could not load. Please try again.';
}

export default function EduAiAssistant() {
  const [pageState, setPageState] = useState<PageState>('checking');
  const [context, setContext] = useState<EduAiContext | null>(null);
  const [conversations, setConversations] = useState<EduAiConversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<EduAiMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [providerSettings, setProviderSettings] = useState<EduAiProviderSettings>({
    provider: 'default',
    personalProvider: '',
    model: '',
    endpoint: '',
    credentialConfigured: false,
    sharedConfigured: false,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
    usagePeriod: '',
  });
  const [settings, setSettings] = useState<EduAiSettings>(DEFAULT_EDUAI_SETTINGS);
  const [roleDefaults, setRoleDefaults] = useState<EduAiSettings>(DEFAULT_EDUAI_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [freeUsageExhausted, setFreeUsageExhausted] = useState(false);
  const [profilePhotoURL, setProfilePhotoURL] = useState(
    () => storedAppProfile()?.photoURL || auth.currentUser?.photoURL || '',
  );
  const messageListRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const messageCursorRef = useRef<unknown>(undefined);
  const hasMoreMessagesRef = useRef(false);
  const loadingOlderMessagesRef = useRef(false);
  const olderMessagesRequestRef = useRef(0);
  const activeConversationIdRef = useRef('');
  const preserveScrollPositionRef = useRef<{ height: number; top: number } | null>(null);
  const userId = auth.currentUser?.uid || '';

  const initialize = async (signal?: { cancelled: boolean }) => {
    setPageState('checking');
    setError('');
    try {
      const school = getStoredSchool();
      if (!school) throw new Error('Choose a school before opening EduAI.');
      const registeredSchools = await getRegisteredSchools();
      const registeredSchool = registeredSchools.find((item) => item.id === school.id);
      if (registeredSchool?.canUseEduAI !== true) {
        if (!signal?.cancelled) setPageState('unavailable');
        return;
      }

      if (!userId) throw new Error('Your sign-in session could not be verified. Please sign in again.');
      const [nextContext, nextConversations, nextProviderSettings] = await Promise.all([
        loadEduAiContext(),
        listEduAiConversations(userId),
        loadEduAiProviderSettings(),
      ]);
      const nextPreferences = await loadEduAiUserSettings(userId, nextContext.role);
      if (signal?.cancelled) return;
      setProfilePhotoURL(storedAppProfile()?.photoURL || auth.currentUser?.photoURL || '');
      setContext(nextContext);
      setConversations(nextConversations);
      setSettings(nextPreferences.settings);
      setRoleDefaults(nextPreferences.roleDefaults);
      setProviderSettings(nextProviderSettings);
      setAssistantConfigured(nextProviderSettings.provider === 'default'
        ? nextProviderSettings.sharedConfigured
        : nextProviderSettings.credentialConfigured);
      setPageState('ready');
    } catch (loadError) {
      if (signal?.cancelled) return;
      const message = getErrorMessage(loadError);
      if (message === 'Your account role is not allowed to use EduAI.') {
        setPageState('unauthorized');
      } else {
        setError(message);
        setPageState('error');
      }
    }
  };

  useEffect(() => {
    const signal = { cancelled: false };
    void initialize(signal);
    return () => {
      signal.cancelled = true;
      activeRequestRef.current?.abort();
    };
  }, [userId]);

  useEffect(() => {
    if (pageState !== 'unavailable') return;
    document.body.classList.add('eduai-catalog-mode');
    return () => document.body.classList.remove('eduai-catalog-mode');
  }, [pageState]);

  useLayoutEffect(() => {
    const element = messageListRef.current;
    if (!element) return;
    const previousPosition = preserveScrollPositionRef.current;
    if (previousPosition) {
      element.scrollTop = previousPosition.top + element.scrollHeight - previousPosition.height;
      preserveScrollPositionRef.current = null;
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  const startNewConversation = () => {
    olderMessagesRequestRef.current += 1;
    activeConversationIdRef.current = '';
    messageCursorRef.current = undefined;
    hasMoreMessagesRef.current = false;
    loadingOlderMessagesRef.current = false;
    setHasMoreMessages(false);
    setLoadingOlderMessages(false);
    preserveScrollPositionRef.current = null;
    setConversationId('');
    setMessages([]);
    setQuestion('');
    setError('');
  };

  const refreshSchoolData = async () => {
    setBusy(true);
    setError('');
    try {
      setContext(await loadEduAiContext());
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const persistSettings = async (nextSettings: EduAiSettings, nextProviderSettings: EduAiProviderSettingsDraft) => {
    if (!userId || !context) throw new Error('Your account could not be verified. Please sign in again.');
    await saveEduAiProviderSettings(nextProviderSettings);
    const saved = await saveEduAiUserSettings(userId, context.role, nextSettings);
    const savedProvider = await loadEduAiProviderSettings();
    setSettings(saved);
    setProviderSettings(savedProvider);
    setAssistantConfigured(savedProvider.provider === 'default'
      ? savedProvider.sharedConfigured
      : savedProvider.credentialConfigured);
    setError('');
    closeSettings();
  };

  const resetSettings = async () => {
    if (!userId || !context) throw new Error('Your account could not be verified. Please sign in again.');
    await resetEduAiUserSettings(userId);
    setSettings(roleDefaults || defaultEduAiSettingsForRole(context.role));
    setError('');
    closeSettings();
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };

  const selectConversation = async (nextId: string) => {
    if (!nextId || !userId) {
      startNewConversation();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const page: EduAiMessagePage = await loadEduAiMessages(userId, nextId);
      olderMessagesRequestRef.current += 1;
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
      activeConversationIdRef.current = nextId;
      messageCursorRef.current = page.cursor;
      hasMoreMessagesRef.current = page.hasMore;
      setHasMoreMessages(page.hasMore);
      setConversationId(nextId);
      setMessages(page.messages);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setBusy(false);
    }
  };

  const loadOlderMessages = async () => {
    const activeConversationId = activeConversationIdRef.current;
    if (
      !activeConversationId ||
      !userId ||
      busy ||
      !hasMoreMessagesRef.current ||
      loadingOlderMessagesRef.current
    ) return;

    const requestId = ++olderMessagesRequestRef.current;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const page = await loadEduAiMessages(userId, activeConversationId, messageCursorRef.current);
      if (olderMessagesRequestRef.current !== requestId || activeConversationIdRef.current !== activeConversationId) return;
      messageCursorRef.current = page.cursor;
      hasMoreMessagesRef.current = page.hasMore;
      setHasMoreMessages(page.hasMore);
      const element = messageListRef.current;
      if (element) {
        preserveScrollPositionRef.current = { height: element.scrollHeight, top: element.scrollTop };
      }
      setMessages((current) => {
        const existingIds = new Set(current.map((message) => message.id).filter(Boolean));
        const olderMessages = page.messages.filter((message) => !message.id || !existingIds.has(message.id));
        return olderMessages.length ? [...olderMessages, ...current] : current;
      });
    } catch (loadError) {
      if (olderMessagesRequestRef.current === requestId) setError(getErrorMessage(loadError));
    } finally {
      if (olderMessagesRequestRef.current === requestId) {
        loadingOlderMessagesRef.current = false;
        setLoadingOlderMessages(false);
      }
    }
  };

  const removeConversation = async () => {
    const selected = conversations.find((item) => item.id === conversationId);
    if (!selected || !window.confirm(`Delete “${selected.title}” and its messages? This cannot be undone.`)) return;

    setBusy(true);
    setError('');
    try {
      await deleteEduAiConversation(userId, conversationId);
      setConversations((items) => items.filter((item) => item.id !== conversationId));
      startNewConversation();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || !context || !userId || busy || !assistantConfigured) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setBusy(true);
    setSendingMessage(true);
    setError('');
    setFreeUsageExhausted(false);
    setQuestion('');

    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        activeConversationId = await createEduAiConversation(userId, text.replace(/\s+/g, ' ').slice(0, 72));
        activeConversationIdRef.current = activeConversationId;
        setConversationId(activeConversationId);
      }

      const savedQuestion = await saveEduAiMessage(userId, activeConversationId, 'user', text);
      const history = [...messages, savedQuestion];
      setMessages(history);
      setWaitingForReply(true);
      if (controller.signal.aborted) throw new DOMException('The request was stopped.', 'AbortError');
      const reply = await requestEduAiReply(text, history.slice(0, -1), settings, controller.signal);
      setWaitingForReply(false);
      const savedReply = await saveEduAiMessage(userId, activeConversationId, 'assistant', reply);
      setMessages((current) => [...current, savedReply]);
      const updatedConversations = await listEduAiConversations(userId);
      setConversations(updatedConversations);
    } catch (sendError) {
      if (controller.signal.aborted || (sendError instanceof Error && sendError.name === 'AbortError')) {
        setError('Response stopped. Your message remains saved in this conversation.');
      } else if (isEduAiQuotaExhaustedError(sendError)) {
        setError('');
        setFreeUsageExhausted(true);
      } else {
        setError(getErrorMessage(sendError));
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      setWaitingForReply(false);
      setSendingMessage(false);
      setBusy(false);
    }
  };

  const stopResponse = () => activeRequestRef.current?.abort();

  if (pageState === 'checking') {
    return (
      <section className="eduai-state-card" role="status" aria-live="polite">
        <span className="eduai-state-spinner" aria-hidden="true" />
        <div><strong>Preparing your EduAI workspace</strong><p>Verifying school access and loading your permitted school summary.</p></div>
      </section>
    );
  }

  if (pageState === 'unavailable') {
    return (
      <section className="eduai-access-card" role="status">
        <div className="eduai-access-overview">
          <div className="eduai-access-icon" aria-hidden="true">✦</div>
          <span className="eduai-access-label">School access</span>
          <h2>Choose the right AI for your school</h2>
          <p>
            EduAI is ready to use, but this school isn’t enabled yet. Contact the E-Dash team
            to discuss adding an AI agent or selecting a provider.
          </p>
          <div className="eduai-access-note">
            <strong>Your school data stays protected</strong>
            <span>No school information is shared with a provider unless the service is approved and enabled.</span>
          </div>
        </div>
        <EduAiProviderCatalog />
      </section>
    );
  }

  if (pageState === 'unauthorized') {
    return (
      <section className="eduai-state-card" role="alert">
        <div><strong>EduAI is not available for this account</strong><p>EduAI is available to active teachers, registrars, and school administrators.</p></div>
      </section>
    );
  }

  if (pageState === 'error') {
    return (
      <section className="eduai-state-card" role="alert">
        <div><strong>EduAI could not be opened</strong><p>{error}</p></div>
        <button className="eduai-secondary-button" type="button" onClick={() => void initialize()}>Try again</button>
      </section>
    );
  }

  const currentConversation = conversations.find((item) => item.id === conversationId);
  return (
    <section className="eduai-workspace" aria-label="EduAI assistant">
      <header className="eduai-workspace-header">
        <div>
          <span className="eduai-workspace-kicker"><span aria-hidden="true">✦</span> School-aware assistant</span>
          <h2>How can I help today?</h2>
          <p>Ask about school-wide summaries, enrollment patterns, or general next steps.</p>
        </div>
        <div className="eduai-header-actions">
          <button
            ref={settingsButtonRef}
            className="eduai-settings-button"
            type="button"
            onClick={() => setSettingsOpen(true)}
            disabled={busy}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
          >
            <span aria-hidden="true">⚙</span> AI settings
          </button>
          <button className="eduai-secondary-button" type="button" onClick={() => void refreshSchoolData()} disabled={busy}>
            Refresh data
          </button>
          <label className="eduai-conversation-select">
            <span>Previous chats</span>
            <select
              value={conversationId}
              onChange={(event) => void selectConversation(event.target.value)}
              disabled={busy}
              aria-label="Open a previous EduAI chat"
            >
              <option value="">New conversation</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.title}</option>
              ))}
            </select>
          </label>
          <button className="eduai-secondary-button" type="button" onClick={startNewConversation} disabled={busy}>
            New chat
          </button>
          {currentConversation && (
            <button className="eduai-delete-button" type="button" onClick={() => void removeConversation()} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </header>

      {!assistantConfigured && (
        <div className="eduai-inline-alert" role="alert">
          <strong>Your AI provider is not ready.</strong>
          <span>Open AI settings to configure your own provider or ask your school administrator to finish shared Gemini setup.</span>
        </div>
      )}
      {error && <div className="eduai-inline-alert" role="alert">{error}</div>}
      {freeUsageExhausted && (
        <div className="eduai-quota-alert" role="alert">
          <div>
            <strong>Provider usage limit reached</strong>
            <p>Your provider reports that its free usage or account quota is exhausted. Check the provider’s usage and billing page, add credits, or wait for its quota to reset. EduAI has not switched providers automatically.</p>
          </div>
          <button className="eduai-secondary-button" type="button" onClick={() => setSettingsOpen(true)}>Review AI settings</button>
        </div>
      )}

      <div className="eduai-conversation-panel">
        <div
          className={`eduai-message-list${messages.length ? '' : ' is-empty'}`}
          ref={messageListRef}
          onScroll={(event) => {
            if (event.currentTarget.scrollTop <= 80) void loadOlderMessages();
          }}
          aria-live="polite"
        >
          {(hasMoreMessages || loadingOlderMessages) && (
            <div className="eduai-history-status" role="status" aria-live="polite">
              {loadingOlderMessages ? 'Loading earlier messages…' : 'Scroll up to load earlier messages'}
            </div>
          )}
          {messages.length === 0 ? (
            <div className="eduai-welcome">
              <span className="eduai-welcome-mark" aria-hidden="true">✦</span>
              <h3>Explore E-Dash or your school’s data</h3>
              <p>Ask for help using website features or get a summary from the information your role can access.</p>
              <div className="eduai-prompts">
                <button type="button" onClick={() => setQuestion('How do I use the Masterlist to find a learner?')}>How do I use the Masterlist?</button>
                <button type="button" onClick={() => setQuestion('Summarize the learner counts by grade level.')}>Summarize learner counts</button>
                <button type="button" onClick={() => setQuestion('Interpret the school graphs. Explain the key categories and compare relevant periods using the aggregate counts and percentages.')}>Read school graphs</button>
                <button type="button" onClick={() => setQuestion('What general support strategies could help based on these aggregate counts?')}>Suggest general strategies</button>
              </div>
            </div>
          ) : messages.map((message, index) => (
            <article
              className={`eduai-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
              key={message.id || `${message.role}-${index}`}
            >
              {message.role === 'user' ? (
                <EduAiUserAvatar photoURL={profilePhotoURL} />
              ) : (
                <span className="eduai-message-avatar eduai-assistant-avatar" aria-hidden="true">✦</span>
              )}
              <div className="eduai-message-content">
                <strong>{message.role === 'user' ? 'You' : 'EduAI'}</strong>
                {message.role === 'assistant' ? (
                  <EduAiMessageContent content={message.content} />
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            </article>
          ))}
          {busy && (
            <div className="eduai-thinking" role="status" aria-live="polite">
              <span className="eduai-state-spinner" aria-hidden="true" />
              <span>{waitingForReply ? 'Your AI provider is preparing a reply…' : 'Working…'}</span>
            </div>
          )}
        </div>

        <form className="eduai-composer" onSubmit={sendMessage}>
          <label className="eduai-sr-only" htmlFor="eduaiQuestion">Message EduAI</label>
          <textarea
            id="eduaiQuestion"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask how to use E-Dash or about your school summary…"
            maxLength={2000}
            rows={2}
            disabled={busy || !assistantConfigured}
          />
          <div className="eduai-composer-footer">
            <span>{question.length}/2,000 · {context?.role} · {context?.schoolYear || 'No current school year'}</span>
            {sendingMessage ? (
              <button className="eduai-stop-button" type="button" onClick={stopResponse} aria-label="Stop EduAI response">
                <span aria-hidden="true">■</span> Stop
              </button>
            ) : (
              <button className="eduai-send-button" type="submit" disabled={busy || !question.trim() || !assistantConfigured}>
                {busy ? 'Working…' : 'Send'}
                <span aria-hidden="true">↑</span>
              </button>
            )}
          </div>
        </form>
      </div>

      <footer className="eduai-privacy-note">
        <span aria-hidden="true">ⓘ</span>
        <p>
          {settings.learnerNameLimit === 0
            ? 'No learner names are included in AI provider requests.'
            : `Only aggregate counts and up to ${settings.learnerNameLimit} learner names are included.`}
          {' '}No individual assessment, health, marks, IDs, contacts, or guardian details are sent; category counts and percentages from school graphs are included. Refresh data to include recent changes.
          {' '}{providerSettings.provider === 'default'
            ? 'The school-managed Gemini provider processes requests under the school’s Google AI Studio account.'
            : 'Your selected provider processes requests using your API key; review that provider’s privacy and retention terms.'}
          {' '}Use only with school approval and avoid sharing sensitive details.
        </p>
      </footer>
      <div className="eduai-active-settings" aria-live="polite">
        Using {providerSettings.provider === 'default'
          ? (EDUAI_MODELS.find((model) => model.id === settings.model)?.label || settings.model)
          : `${EDUAI_PROVIDER_OPTIONS.find(({ id }) => id === providerSettings.personalProvider)?.label || providerSettings.personalProvider} · ${providerSettings.model}`}
        {' · '}{settings.maxOutputTokens} max reply tokens
        {' · '}{settings.timeoutSeconds}s timeout
      </div>
      {settingsOpen && context && (
        <EduAiSettingsDialog
          settings={settings}
          roleDefaults={roleDefaults}
          role={context.role}
          providerSettings={providerSettings}
          onClose={closeSettings}
          onSave={persistSettings}
          onReset={resetSettings}
        />
      )}
    </section>
  );
}
