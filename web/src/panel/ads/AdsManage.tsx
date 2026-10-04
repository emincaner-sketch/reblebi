import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Lightbulb, Pause, Play, Rocket } from "lucide-react";
import { api, errMsg, type ProviderId as ChannelProvider } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFmt } from "../../lib/session";
import { Empty, Modal, ProviderIcon, useToast } from "../../components/ui";
import { fmtNum } from "../charts/format";
import type { AnalyticsReport } from "../analytics/types";

type Num = number | null;
export type CampaignStatus = "active" | "paused" | "other" | null | undefined;

/* ---------------- Kampanya durumu (duraklat / başlat) ---------------- */

export function CampaignStatusCell({ accountId, campaignId, name, status, canManage }: { accountId: string; campaignId: string; name: string; status: CampaignStatus; canManage: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (next: "active" | "paused") => api.post<{ status: "active" | "paused" }>(`/api/ads/${accountId}/campaigns/${encodeURIComponent(campaignId)}/status`, { status: next }),
    onSuccess: (r) => {
      toast(r.status === "active" ? t("Kampanya başlatıldı") : t("Kampanya duraklatıldı"), "ok");
      qc.invalidateQueries({ queryKey: ["ads"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const label = status === "active" ? t("Yayında") : status === "paused" ? t("Duraklatıldı") : status === "other" ? t("Kapalı") : "—";
  return (
    <span className="ads-status">
      <span className={`ads-pill ads-pill--${status ?? "none"}`}>
        {status === "active" ? <Play aria-hidden="true" /> : status === "paused" ? <Pause aria-hidden="true" /> : null}
        {label}
      </span>
      {canManage && (status === "active" || status === "paused") && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={m.isPending}
          aria-label={status === "active" ? t("{name} kampanyasını duraklat", { name }) : t("{name} kampanyasını başlat", { name })}
          onClick={() => {
            if (status === "active") m.mutate("paused");
            else if (confirm(t("“{name}” kampanyası başlatılsın mı? Reklam harcaması başlar.", { name }))) m.mutate("active");
          }}
        >
          {status === "active" ? t("Duraklat") : t("Başlat")}
        </button>
      )}
    </span>
  );
}

/* ---------------- Meta: gönderi öne çıkarma ---------------- */

interface BoostResult {
  campaignId: string;
  name: string;
  status: "paused";
  manageUrl: string;
}

export function BoostDialog({ accountId, currency, onClose }: { accountId: string; currency: string; onClose: () => void }) {
  const { t, intl } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const toast = useToast();
  const posts = useQuery({
    queryKey: ["analytics-report", "days=90"],
    queryFn: () => api.get<AnalyticsReport>("/api/analytics/report?days=90"),
    staleTime: 60_000,
  });
  const eligible = useMemo(
    () =>
      (posts.data?.posts ?? [])
        .filter((p) => (p.provider === "facebook" || p.provider === "instagram") && p.publishedAt)
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
        .slice(0, 30),
    [posts.data],
  );
  const [pick, setPick] = useState<string>("");
  const [budget, setBudget] = useState("100");
  const [days, setDays] = useState("7");
  const [countries, setCountries] = useState("TR");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [done, setDone] = useState<BoostResult | null>(null);
  const chosen = eligible.find((p) => p.targetId === pick) ?? null;
  const codes = countries
    .toUpperCase()
    .split(/[\s,;]+/)
    .filter(Boolean);
  const codesOk = codes.length > 0 && codes.length <= 25 && codes.every((c) => /^[A-Z]{2}$/.test(c));
  const b = Number(budget.replace(",", "."));
  const n = Number(days);
  const a1 = Number(ageMin);
  const a2 = Number(ageMax);
  const valid = Boolean(chosen) && b > 0 && Number.isInteger(n) && n >= 1 && n <= 30 && codesOk && a1 >= 18 && a2 <= 65 && a1 <= a2;
  const money = (v: number) =>
    new Intl.NumberFormat(intl, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  const m = useMutation({
    mutationFn: () =>
      api.post<BoostResult>(`/api/ads/${accountId}/boost`, {
        postId: chosen!.postId,
        targetId: chosen!.targetId,
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
        title={t("Öne çıkarma hazır")}
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
      title={t("Gönderiyi öne çıkar")}
      onClose={onClose}
      large
      footer={
        <>
          <span className="muted small ads-boost-sum">
            {valid
              ? t("Toplam en fazla {total} · duraklatılmış oluşturulur", {
                  total: money(b * n),
                })
              : t("Gönderi seç ve bütçeyi gir")}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button className="btn btn-primary" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
            <Rocket aria-hidden="true" /> {m.isPending ? t("Oluşturuluyor…") : t("Duraklatılmış oluştur")}
          </button>
        </>
      }
    >
      <div className="ads-boost">
        <fieldset className="ads-boost-posts">
          <legend>{t("Gönderi (son 90 gün, Facebook ve Instagram)")}</legend>
          {posts.isLoading ? (
            <p className="muted small">{t("Yükleniyor…")}</p>
          ) : !eligible.length ? (
            <Empty title={t("Öne çıkarılabilir gönderi yok")} text={t("Panelden yayınlanmış Facebook sayfa ya da Instagram işletme gönderisi gerekir.")} />
          ) : (
            <ul>
              {eligible.map((p) => (
                <li key={p.targetId}>
                  <label className={pick === p.targetId ? "on" : ""}>
                    <input type="radio" name="boost-post" checked={pick === p.targetId} onChange={() => setPick(p.targetId)} />
                    {p.provider && <ProviderIcon provider={p.provider as ChannelProvider} size={22} />}
                    <span className="ads-boost-text">
                      <span>{p.preview || t("(metin yok)")}</span>
                      <span className="muted small">
                        {p.channel} · {p.publishedAt ? f.day(p.publishedAt) : "—"}
                        {p.interactions !== null ? ` · ${t("{n} etkileşim", { n: fmtNum(p.interactions, intl) })}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <div className="ads-boost-form">
          <div className="field">
            <label htmlFor="bst-budget">{t("Günlük bütçe ({c})", { c: currency })}</label>
            <input id="bst-budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bst-days">{t("Süre (gün, en fazla 30)")}</label>
            <input id="bst-days" className="input" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bst-countries">{t("Ülkeler (ISO kodu)")}</label>
            <input id="bst-countries" className="input" value={countries} onChange={(e) => setCountries(e.target.value)} aria-invalid={!codesOk} />
            <span className="help">{t("Virgülle ayır: TR, DE, NL")}</span>
          </div>
          <div className="field">
            <span className="ads-boost-age-l" id="bst-age">
              {t("Yaş aralığı")}
            </span>
            <div className="ads-boost-age" role="group" aria-labelledby="bst-age">
              <input className="input" type="number" min={18} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} aria-label={t("En düşük yaş")} />
              <span aria-hidden="true">–</span>
              <input className="input" type="number" min={18} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} aria-label={t("En yüksek yaş")} />
            </div>
          </div>
          <p className="ads-boost-note small">{t("Hedef: gönderi etkileşimi. Kampanya, reklam seti ve reklam DURAKLATILMIŞ oluşturulur; sen başlatana kadar hiçbir harcama yapılmaz.")}</p>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Google Ads önerileri ---------------- */

interface Rec {
  resourceName: string;
  type: string;
  campaignId: string | null;
  campaignName: string | null;
  base: Record<string, number>;
  potential: Record<string, number>;
}

export function Recommendations({ accountId, currency, canManage }: { accountId: string; currency: string; canManage: boolean }) {
  const { t, intl } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["ads-recs", accountId],
    queryFn: () => api.get<{ items: Rec[] }>(`/api/ads/${accountId}/recommendations`),
    enabled: canManage,
    retry: false,
  });
  const act = useMutation({
    mutationFn: (v: { resourceName: string; action: "apply" | "dismiss" }) => api.post(`/api/ads/${accountId}/recommendations`, v),
    onSuccess: (_r, v) => {
      toast(v.action === "apply" ? t("Öneri uygulandı") : t("Öneri yoksayıldı"), "ok");
      qc.invalidateQueries({ queryKey: ["ads-recs", accountId] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const TYPES: Record<string, string> = {
    CAMPAIGN_BUDGET: t("Bütçeyi artır"),
    FORECASTING_CAMPAIGN_BUDGET: t("Bütçeyi artır"),
    MOVE_UNUSED_BUDGET: t("Kullanılmayan bütçeyi taşı"),
    KEYWORD: t("Anahtar kelime ekle"),
    USE_BROAD_MATCH_KEYWORD: t("Geniş eşlemeye geç"),
    KEYWORD_MATCH_TYPE: t("Eşleme türünü genişlet"),
    TEXT_AD: t("Reklam metni ekle"),
    RESPONSIVE_SEARCH_AD: t("Duyarlı arama reklamı ekle"),
    RESPONSIVE_SEARCH_AD_ASSET: t("Reklama başlık/açıklama ekle"),
    RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: t("Reklam gücünü artır"),
    TARGET_CPA_OPT_IN: t("Hedef EBM teklifine geç"),
    MAXIMIZE_CONVERSIONS_OPT_IN: t("Dönüşümleri en üst düzeye çıkar"),
    MAXIMIZE_CLICKS_OPT_IN: t("Tıklamaları en üst düzeye çıkar"),
    TARGET_ROAS_OPT_IN: t("Hedef ROAS teklifine geç"),
    SEARCH_PARTNERS_OPT_IN: t("Arama ağı iş ortaklarını aç"),
    SITELINK_ASSET: t("Site bağlantısı öğesi ekle"),
    CALLOUT_ASSET: t("Açıklama metni öğesi ekle"),
    CALL_ASSET: t("Telefon öğesi ekle"),
    SITELINK_EXTENSION: t("Site bağlantısı uzantısı ekle"),
    CALLOUT_EXTENSION: t("Açıklama metni uzantısı ekle"),
    CALL_EXTENSION: t("Telefon uzantısı ekle"),
    OPTIMIZE_AD_ROTATION: t("Reklam rotasyonunu optimize et"),
    DISPLAY_EXPANSION_OPT_IN: t("Görüntülü Reklam Ağı genişletmesini aç"),
    PERFORMANCE_MAX_OPT_IN: t("Performance Max'e geç"),
  };
  const typeName = (x: string) =>
    TYPES[x] ??
    x
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());
  const num = (v: Num | undefined) => (v === undefined || v === null ? "—" : fmtNum(v, intl));
  const money = (v: number | undefined) =>
    v === undefined
      ? "—"
      : new Intl.NumberFormat(intl, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(v);
  const lift = (a?: number, b?: number) => (a && b !== undefined && b > a ? ` (+${new Intl.NumberFormat(intl, { maximumFractionDigits: 0 }).format(((b - a) / a) * 100)}%)` : "");

  if (!canManage) return <p className="muted small">{t("Önerileri görmek ve uygulamak için yönetici rolü gerekir.")}</p>;
  if (q.isLoading) return <p className="muted small">{t("Yükleniyor…")}</p>;
  if (q.error)
    return (
      <p className="small" style={{ color: "var(--warn)" }}>
        {errMsg(q.error)}
      </p>
    );
  const items = q.data?.items ?? [];
  if (!items.length) return <Empty icon={<Lightbulb />} title={t("Şu an öneri yok")} text={t("Google Ads yeni bir öneri ürettiğinde burada görünür.")} />;
  return (
    <ul className="ads-recs">
      {items.map((r) => (
        <li key={r.resourceName}>
          <span className="ads-rec-icon" aria-hidden="true">
            <Lightbulb />
          </span>
          <div className="ads-rec-main">
            <strong>{typeName(r.type)}</strong>
            {r.campaignName && <span className="muted small">{t("Kampanya: {name}", { name: r.campaignName })}</span>}
            {(r.potential.clicks !== undefined || r.potential.spend !== undefined) && (
              <span className="small ads-rec-impact">
                {r.potential.clicks !== undefined &&
                  t("Haftalık tıklama: {a} → {b}{lift}", {
                    a: num(r.base.clicks),
                    b: num(r.potential.clicks),
                    lift: lift(r.base.clicks, r.potential.clicks),
                  })}
                {r.potential.spend !== undefined && (
                  <>
                    {" "}
                    ·{" "}
                    {t("Haftalık maliyet: {a} → {b}", {
                      a: money(r.base.spend),
                      b: money(r.potential.spend),
                    })}
                  </>
                )}
              </span>
            )}
          </div>
          <div className="ads-rec-actions">
            <button className="btn btn-ghost btn-sm" disabled={act.isPending} onClick={() => act.mutate({ resourceName: r.resourceName, action: "dismiss" })}>
              {t("Yoksay")}
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={act.isPending}
              onClick={() =>
                confirm(t("“{type}” önerisi Google Ads hesabına uygulansın mı? Bütçe, teklif ya da reklamlar değişebilir.", { type: typeName(r.type) })) && act.mutate({ resourceName: r.resourceName, action: "apply" })
              }
            >
              {t("Uygula")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
