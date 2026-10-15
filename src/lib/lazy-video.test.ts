import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVideoWhenVisible } from './lazy-video';

class MockIntersectionObserver {
  static instance: MockIntersectionObserver;
  readonly callback: IntersectionObserverCallback;
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instance = this;
  }

  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  intersect(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lazy video loading', () => {
  it('waits until the video approaches the viewport before requesting it', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const video = document.createElement('video');
    vi.spyOn(video, 'pause').mockImplementation(() => {});
    const target = document.createElement('div');

    const cleanup = loadVideoWhenVisible(video, target, '/assets/school/video.mp4');

    expect(video.hasAttribute('src')).toBe(false);
    expect(MockIntersectionObserver.instance.observe).toHaveBeenCalledWith(target);

    MockIntersectionObserver.instance.intersect(false);
    expect(video.hasAttribute('src')).toBe(false);

    MockIntersectionObserver.instance.intersect(true);
    expect(video.getAttribute('src')).toBe('/assets/school/video.mp4');
    expect(video.preload).toBe('metadata');
    expect(MockIntersectionObserver.instance.disconnect).toHaveBeenCalledOnce();

    cleanup();
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it('loads immediately when intersection observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const video = document.createElement('video');

    loadVideoWhenVisible(video, document.createElement('div'), '/assets/school/video.mp4');

    expect(video.getAttribute('src')).toBe('/assets/school/video.mp4');
  });
});