import { useLayoutEffect, type RefObject } from "react";

/**
 * [data-reveal] öğeleri görünür alana girince bir kez 12px yükselerek belirir.
 * İçerik önce görünür halde gelir (ön-render HTML'i); JS yoksa ya da hareket azaltılmışsa hiçbir şey gizlenmez.
 * Boyamadan önce çalışır: o an ekranda olan öğeler bir kare bile gizlenmez.
 */
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]:not([data-shown])"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.shown = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    const vh = window.innerHeight;
    for (const it of items) {
      if (it.getBoundingClientRect().top < vh) it.dataset.shown = "";
      else io.observe(it);
    }
    el.dataset.anim = "";
    return () => io.disconnect();
  }, [root]);
}
