import { useLayoutEffect, useRef, useState } from "react";

/** Kapsayıcının genişliği (grafikler boyutunu kapsayıcıdan alır) */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (!("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}
