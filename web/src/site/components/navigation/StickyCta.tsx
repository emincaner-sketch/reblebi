import { useEffect, useState } from "react";
import { PrimaryCta } from "../ui/primitives";

const TYPING = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';

/**
 * Mobilde başparmak alanındaki birincil CTA (768px altı, CSS ile).
 * Hero'daki CTA ekrandayken, son çağrı/footer görünürken ve klavye açıkken (yazı alanı odakta) gizlenir;
 * böylece aynı işi yapan iki buton üst üste gelmez, son alan ve odak halkası örtülmez.
 */
export function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const blockers = Array.from(document.querySelectorAll<HTMLElement>("[data-cta-zone]"));
    if (!blockers.length) return;
    const visible = new Set<Element>();
    let typing = false;
    const update = () => setShow(visible.size === 0 && !typing && window.scrollY > 120);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      update();
    });
    blockers.forEach((b) => io.observe(b));
    const onFocusIn = (e: FocusEvent) => {
      typing = (e.target as Element | null)?.matches?.(TYPING) ?? false;
      update();
    };
    const onFocusOut = () => {
      typing = false;
      update();
    };
    window.addEventListener("scroll", update, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    // Gizliyken inert: ekran okuyucu ve Tab görünmeyen butona gitmez
    <div className="s-sticky" data-show={show} inert={!show}>
      <PrimaryCta block />
    </div>
  );
}
