import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), reject: vi.fn() }));
vi.mock('../lib/school-logo-cache', () => ({ cachedSchoolLogoSource: mocks.load, rejectCachedSchoolLogo: mocks.reject }));
import SchoolLogo from './SchoolLogo';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('school logos', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.load.mockResolvedValue('data:image/png;base64,bG9nbw==');
    vi.stubGlobal('IntersectionObserver', undefined);
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
  it('displays a cached school logo with fixed dimensions and asynchronous decoding', async () => {
    await act(async () => root.render(<SchoolLogo name="San Roque ES" logoUrl="https://images.test/san-roque.png" />));
    expect(host.querySelector('img')?.src).toBe('data:image/png;base64,bG9nbw==');
    expect(host.querySelector('img')?.getAttribute('width')).toBe('36');
    expect(host.querySelector('img')?.getAttribute('decoding')).toBe('async');
    expect(host.querySelector('img')?.alt).toBe('');
  });
  it('does not download logos in closed suggestions and loads when opened', async () => {
    await act(async () => root.render(<SchoolLogo name="San Roque ES" logoUrl="https://images.test/san-roque.png" active={false} />));
    expect(mocks.load).not.toHaveBeenCalled(); expect(host.textContent).toBe('SR');
    await act(async () => root.render(<SchoolLogo name="San Roque ES" logoUrl="https://images.test/san-roque.png" active />));
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('waits until a suggestion is visible before requesting its logo', async () => {
    let intersect: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe = vi.fn(); disconnect = disconnect;
    });
    await act(async () => root.render(<SchoolLogo name="San Roque ES" logoUrl="https://images.test/san-roque.png" />));
    expect(mocks.load).not.toHaveBeenCalled();
    await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(mocks.load).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalled();
  });
  it('keeps initials for missing or broken images', async () => {
    await act(async () => root.render(<SchoolLogo name="San Roque ES" />));
    expect(host.textContent).toBe('SR'); expect(mocks.load).not.toHaveBeenCalled();
    await act(async () => root.render(<SchoolLogo name="San Roque ES" logoUrl="https://images.test/broken.png" />));
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toBe('SR');
    expect(mocks.reject).toHaveBeenCalledWith('https://images.test/broken.png');
  });
  it('does not apply an outdated download after the school logo changes', async () => {
    let finishOld: (source: string) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await act(async () => root.render(<SchoolLogo name="School" logoUrl="https://images.test/old.png" />));
    await act(async () => root.render(<SchoolLogo name="School" logoUrl="https://images.test/new.png" />));
    await act(async () => finishOld('data:image/png;base64,b2xk'));
    expect(host.querySelector('img')?.src).toBe('data:image/png;base64,bG9nbw==');
  });
});
