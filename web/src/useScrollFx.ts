import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Reveal-on-scroll: adds the `revealed` class to elements with the
 * `reveal` class when they enter the viewport. Pure IntersectionObserver —
 * no dependencies. Falls back to immediately-visible if IO is unsupported.
 */
export function useRevealOnScroll(): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current ?? document.body;
    // Watch BOTH single reveals and stagger containers. Missing
    // `.reveal-stagger` here previously left those sections invisible.
    const targets = root.querySelectorAll<HTMLElement>('.reveal, .reveal-stagger');

    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );

    targets.forEach((el) => observer.observe(el));

    // Safety net: anything already in view (or if the observer never fires)
    // becomes visible shortly after mount so content is never stuck hidden.
    const fallback = window.setTimeout(() => {
      targets.forEach((el) => el.classList.add('revealed'));
    }, 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return containerRef;
}

/** Scroll progress 0..1 for the top progress bar. */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, doc.scrollTop / max) : 0);
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return progress;
}
