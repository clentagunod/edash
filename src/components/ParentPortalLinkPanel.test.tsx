import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/app-config', () => ({ APP_CONFIG: { schoolId: 'sample-school' } }));
import ParentPortalLinkPanel from './ParentPortalLinkPanel';

let root: Root;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('admin parent portal link', () => {
  it('shows and copies the current school’s full direct URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await act(async () => root.render(<ParentPortalLinkPanel />));
    const expected = `${window.location.origin}/parent/sample-school`;
    expect(container.querySelector('input')?.value).toBe(expected);
    expect(container.querySelector('a')?.href).toBe(expected);
    await act(async () => container.querySelector('button')!.click());
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('link copied');
  });
  it('selects the link for manual copying if clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('Blocked')) }, configurable: true });
    await act(async () => root.render(<ParentPortalLinkPanel />));
    await act(async () => container.querySelector('button')!.click());
    const input = container.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Link selected');
  });
});
