export function loadVideoWhenVisible(
  video: HTMLVideoElement,
  target: Element,
  sourceUrl: string,
): () => void {
  let started = false;
  let observer: IntersectionObserver | undefined;

  const startLoading = () => {
    if (started) return;
    started = true;
    observer?.disconnect();
    video.preload = 'metadata';
    video.src = sourceUrl;
  };

  if (typeof IntersectionObserver === 'undefined') {
    startLoading();
    return () => video.pause();
  }

  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) startLoading();
  }, { rootMargin: '240px 0px' });
  observer.observe(target);

  return () => {
    observer?.disconnect();
    video.pause();
    if (!started) video.removeAttribute('src');
  };
}