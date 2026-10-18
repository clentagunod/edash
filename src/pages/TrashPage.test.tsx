import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => undefined),
  showToast: vi.fn(),
  fsGetTrash: vi.fn(),
  fsGetTrashRetention: vi.fn(),
  fsRestoreTrashItem: vi.fn(),
  fsPermanentlyDeleteTrashItem: vi.fn(),
  isSchoolAdmin: vi.fn(),
  isTeacher: vi.fn(),
}));

vi.mock('../lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('../lib/app-config', () => ({
  appDocumentTitle: (title: string) => title,
  isSchoolAdmin: mocks.isSchoolAdmin,
  isTeacher: mocks.isTeacher,
}));
vi.mock('../lib/shell', () => ({
  renderShell: vi.fn(),
  escapeHtml: (value: unknown) => String(value ?? ''),
  showToast: mocks.showToast,
}));
vi.mock('../lib/school-year', () => ({
  getSelectedSchoolYear: () => '2026-2027',
  initYearSwitcher: async (load: () => Promise<void>) => load(),
}));
vi.mock('../lib/firestore-api', () => ({
  fsGetTrash: mocks.fsGetTrash,
  fsGetTrashRetention: mocks.fsGetTrashRetention,
  fsRestoreTrashItem: mocks.fsRestoreTrashItem,
  fsPermanentlyDeleteTrashItem: mocks.fsPermanentlyDeleteTrashItem,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import TrashPage from './TrashPage';

const items = [
  {
    trashId: 'trash-1',
    learnerId: 'LRN-001',
    sourceCollection: 'learners',
    learner: { firstName: 'Ana', lastName: 'Cruz' },
    deletedAt: '2026-10-17T00:00:00.000Z',
  },
  {
    trashId: 'trash-2',
    learnerId: 'LRN-002',
    sourceCollection: 'learners',
    learner: { firstName: 'Ben', lastName: 'Santos' },
    deletedAt: '2026-10-16T00:00:00.000Z',
  },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.requireAuth.mockResolvedValue(undefined);
  mocks.isSchoolAdmin.mockReturnValue(true);
  mocks.isTeacher.mockReturnValue(false);
  mocks.fsGetTrashRetention.mockResolvedValue('30');
  mocks.fsGetTrash.mockResolvedValue(items);
  mocks.fsRestoreTrashItem.mockResolvedValue({ restored: true });
  mocks.fsPermanentlyDeleteTrashItem.mockResolvedValue({ deleted: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function renderTrashPage(strict = false) {
  await act(async () => {
    root.render(strict
      ? createElement(StrictMode, null, createElement(TrashPage))
      : createElement(TrashPage));
  });
}

describe('Trash access', () => {
  it('allows a teacher to view their assignment-scoped Trash', async () => {
    mocks.isSchoolAdmin.mockReturnValue(false);
    mocks.isTeacher.mockReturnValue(true);

    await renderTrashPage();

    expect(mocks.fsGetTrash).toHaveBeenCalledWith('2026-2027');
    expect(container.querySelector('#trashRows')?.textContent).toContain('Ana Cruz');
  });
});

describe('Trash bulk selection', () => {
  it('restores selected items only once when mounted under React Strict Mode', async () => {
    const remainingItems = new Set(items.map(({ trashId }) => trashId));
    mocks.fsRestoreTrashItem.mockImplementation(async (_year: string, trashId: string) => {
      if (!remainingItems.delete(trashId)) {
        throw new Error('This Trash item was already removed.');
      }
      return { restored: true };
    });
    await renderTrashPage(true);

    const selectAll = container.querySelector<HTMLInputElement>('#selectAllTrash')!;
    await act(async () => {
      selectAll.click();
    });
    expect(container.querySelector('#trashSelectionCount')?.textContent).toBe('2 items selected');
    expect(container.querySelector<HTMLButtonElement>('#restoreSelectedTrash')?.disabled).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('#restoreSelectedTrash')!.click();
    });

    expect(mocks.fsRestoreTrashItem).toHaveBeenCalledTimes(2);
    expect(mocks.fsRestoreTrashItem).toHaveBeenNthCalledWith(1, '2026-2027', 'trash-1');
    expect(mocks.fsRestoreTrashItem).toHaveBeenNthCalledWith(2, '2026-2027', 'trash-2');
    expect(mocks.showToast).toHaveBeenCalledWith('2 items restored.', 'success');
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      'error',
    );
  });

  it('confirms before permanently deleting selected items', async () => {
    await renderTrashPage();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      container.querySelector<HTMLInputElement>('#selectAllTrash')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('#deleteSelectedTrash')!.click();
    });

    expect(window.confirm).toHaveBeenCalledWith(
      'Permanently delete 2 selected Trash items? This cannot be undone.',
    );
    expect(mocks.fsPermanentlyDeleteTrashItem).toHaveBeenNthCalledWith(1, '2026-2027', 'trash-1');
    expect(mocks.fsPermanentlyDeleteTrashItem).toHaveBeenNthCalledWith(2, '2026-2027', 'trash-2');
  });
});
