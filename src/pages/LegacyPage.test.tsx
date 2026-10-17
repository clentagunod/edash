import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegacyPage from './LegacyPage';

vi.mock('../lib/app-config', () => ({ appDocumentTitle: (title: string) => title }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  act(() => mountedRoots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

describe('LegacyPage React portal mounts', () => {
  it('preserves portal content in injected markup under Strict Mode', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const onMount = vi.fn();

    await act(async () => {
      root.render(
        <StrictMode>
          <LegacyPage
            html='<main><div id="templateMount"></div></main>'
            title="Admin Console"
            portalSelector="#templateMount"
            onMount={onMount}
          >
            <button type="button">Inspect template</button>
          </LegacyPage>
        </StrictMode>,
      );
    });

    expect(container.querySelector('#templateMount button')?.textContent).toBe('Inspect template');
    expect(onMount).toHaveBeenCalled();
  });
});
