import type { CSSProperties } from "react";
import { Bot } from "lucide-react";
import { CORE_PLATFORMS } from "../../../config/site";
import { platformName, type PlatformKey } from "../../../landing/PlatformIcon";
import { useSite } from "../../lib/useSite";
import { Composer } from "../ui/Composer";
import { Dot, Glyph, inkColor } from "../ui/primitives";

/**
 * İmza bölümünün beş sahnesi. Hepsi dekoratiftir (aria-hidden üst öğede); anlam adım metnindedir.
 * Temel stil son durumdur: hareket yalnızca canlı modda, sahne etkin değilken başlangıç durumunu ekler.
 */

const vars = (v: Record<string, string | number>) => v as CSSProperties;
const shortName = (p: PlatformKey) => platformName(p).replace(" (Twitter)", "");

/* 0 · Dokuz sekme, dokuz giriş */
const TAB_SPOTS: Array<[number, number, number]> = [
  [4, 16, -5],
  [50, 10, 4],
  [26, 30, -2],
  [58, 34, 6],
  [6, 50, 3],
  [44, 55, -6],
  [16, 72, 5],
  [56, 76, -3],
  [30, 88, 2],
];
const UNREAD: Partial<Record<PlatformKey, number>> = { instagram: 3, whatsapp: 5, x: 2 };

function TabsScene() {
  const { c } = useSite();
  return (
    <div className="s-scene__in s-tabs">
      <span className="s-scene__label">{c.journey.scene.tabsOpen}</span>
      {CORE_PLATFORMS.map((p, i) => {
        const [x, y, r] = TAB_SPOTS[i];
        return (
          <span key={p} className="s-tab" style={vars({ "--x": `${x}%`, "--y": `${y}%`, "--r": `${r}deg`, "--i": i })}>
            <Glyph p={p} size={14} />
            {shortName(p)}
            {UNREAD[p] && <b>{UNREAD[p]}</b>}
          </span>
        );
      })}
    </div>
  );
}

/* 1 · Bir kez yaz */
function WriteScene() {
  return (
    <div className="s-scene__in s-scene__center">
      <Composer variant="scene" />
    </div>
  );
}

/* 2 · Her kanala kendi sürümü: sayaç gerçek metin uzunluğu / platformun gerçek sınırı */
const LIMITS: Partial<Record<PlatformKey, number>> = { x: 280, threads: 500, instagram: 2200, linkedin: 3000 };

function VersionsScene() {
  const { c, locale } = useSite();
  const fmt = (n: number) => n.toLocaleString(locale === "en" ? "en-GB" : "tr-TR");
  return (
    <div className="s-scene__in s-versions">
      <div className="s-versions__grid">
        {c.journey.scene.versions.map((v, i) => {
          const max = LIMITS[v.p] ?? 0;
          const len = v.text.length;
          return (
            <div key={v.p} className="s-ver" style={vars({ "--i": i, "--w": max ? Math.max(0.04, len / max).toFixed(3) : 0 })}>
              <div className="s-ver__top">
                <Glyph p={v.p} size={14} />
                <b>{shortName(v.p)}</b>
                <span className="s-ver__count">
                  {fmt(len)}/{fmt(max)}
                </span>
              </div>
              <p className="s-ver__text">{v.text}</p>
              <span className="s-ver__bar">
                <i />
              </span>
              {i === 0 && <Dot className="s-ver__dot" />}
            </div>
          );
        })}
      </div>
      <p className="s-scene__foot">{c.journey.scene.limitNote}</p>
    </div>
  );
}

/* 3 · Boş saate yerleşir: Cuma 19:00 hero'daki "sonraki boş saat" ile aynı */
const BUSY = new Set(["0-0", "0-2", "2-1", "3-0", "4-1", "5-0", "6-2"]);
const ADDED: Record<string, PlatformKey> = { "1-0": "x", "3-1": "linkedin", "4-2": "instagram", "5-2": "threads" };
const NEXT_SLOT = "4-2";

function CalendarScene() {
  const { c } = useSite();
  const s = c.journey.scene;
  let n = 0;
  return (
    <div className="s-scene__in s-cal">
      <div className="s-cal__grid">
        <span />
        {s.days.map((d) => (
          <span key={d} className="s-cal__day">
            {d}
          </span>
        ))}
        {s.times.map((time, ti) => (
          <div key={time} className="s-cal__row">
            <span className="s-cal__time">{time}</span>
            {s.days.map((d, di) => {
              const key = `${di}-${ti}`;
              const p = ADDED[key];
              if (p) {
                const i = n++;
                return (
                  <span key={d} className="s-cal__c s-cal__c--new" style={vars({ "--i": i, "--c": inkColor(p) })}>
                    <Glyph p={p} size={14} />
                    {key === NEXT_SLOT && <Dot className="s-cal__dot" />}
                  </span>
                );
              }
              return <span key={d} className={`s-cal__c${BUSY.has(key) ? " s-cal__c--busy" : ""}`} />;
            })}
          </div>
        ))}
      </div>
      <div className="s-cal__legend">
        <span>
          <i className="s-cal__c s-cal__c--busy" />
          {s.busy}
        </span>
        <span>
          <i className="s-cal__c s-cal__c--new" />
          {s.added}
        </span>
      </div>
    </div>
  );
}

/* 4 · Yanıtlar tek kutuda */
function InboxScene() {
  const { c } = useSite();
  const s = c.journey.scene;
  return (
    <div className="s-scene__in s-inbox">
      {s.messages.map((m, i) => (
        <div key={m.who} className="s-inbox__group">
          <div className="s-msg" style={vars({ "--i": i * 2 })}>
            <span className="s-msg__icon">
              <Glyph p={m.p} size={14} />
            </span>
            <span className="s-msg__body">
              <small>
                {shortName(m.p)} · {m.who}
              </small>
              {m.text}
            </span>
            {i === 0 && <Dot className="s-msg__dot" />}
          </div>
          {i === 0 && (
            <div className="s-msg s-msg--auto" style={vars({ "--i": 1 })}>
              <span className="s-msg__icon">
                <Bot />
              </span>
              <span className="s-msg__body">
                <small>{s.autoLabel}</small>
                {s.autoText}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const JOURNEY_SCENES = [TabsScene, WriteScene, VersionsScene, CalendarScene, InboxScene] as const;
