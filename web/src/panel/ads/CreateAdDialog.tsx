import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, ImagePlus, Rocket } from "lucide-react";
import { api, errMsg, type Channel, type Media } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Empty, Modal, useToast } from "../../components/ui";

const CTAS = ["LEARN_MORE", "SHOP_NOW", "ORDER_NOW", "SIGN_UP", "CONTACT_US", "GET_OFFER", "SUBSCRIBE", "DOWNLOAD", "APPLY_NOW", "BOOK_TRAVEL", "WHATSAPP_MESSAGE"] as const;
type Cta = (typeof CTAS)[number];

interface Result {
  campaignId: string;
  name: string;
  status: "paused";
  manageUrl: string;
}

/**
 * Meta: sıfırdan bağlantı reklamı. Görsel medya kütüphanesinden seçilir; kampanya, reklam seti, kreatif ve reklam
 * DURAKLATILMIŞ oluşturulur. Sağda reklamın akıştaki görünümünün yaklaşık önizlemesi.
 */
export function CreateAdDialog({ accountId, currency, onClose }: { accountId: string; currency: string; onClose: () => void }) {
  const { t, intl } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels"), staleTime: 60_000 });
  const media = useQuery({ queryKey: ["media", "images"], queryFn: () => api.get<Media[]>("/api/media?kind=image&limit=60") });
  const pages = (channels.data ?? []).filter((c) => c.provider === "facebook");
  const [objective, setObjective] = useState<"traffic" | "awareness">("traffic");
  const [pageId, setPageId] = useState("");
  const page = pages.find((p) => p.id === pageId) ?? pages[0] ?? null;
  const ig = useMemo(() => (channels.data ?? []).find((c) => c.provider === "instagram" && page && c.metadata.pageId === page.externalId) ?? null, [channels.data, page]);
  const [fb, setFb] = useState(true);
  const [igOn, setIgOn] = useState(true);
  const [mediaId, setMediaId] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [link, setLink] = useState("https://");
  const [cta, setCta] = useState<Cta>("LEARN_MORE");
  const [budget, setBudget] = useState("150");
  const [days, setDays] = useState("7");
  const [countries, setCountries] = useState("TR");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [done, setDone] = useState<Result | null>(null);

  const ctaLabel: Record<Cta, string> = {
    LEARN_MORE: t("Daha fazla bilgi"),
    SHOP_NOW: t("Hemen alışveriş yap"),
    ORDER_NOW: t("Sipariş ver"),
    SIGN_UP: t("Kaydol"),
    CONTACT_US: t("Bize ulaşın"),
    GET_OFFER: t("Teklifi al"),
    SUBSCRIBE: t("Abone ol"),
    DOWNLOAD: t("İndir"),
    APPLY_NOW: t("Hemen başvur"),
    BOOK_TRAVEL: t("Rezervasyon yap"),
    WHATSAPP_MESSAGE: t("WhatsApp'tan yaz"),
  };
  const img = (media.data ?? []).find((m) => m.id === mediaId) ?? null;
  const useIg = igOn && Boolean(ig);
  const codes = countries
    .toUpperCase()
    .split(/[\s,;]+/)
    .filter(Boolean);
  const b = Number(budget.replace(",", "."));
  const n = Number(days);
  const a1 = Number(ageMin);
  const a2 = Number(ageMax);
  const linkOk = /^https:\/\/[^\s.]+\.[^\s]+$/i.test(link.trim());
  const problems = [
    !page && t("Bağlı bir Facebook Sayfası gerekli"),
    !fb && !useIg && t("En az bir yerleşim seç"),
    !img && t("Görsel seç"),
    !message.trim() && t("Reklam metnini yaz"),
    !headline.trim() && t("Başlık yaz"),
    !linkOk && t("Bağlantı https:// ile başlamalı"),
    !(b > 0) && t("Günlük bütçe gir"),
    !(Number.isInteger(n) && n >= 1 && n <= 90) && t("Süre 1–90 gün olmalı"),
    !(codes.length && codes.length <= 25 && codes.every((c) => /^[A-Z]{2}$/.test(c))) && t("Ülke kodlarını kontrol et"),
    !(a1 >= 18 && a2 <= 65 && a1 <= a2) && t("Yaş aralığını kontrol et"),
  ].filter(Boolean) as string[];
  const money = (v: number) => new Intl.NumberFormat(intl, { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  const host = (() => {
    try {
      return new URL(link).hostname.replace(/^www\./, "").toUpperCase();
    } catch {
      return "";
    }
  })();

  const m = useMutation({
    mutationFn: () =>
      api.post<Result>(`/api/ads/${accountId}/create`, {
        objective,
        pageChannelId: page!.id,
        facebook: fb,
        instagram: useIg,
        mediaId: img!.id,
        message: message.trim(),
        headline: headline.trim(),
        link: link.trim(),
        cta,
        dailyBudget: b,
        days: n,
        countries: codes,
        ageMin: a1,
        ageMax: a2,
      }),
    onSuccess: (r) => {
      setDone(r);
      qc.invalidateQueries({ queryKey: ["ads"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  if (done)
    return (
      <Modal
        title={t("Reklam hazır")}
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            {t("Tamam")}
          </button>
        }
      >
        <div className="ads-boost-done">
          <CheckCircle2 aria-hidden="true" />
          <p>{t("“{name}” kampanyası, reklam seti ve reklamı duraklatılmış olarak oluşturuldu. Harcama, kampanyayı Kampanyalar listesinden ya da Reklam Yöneticisi'nden başlattığında başlar.", { name: done.name })}</p>
          <a className="btn" href={done.manageUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" /> {t("Reklam Yöneticisi'nde aç")}
          </a>
        </div>
      </Modal>
    );

  return (
    <Modal
      title={t("Yeni Meta reklamı")}
      onClose={onClose}
      large
      footer={
        <>
          <span className="muted small ads-boost-sum">{problems.length ? problems[0] : t("Toplam en fazla {total} · duraklatılmış oluşturulur", { total: money(b * n) })}</span>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={problems.length > 0 || m.isPending} onClick={() => m.mutate()}>
            <Rocket aria-hidden="true" /> {m.isPending ? t("Oluşturuluyor…") : t("Duraklatılmış oluştur")}
          </button>
        </>
      }
    >
      {!pages.length && !channels.isLoading ? (
        <Empty
          title={t("Bağlı Facebook Sayfası yok")}
          text={t("Meta reklamları bir Facebook Sayfası adına yayınlanır. Önce Sayfanı bağla.")}
          action={
            <Link className="btn btn-primary" to="/app/channels">
              {t("Kanal bağla")}
            </Link>
          }
        />
      ) : (
        <div className="ad-new">
          <div className="ad-form">
            <div className="field">
              <span className="ads-boost-age-l" id="ad-obj">
                {t("Hedef")}
              </span>
              <div className="segmented" role="group" aria-labelledby="ad-obj">
                <button type="button" className={objective === "traffic" ? "active" : ""} aria-pressed={objective === "traffic"} onClick={() => setObjective("traffic")}>
                  {t("Trafik (bağlantı tıklaması)")}
                </button>
                <button type="button" className={objective === "awareness" ? "active" : ""} aria-pressed={objective === "awareness"} onClick={() => setObjective("awareness")}>
                  {t("Bilinirlik (erişim)")}
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ad-page">{t("Facebook Sayfası")}</label>
              <select id="ad-page" className="select" value={page?.id ?? ""} onChange={(e) => setPageId(e.target.value)}>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="ad-places">
              <legend>{t("Yerleşim")}</legend>
              <label className="check">
                <input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} /> Facebook
              </label>
              <label className="check" title={ig ? "" : t("Bu Sayfaya bağlı Instagram işletme hesabı bağlı değil")}>
                <input type="checkbox" checked={useIg} disabled={!ig} onChange={(e) => setIgOn(e.target.checked)} /> Instagram {ig ? `(@${ig.username ?? ig.name})` : `(${t("bağlı hesap yok")})`}
              </label>
            </fieldset>
            <fieldset className="ad-media">
              <legend>{t("Görsel (medya kütüphanesi)")}</legend>
              {media.isLoading ? (
                <p className="muted small">{t("Yükleniyor…")}</p>
              ) : !(media.data ?? []).length ? (
                <p className="muted small">
                  <ImagePlus aria-hidden="true" /> {t("Kütüphanede görsel yok.")} <Link to="/app/media">{t("Medya yükle")}</Link>
                </p>
              ) : (
                <ul>
                  {(media.data ?? []).map((x) => (
                    <li key={x.id}>
                      <label className={mediaId === x.id ? "on" : ""}>
                        <input type="radio" name="ad-img" className="sr-only" checked={mediaId === x.id} onChange={() => setMediaId(x.id)} />
                        <img src={x.url} alt={x.altText ?? x.originalName} loading="lazy" />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="field">
              <label htmlFor="ad-msg">{t("Reklam metni")}</label>
              <textarea id="ad-msg" className="input" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <div className="ad-two">
              <div className="field">
                <label htmlFor="ad-head">{t("Başlık")}</label>
                <input id="ad-head" className="input" maxLength={100} value={headline} onChange={(e) => setHeadline(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ad-cta">{t("Düğme")}</label>
                <select id="ad-cta" className="select" value={cta} onChange={(e) => setCta(e.target.value as Cta)}>
                  {CTAS.map((c) => (
                    <option key={c} value={c}>
                      {ctaLabel[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ad-link">{t("Bağlantı")}</label>
              <input id="ad-link" className="input" inputMode="url" value={link} aria-invalid={!linkOk} onChange={(e) => setLink(e.target.value)} />
            </div>
            <div className="ad-two">
              <div className="field">
                <label htmlFor="ad-budget">{t("Günlük bütçe ({c})", { c: currency })}</label>
                <input id="ad-budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ad-days">{t("Süre (gün)")}</label>
                <input id="ad-days" className="input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>
            <div className="ad-two">
              <div className="field">
                <label htmlFor="ad-cc">{t("Ülkeler (ISO kodu)")}</label>
                <input id="ad-cc" className="input" value={countries} onChange={(e) => setCountries(e.target.value)} />
              </div>
              <div className="field">
                <span className="ads-boost-age-l" id="ad-age">
                  {t("Yaş aralığı")}
                </span>
                <div className="ads-boost-age" role="group" aria-labelledby="ad-age">
                  <input className="input" type="number" min={18} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} aria-label={t("En düşük yaş")} />
                  <span aria-hidden="true">–</span>
                  <input className="input" type="number" min={18} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} aria-label={t("En yüksek yaş")} />
                </div>
              </div>
            </div>
          </div>

          <aside className="ad-preview" aria-label={t("Önizleme")}>
            <span className="muted small">{t("Önizleme (yaklaşık)")}</span>
            <div className="ad-card">
              <div className="ad-card-head">
                <span className="ad-card-av" aria-hidden="true">
                  {(page?.name ?? "?").slice(0, 1)}
                </span>
                <span>
                  <strong>{page?.name ?? t("Sayfa")}</strong>
                  <span className="muted small">{t("Sponsorlu")}</span>
                </span>
              </div>
              <p className="ad-card-msg">{message || t("Reklam metnin burada görünür.")}</p>
              <div className="ad-card-img">{img ? <img src={img.url} alt="" /> : <span className="muted small">{t("Görsel seç")}</span>}</div>
              <div className="ad-card-foot">
                <span>
                  <span className="muted small">{host || "ORNEK.COM"}</span>
                  <strong>{headline || t("Başlık")}</strong>
                </span>
                <span className="ad-card-cta">{ctaLabel[cta]}</span>
              </div>
            </div>
            <p className="ads-boost-note small">{t("Kampanya, reklam seti ve reklam DURAKLATILMIŞ oluşturulur; sen başlatana kadar hiçbir harcama yapılmaz. Meta reklamı yayından önce ayrıca inceler.")}</p>
          </aside>
        </div>
      )}
    </Modal>
  );
}
