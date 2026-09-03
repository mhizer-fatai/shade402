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
    const targets = root.querySelectorAll<HTMLElement>('.reveal, .reveal-stagger');

    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Animate in when scrolled into view, and back out when it leaves,
          // so sections re-animate every time the user scrolls past them.
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
          } else {
            entry.target.classList.remove('revealed');
          }
        }
      },
      // Small threshold so it triggers close to the viewport edges, and a
      // rootMargin that keeps it "in range" while the section is visible.
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
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
