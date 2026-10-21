import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = { startAfter: vi.fn(), limit: vi.fn(), get: vi.fn() };
  query.startAfter.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return {
    documents: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
    orderBy: vi.fn(() => query),
    startAfter: query.startAfter,
    limit: query.limit,
    get: query.get,
  };
});

vi.mock('./firebase', () => ({
  auth: { currentUser: null },
  db: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({ orderBy: mocks.orderBy }),
          }),
        }),
      }),
    }),
  },
}));
vi.mock('./app-config', () => ({ normalizedAppRole: vi.fn(), setAppUserProfile: vi.fn() }));
vi.mock('./firestore-api', () => ({ fsGetCurrentSchoolYear: vi.fn(), fsGetLearners: vi.fn() }));
vi.mock('./eduai-context', () => ({ buildEduAiContext: vi.fn() }));
vi.mock('./eduai-settings', () => ({
  DEFAULT_EDUAI_SETTINGS: {},
  normalizeEduAiSettings: vi.fn((settings) => settings),
  resolveEduAiUserSettings: vi.fn(),
}));
vi.mock('./eduai-knowledge', () => ({ buildEduAiProductGuide: vi.fn() }));

const { loadEduAiMessages, EDUAI_MESSAGE_PAGE_SIZE } = await import('./eduai');

function createMessageDocuments(ids: string[]) {
  return ids.map((id) => ({
    id,
    data: () => ({ role: 'user', content: id, createdAt: new Date(0) }),
  }));
}

describe('EduAI message pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documents = [];
    mocks.get.mockImplementation(async () => ({ docs: mocks.documents }));
  });

  it('loads the newest page first, returns chronological order, and provides an older-page cursor', async () => {
    mocks.documents = createMessageDocuments(
      Array.from({ length: EDUAI_MESSAGE_PAGE_SIZE + 1 }, (_, index) => `message-${50 - index}`),
    );

    const latestPage = await loadEduAiMessages('user-1', 'conversation-1');

    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(EDUAI_MESSAGE_PAGE_SIZE + 1);
    expect(latestPage.messages).toHaveLength(EDUAI_MESSAGE_PAGE_SIZE);
    expect(latestPage.messages[0].id).toBe('message-11');
    expect(latestPage.messages.at(-1)?.id).toBe('message-50');
    expect(latestPage.cursor).toBe(mocks.documents[EDUAI_MESSAGE_PAGE_SIZE - 1]);
    expect(latestPage.hasMore).toBe(true);
  });

  it('uses the cursor to fetch older messages and reports when history is exhausted', async () => {
    const cursor = { id: 'message-11' };
    mocks.documents = createMessageDocuments(['message-10', 'message-9']);

    const olderPage = await loadEduAiMessages('user-1', 'conversation-1', cursor);

    expect(mocks.startAfter).toHaveBeenCalledWith(cursor);
    expect(olderPage.messages.map((message) => message.id)).toEqual(['message-9', 'message-10']);
    expect(olderPage.hasMore).toBe(false);
  });
});
