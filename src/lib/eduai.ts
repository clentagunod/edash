import { normalizedAppRole, setAppUserProfile } from './app-config';
import { auth, db } from './firebase';
import { fsGetCurrentSchoolYear, fsGetLearners } from './firestore-api';
import { buildEduAiContext, type EduAiContext, type EduAiMessage, type EduAiMessageRole } from './eduai-context';
import {
  DEFAULT_EDUAI_SETTINGS,
  normalizeEduAiSettings,
  resolveEduAiUserSettings,
  type EduAiSettings,
} from './eduai-settings';
import { getStoredSchool } from './school-registry';

export type { EduAiContext, EduAiMessage, EduAiMessageRole, EduAiRole } from './eduai-context';

const MAX_MESSAGE_LENGTH = 8000;
const MAX_USER_MESSAGE_LENGTH = 2000;
export const EDUAI_MESSAGE_PAGE_SIZE = 40;

export const EDUAI_PROVIDER_OPTIONS = [
  { id: 'groq', label: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { id: 'gemini', label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', model: 'gemini-3.8-flash' },
  { id: 'claude', label: 'Anthropic Claude', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-latest' },
  { id: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  { id: 'mistral', label: 'Mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest' },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
] as const;

export type EduAiPersonalProvider = typeof EDUAI_PROVIDER_OPTIONS[number]['id'];

export interface EduAiProviderSettings {
  provider: 'default' | EduAiPersonalProvider;
  personalProvider: EduAiPersonalProvider | '';
  model: string;
  endpoint: string;
  credentialConfigured: boolean;
  sharedConfigured: boolean;
  usage: { requests: number; inputTokens: number; outputTokens: number };
  usagePeriod: string;
}

export const DEFAULT_EDUAI_PROVIDER_SETTINGS: EduAiProviderSettings = {
  provider: 'default',
  personalProvider: '',
  model: '',
  endpoint: '',
  credentialConfigured: false,
  sharedConfigured: false,
  usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
  usagePeriod: '',
};

export interface EduAiProviderSettingsDraft {
  provider: 'default' | EduAiPersonalProvider;
  personalProvider: EduAiPersonalProvider | '';
  model: string;
  endpoint: string;
  apiKey: string;
  removeCredentials?: boolean;
}

const eduAiApiUrl = String((import.meta.env as Record<string, string | undefined>).VITE_EDUAI_API_URL || '')
  .trim()
  .replace(/\/+$/, '');

async function callEduAiApi<T>(
  path: 'settings' | 'chat',
  method: 'GET' | 'POST' | 'DELETE',
  data?: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = 120000,
): Promise<T> {
  if (!eduAiApiUrl) {
    throw new Error('EduAI API is not configured. Set VITE_EDUAI_API_URL to the deployed gateway URL.');
  }
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error('Sign in with an active school account to use EduAI.');
  const school = getStoredSchool();
  if (!school) throw new Error('Choose a school before using EduAI.');
  const token = await user.getIdToken();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${eduAiApiUrl}/${path}?schoolId=${encodeURIComponent(school.id)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: requestSignal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.error === 'string' ? payload.error : 'EduAI could not complete the request.') as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = typeof payload.code === 'string' ? payload.code : `http-${response.status}`;
    error.details = payload.details;
    throw error;
  }
  return payload as T;
}

export async function loadEduAiProviderSettings(): Promise<EduAiProviderSettings> {
  return callEduAiApi<EduAiProviderSettings>('settings', 'GET');
}

export async function saveEduAiProviderSettings(draft: EduAiProviderSettingsDraft): Promise<void> {
  if (draft.removeCredentials) {
    await callEduAiApi('settings', 'DELETE');
    return;
  }
  await callEduAiApi('settings', 'POST', {
    provider: draft.provider,
    ...(draft.provider === 'default' ? {} : {
      model: draft.model,
      endpoint: draft.endpoint,
      apiKey: draft.apiKey,
    }),
  });
}

export function isEduAiQuotaExhaustedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    code?: string;
    details?: { freeUsageExhausted?: boolean };
    customData?: { freeUsageExhausted?: boolean; details?: { freeUsageExhausted?: boolean } };
  };
  return value.details?.freeUsageExhausted === true
    || value.customData?.freeUsageExhausted === true
    || value.customData?.details?.freeUsageExhausted === true
    || value.code?.includes('resource-exhausted') === true;
}

export async function loadEduAiContext(): Promise<EduAiContext> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('Your sign-in session could not be verified. Please sign in again.');
  }

  const profileSnapshot = await db.collection('users').doc(user.uid).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : null;
  if (!profile || profile.status !== 'Active') {
    throw new Error('Your school account is not active. Contact your school administrator.');
  }
  const role = normalizedAppRole(profile.role);
  if (!['School Admin', 'Registrar', 'Teacher'].includes(role)) {
    throw new Error('Your account role is not allowed to use EduAI.');
  }

  const trustedProfile = {
    uid: user.uid,
    email: user.email || profile.email || '',
    name: typeof profile.name === 'string' ? profile.name : '',
    photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : '',
    role,
    teacherAssignment: profile.teacherAssignment || null,
    teacherAssignments: Array.isArray(profile.teacherAssignments) ? profile.teacherAssignments : [],
  };
  setAppUserProfile(trustedProfile);
  sessionStorage.setItem('lps_user_profile', JSON.stringify(trustedProfile));

  const schoolYear = await fsGetCurrentSchoolYear();
  const learners = schoolYear ? await fsGetLearners(schoolYear) : [];
  return buildEduAiContext(role, schoolYear, learners);
}

export interface EduAiUserSettings {
  settings: EduAiSettings;
  roleDefaults: EduAiSettings;
}

function eduAiUserSettingsDocument(userId: string) {
  return db.collection('users').doc(userId).collection('eduaiSettings').doc('preferences');
}

export async function loadEduAiUserSettings(userId: string, role: EduAiContext['role']): Promise<EduAiUserSettings> {
  const [tenantSettings, userSettings] = await Promise.all([
    db.collection('settings').doc('eduai').get(),
    eduAiUserSettingsDocument(userId).get(),
  ]);
  return resolveEduAiUserSettings(
    role,
    tenantSettings.exists ? tenantSettings.data() : null,
    userSettings.exists ? userSettings.data() : null,
  );
}

export async function saveEduAiUserSettings(
  userId: string,
  role: EduAiContext['role'],
  settings: EduAiSettings,
): Promise<EduAiSettings> {
  const normalized = normalizeEduAiSettings(settings);
  await eduAiUserSettingsDocument(userId).set({
    role,
    ...normalized,
    updatedAt: new Date(),
  });
  return normalized;
}

export async function resetEduAiUserSettings(userId: string): Promise<void> {
  await eduAiUserSettingsDocument(userId).delete();
}

function conversationsCollection(userId: string) {
  return db.collection('users').doc(userId).collection('eduaiConversations');
}

function timestampToIso(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

export async function listEduAiConversations(userId: string): Promise<EduAiConversation[]> {
  const snapshot = await conversationsCollection(userId).orderBy('updatedAt', 'desc').limit(25).get();
  return snapshot.docs.map((document: any) => ({
    id: document.id,
    title: String(document.data()?.title || 'New conversation'),
    updatedAt: timestampToIso(document.data()?.updatedAt),
  }));
}

export interface EduAiConversation {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface EduAiMessagePage {
  messages: EduAiMessage[];
  cursor: unknown;
  hasMore: boolean;
}

export async function loadEduAiMessages(
  userId: string,
  conversationId: string,
  cursor?: unknown,
): Promise<EduAiMessagePage> {
  const messageQuery = conversationsCollection(userId)
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'desc');
  const snapshot = await (cursor ? messageQuery.startAfter(cursor) : messageQuery)
    .limit(EDUAI_MESSAGE_PAGE_SIZE + 1)
    .get();
  const pageDocuments = snapshot.docs.slice(0, EDUAI_MESSAGE_PAGE_SIZE);
  const messages = pageDocuments.map((document: any) => {
    const data = document.data() || {};
    return {
      id: document.id,
      role: data.role === 'assistant' ? 'assistant' : 'user',
      content: String(data.content || ''),
      createdAt: timestampToIso(data.createdAt),
    };
  }).reverse();
  return {
    messages,
    cursor: pageDocuments[pageDocuments.length - 1],
    hasMore: snapshot.docs.length > EDUAI_MESSAGE_PAGE_SIZE,
  };
}

export async function createEduAiConversation(userId: string, title: string): Promise<string> {
  const timestamp = new Date();
  const reference = conversationsCollection(userId).doc();
  await reference.set({
    title: title.trim().slice(0, 80) || 'New conversation',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return reference.id;
}

export async function saveEduAiMessage(
  userId: string,
  conversationId: string,
  role: EduAiMessageRole,
  content: string,
): Promise<EduAiMessage> {
  const normalizedContent = content.trim();
  if (!normalizedContent || normalizedContent.length > MAX_MESSAGE_LENGTH) {
    throw new Error('Messages must contain between 1 and 8,000 characters.');
  }
  const conversation = conversationsCollection(userId).doc(conversationId);
  const timestamp = new Date();
  const reference = await conversation.collection('messages').add({
    role,
    content: normalizedContent,
    createdAt: timestamp,
  });
  await conversation.update({ updatedAt: timestamp });
  return { id: reference.id, role, content: normalizedContent, createdAt: timestamp.toISOString() };
}

export async function deleteEduAiConversation(userId: string, conversationId: string): Promise<void> {
  const conversation = conversationsCollection(userId).doc(conversationId);
  const messages = conversation.collection('messages');

  while (true) {
    const snapshot = await messages.limit(400).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((document: any) => batch.delete(document.ref));
    await batch.commit();
  }
  await conversation.delete();
}

export async function requestEduAiReply(
  question: string,
  history: EduAiMessage[],
  settings: EduAiSettings = DEFAULT_EDUAI_SETTINGS,
  signal?: AbortSignal,
): Promise<string> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || normalizedQuestion.length > MAX_USER_MESSAGE_LENGTH) {
    throw new Error('Enter a message of up to 2,000 characters.');
  }

  const activeSettings = normalizeEduAiSettings(settings);
  if (signal?.aborted) throw new DOMException('The request was stopped.', 'AbortError');
  const selectedHistory = activeSettings.historyMessages
    ? history.slice(-activeSettings.historyMessages)
    : [];
  const payload = await callEduAiApi<{ reply?: unknown }>('chat', 'POST', {
    question: normalizedQuestion,
    history: selectedHistory.map(({ role, content }) => ({
      role,
      content: content.slice(-2000),
    })),
    settings: activeSettings,
  }, signal, (activeSettings.timeoutSeconds + 15) * 1000);
  if (typeof payload.reply !== 'string' || !payload.reply.trim()) {
    throw new Error('EduAI returned an empty response. Please try again.');
  }
  return payload.reply.trim().slice(0, MAX_MESSAGE_LENGTH);
}