import { useEffect, useRef, type RefObject } from "react";

export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  options?: IntersectionObserverInit
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      el.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, ...options }
    );

    // Observe the element itself and any children with .reveal-on-scroll
    if (el.classList.contains("reveal-on-scroll")) {
      observer.observe(el);
    }
    const children = el.querySelectorAll(".reveal-on-scroll");
    children.forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, []);

  return ref;
}
