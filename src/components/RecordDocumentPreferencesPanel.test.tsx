import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/firestore-api', () => ({ fsGetRecordDocumentPreferences: vi.fn(), fsSetRecordDocumentPreference: vi.fn() }));
vi.mock('../lib/school-registry', () => ({ getStoredSchool: () => null }));
vi.mock('../lib/app-config', () => ({ appBrandAssetUrl: (value: string) => value }));
import RecordDocumentPreferencesPanel from './RecordDocumentPreferencesPanel';
import { fsGetRecordDocumentPreferences, fsSetRecordDocumentPreference } from '../lib/firestore-api';
import { normalizeRecordDocumentPreferences } from '../lib/record-document-preferences';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('record document administration', () => {
  it('loads the envelope defaults and saves its configuration independently', async () => {
    const value = normalizeRecordDocumentPreferences();
    vi.mocked(fsGetRecordDocumentPreferences).mockResolvedValue(value);
    vi.mocked(fsSetRecordDocumentPreference).mockImplementation(async (_kind, input) => input as typeof value['outgoing-envelope']);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<RecordDocumentPreferencesPanel kind="outgoing-envelope" />));
      const select = container.querySelector<HTMLSelectElement>('select')!;
      expect(select.value).toBe('envelope');
      const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Save document preferences')!;
      expect(button.disabled).toBe(true);
      act(() => { select.value = 'envelope-source'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => button.click());
      expect(fsSetRecordDocumentPreference).toHaveBeenCalledWith('outgoing-envelope', expect.objectContaining({ defaultPaperSize: 'envelope-source', defaultOrientation: 'landscape' }));
      expect(button.disabled).toBe(true);
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
