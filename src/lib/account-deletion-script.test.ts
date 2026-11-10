import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import source from '../../functions/index.cjs?raw';

function service(role = 'Developer', targetRole = 'Teacher', status = 'Active') {
  class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  const deleteUsers = vi.fn(async () => ({ errors: [] }));
  const db = {
    collection: () => ({ doc: (uid: string) => ({
      uid, get: async () => ({ exists: true, data: () => ({ role, status }) }),
    }) }),
    getAll: async (...refs: Array<{ uid: string }>) => refs.map(() => ({ data: () => ({ role: targetRole }) })),
  };
  const modules = {
    'firebase-admin/app': { initializeApp: vi.fn() },
    'firebase-admin/auth': { getAuth: () => ({ deleteUsers }) },
    'firebase-admin/firestore': { getFirestore: () => db },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, callback) => callback },
    'firebase-functions/v2/scheduler': { onSchedule: vi.fn() },
  };
  const context = createContext({ exports: {}, require: (name: string) => modules[name], console });
  runInContext(source, context);
  return { remove: context.exports.deleteAuthUsers, deleteUsers };
}

describe('legacy privileged account deletion', () => {
  it.each(['School Admin', 'Developer'])('allows %s to delete ordinary accounts', async (role) => {
    const { remove, deleteUsers } = service(role);
    await expect(remove({ auth: { uid: 'caller' }, data: { userIds: ['teacher'] } }))
      .resolves.toEqual({ deletedUserIds: ['teacher'] });
    expect(deleteUsers).toHaveBeenCalledWith(['teacher']);
  });

  it.each(['School Admin', 'Developer'])('protects Developer targets from %s', async (role) => {
    const { remove, deleteUsers } = service(role, 'Developer');
    await expect(remove({ auth: { uid: 'caller' }, data: { userIds: ['developer'] } }))
      .rejects.toThrow(/managed manually/);
    expect(deleteUsers).not.toHaveBeenCalled();
  });

  it.each([['Teacher', 'Active'], ['Developer', 'Inactive']])('rejects %s with status %s', async (role, status) => {
    const { remove, deleteUsers } = service(role, 'Teacher', status);
    await expect(remove({ auth: { uid: 'caller' }, data: { userIds: ['teacher'] } })).rejects.toThrow(/active School Admin/);
    expect(deleteUsers).not.toHaveBeenCalled();
  });
});
