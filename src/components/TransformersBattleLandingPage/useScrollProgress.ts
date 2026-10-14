import { useEffect, useState } from 'react';
import { clamp } from '../../scene/timeline';

/** Normalised progress of the window scroll through a tall track element. */
export function trackProgress(track: HTMLElement) {
  const rect = track.getBoundingClientRect();
  const total = track.offsetHeight - window.innerHeight;
  return total > 0 ? clamp(-rect.top / total) : 0;
}

/** Scroll position (in px) at which the track reaches progress p. */
export function scrollTopFor(track: HTMLElement, p: number) {
  const top = track.getBoundingClientRect().top + window.scrollY;
  return top + p * (track.offsetHeight - window.innerHeight);
}

export function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}
