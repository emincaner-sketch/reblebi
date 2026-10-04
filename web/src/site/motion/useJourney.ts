import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * İmza bölümünün ilerleme motoru (GSAP yerine, BRAND_DECISIONS.md "Stack farkı").
 * - Pin CSS'te: [data-live] iken iz uzar, sahne position: sticky ile sabitlenir.
 * - Bölüm yaklaşınca (IntersectionObserver) passive scroll dinlenir; rAF başına bir ölçüm yapılır.
 * - İlerleme yalnızca scroll konumunun fonksiyonu: geri kaydırınca adımlar tersine döner, atlanırsa son durum doğrudur.
 * - --p (0..1) doğrudan DOM'a yazılır (her karede React çizimi yok); adım değişince state güncellenir (en fazla 5 kez).
 * - Hareket azaltılmışsa ya da ekran kısa (yatay telefon) ise canlı mod hiç açılmaz: içerik sıralı liste kalır.
 */
const STATIC_QUERY = "(prefers-reduced-motion: reduce), (max-height: 559px)";

export function useJourney(trackRef: RefObject<HTMLElement | null>, count: number) {
  const [live, setLive] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !("IntersectionObserver" in window)) return;
    const mq = window.matchMedia(STATIC_QUERY);
    let raf = 0;
    let listening = false;
    let last = -1;

    const measure = () => {
      raf = 0;
      const stage = track.firstElementChild as HTMLElement | null;
      const total = track.offsetHeight - (stage?.offsetHeight ?? window.innerHeight);
      const top = track.getBoundingClientRect().top;
      const p = total > 0 ? Math.min(1, Math.max(0, -top / total)) : 0;
      track.style.setProperty("--p", p.toFixed(4));
      const s = Math.min(count - 1, Math.floor(p * count));
      if (s !== last) {
        last = s;
        setStep(s);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const listen = (on: boolean) => {
      if (on === listening) return;
      listening = on;
      if (on) {
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        schedule();
      } else {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
      }
    };
    const io = new IntersectionObserver(([e]) => listen(e.isIntersecting), { rootMargin: "25% 0px" });

    const apply = () => {
      if (mq.matches) {
        io.disconnect();
        listen(false);
        track.style.removeProperty("--p");
        last = -1;
        setLive(false);
      } else {
        setLive(true);
        io.observe(track);
        schedule();
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      io.disconnect();
      listen(false);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [trackRef, count]);

  /** Adım düğmesi: o adımın ortasına kaydırır (kullanıcı başlatır; scroll ele geçirilmez) */
  const goTo = useCallback(
    (i: number) => {
      const track = trackRef.current;
      const stage = track?.firstElementChild as HTMLElement | null;
      if (!track || !stage) return;
      const total = track.offsetHeight - stage.offsetHeight;
      const top = track.getBoundingClientRect().top + window.scrollY;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: top + ((i + 0.5) / count) * total, behavior: reduce ? "auto" : "smooth" });
    },
    [trackRef, count],
  );

  return { live, step, goTo };
}
