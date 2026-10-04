import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Code2, Copy, Globe2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, Modal, PageHead, useLocalState, useToast } from "../components/ui";
import { BarList } from "../panel/charts/BarList";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { delta, fmtCompact, fmtDay, fmtNum } from "../panel/charts/format";
import { seriesVar } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import "../panel/analytics/competitors.css";

interface Site {
  id: string;
  domain: string;
  token: string;
  lastHitAt: string | null;
  createdAt: string;
}
interface Top {
  key: string;
  views: number;
  entries: number;
}
interface Totals {
  views: number;
  visitors: number;
  viewsPerVisitor: number | null;
  social: number;
}
interface Report {
  site: Site;
  range: { from: string; to: string; days: number; tz: string };
  totals: Totals;
  prev: Totals;
  daily: Array<{ date: string; views: number | null; visitors: number | null }>;
  pages: Top[];
  referrers: Top[];
  social: Top[];
  utm: Top[];
  campaigns: Top[];
  devices: Top[];
  browsers: Top[];
  langs: Top[];
  countries: Top[];
}

/** Web sitesi analitiği (Metricool izleme kodu): çerezsiz ziyaretçi, sayfa ve kaynak ölçümü */
export default function WebsitePage() {
  const { t, intl } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = s.can("admin");
  const [days, setDays] = useLocalState<number>("sp_site_days", 30);
  const [siteRaw, setSite] = useLocalState<string>("sp_site", "");
  const [domain, setDomain] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [adding, setAdding] = useState(false);
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api.get<{ items: Site[]; scriptUrl: string }>("/api/sites") });
  const list = sites.data?.items ?? [];
  const site = list.find((x) => x.id === siteRaw) ?? list[0] ?? null;
  const rep = useQuery({ queryKey: ["site-report", site?.id, days], queryFn: () => api.get<Report>(`/api/sites/${site!.id}/report?days=${days}`), enabled: Boolean(site) });
  const add = useMutation({
    mutationFn: () => api.post<Site>("/api/sites", { domain }),
    onSuccess: (x) => {
      setDomain("");
      setAdding(false);
      setSite(x.id);
      setShowCode(true);
      qc.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/sites/${id}`),
    onSuccess: () => (setSite(""), qc.invalidateQueries({ queryKey: ["sites"] })),
    onError: (e) => toast(errMsg(e), "err"),
  });
  const snippet = site && sites.data ? `<script defer src="${sites.data.scriptUrl}" data-site="${site.token}"></script>` : "";
  const d = rep.data;
  const num = (n: number | null) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const pct = (part: number, of: number) => (of ? `${new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format((part / of) * 100)}%` : "");
  const regionName = (() => {
    try {
      const dn = new Intl.DisplayNames([intl], { type: "region" });
      return (c: string) => dn.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  })();
  const langName = (() => {
    try {
      const dn = new Intl.DisplayNames([intl], { type: "language" });
      return (c: string) => (c === "?" ? t("Bilinmiyor") : (dn.of(c) ?? c));
    } catch {
      return (c: string) => c;
    }
  })();
  const deviceName: Record<string, string> = { mobile: t("Mobil"), tablet: t("Tablet"), desktop: t("Masaüstü"), "?": t("Bilinmiyor") };

  const addForm = (
    <form
      className="ws-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (domain.trim()) add.mutate();
      }}
    >
      <label htmlFor="ws-domain" className="sr-only">
        {t("Alan adı")}
      </label>
      <input id="ws-domain" className="input" placeholder={t("ornek.com")} value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={255} autoFocus={adding} />
      <button className="btn btn-primary" disabled={!domain.trim() || add.isPending}>
        <Plus aria-hidden="true" /> {t("Siteyi ekle")}
      </button>
    </form>
  );

  const list3 = (rows: Top[], label: (k: string) => string, by: "views" | "entries", total: number, color?: string) => (
    <BarList format={num} color={color} rows={rows.map((r) => ({ key: r.key, label: label(r.key), value: r[by], meta: pct(r[by], total) }))} />
  );

  return (
    <div className="cp ws">
      <PageHead
        title={t("Web sitesi")}
        sub={t("Sitene eklediğin küçük bir kodla ziyaretçi, sayfa ve trafik kaynaklarını ölç; sosyal ağlardan gelen ziyaretleri gör. Çerez kullanılmaz, kişisel veri saklanmaz.")}
        actions={
          site && (
            <div className="segmented" role="group" aria-label={t("Dönem")}>
              {[7, 30, 90].map((n) => (
                <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
                  {t("{n} gün", { n })}
                </button>
              ))}
            </div>
          )
        }
      />

      {sites.isLoading ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !site ? (
        <div className="card">
          <Empty icon={<Globe2 />} title={t("Web siteni bağla")} text={t("Alan adını ekle, verilen tek satırlık kodu sitenin <head> bölümüne yapıştır. Veriler birkaç dakika içinde gelmeye başlar.")} action={isAdmin ? addForm : undefined} />
          {!isAdmin && <p className="muted small" style={{ textAlign: "center" }}>{t("Site eklemek için yönetici rolü gerekir.")}</p>}
        </div>
      ) : (
        <div className="cp-body">
          <div className="card ads-bar">
            <label className="ads-acc">
              <Globe2 aria-hidden="true" />
              <span className="sr-only">{t("Site")}</span>
              <select className="input select-sm" value={site.id} onChange={(e) => setSite(e.target.value)}>
                {list.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.domain}
                  </option>
                ))}
              </select>
            </label>
            <span className="small muted">{site.lastHitAt ? t("Son ziyaret: {d}", { d: f.short(site.lastHitAt) }) : t("Henüz veri yok")}</span>
            <span className="ws-actions">
              <button className="btn btn-sm" onClick={() => setShowCode(true)}>
                <Code2 aria-hidden="true" /> {t("İzleme kodu")}
              </button>
              {isAdmin && (
                <>
                  <button className="btn btn-sm btn-ghost" onClick={() => setAdding(!adding)}>
                    <Plus aria-hidden="true" /> {t("Site ekle")}
                  </button>
                  <button className="btn btn-sm btn-ghost cp-down" onClick={() => confirm(t("{d} ve tüm istatistikleri silinsin mi?", { d: site.domain })) && remove.mutate(site.id)}>
                    <Trash2 aria-hidden="true" /> {t("Kaldır")}
                  </button>
                </>
              )}
            </span>
            {adding && isAdmin && <div className="ws-addrow">{addForm}</div>}
          </div>

          {!site.lastHitAt && (
            <div className="card ws-install">
              <h2 className="cc-title">{t("Kurulumu tamamla")}</h2>
              <p className="small">{t("Bu kodu sitenin tüm sayfalarında <head> etiketinin içine ekle. İlk ziyaret gelince bu uyarı kalkar.")}</p>
              <Snippet code={snippet} />
              <button className="btn btn-sm btn-ghost" onClick={() => (qc.invalidateQueries({ queryKey: ["sites"] }), qc.invalidateQueries({ queryKey: ["site-report"] }))}>
                <RefreshCw aria-hidden="true" /> {t("Kontrol et")}
              </button>
            </div>
          )}

          {d && (
            <>
              <div className="an-kpis">
                <StatTile label={t("Ziyaretçi")} value={compact(d.totals.visitors)} delta={delta(d.totals.visitors, d.prev.visitors)} compare note={t("günlük tekil ziyaretçilerin toplamı")} />
                <StatTile label={t("Sayfa görüntüleme")} value={compact(d.totals.views)} delta={delta(d.totals.views, d.prev.views)} compare />
                <StatTile label={t("Ziyaretçi başına sayfa")} value={d.totals.viewsPerVisitor === null ? "—" : num(d.totals.viewsPerVisitor)} delta={delta(d.totals.viewsPerVisitor, d.prev.viewsPerVisitor)} compare />
                <StatTile label={t("Sosyal ağlardan gelen")} value={compact(d.totals.social)} delta={delta(d.totals.social, d.prev.social)} compare note={d.totals.visitors ? t("ziyaretçilerin {p}", { p: pct(d.totals.social, d.totals.visitors) }) : undefined} />
              </div>

              <ChartCard
                title={t("Ziyaretçi ve sayfa görüntüleme")}
                sub={t("Günlük")}
                table={() => <SimpleTable caption={t("Ziyaretçi ve sayfa görüntüleme")} head={[t("Gün"), t("Ziyaretçi"), t("Sayfa görüntüleme")]} rows={d.daily.map((x) => [fmtDay(x.date, intl), num(x.visitors), num(x.views)])} />}
              >
                <TimeChart
                  kind="line"
                  zeroBaseline
                  dates={d.daily.map((x) => x.date)}
                  format={compact}
                  ariaLabel={t("Günlük ziyaretçi ve sayfa görüntüleme")}
                  height={200}
                  series={[
                    { key: "visitors", label: t("Ziyaretçi"), color: seriesVar(1), values: d.daily.map((x) => x.visitors) },
                    { key: "views", label: t("Sayfa görüntüleme"), color: seriesVar(7), values: d.daily.map((x) => x.views) },
                  ]}
                />
              </ChartCard>

              <div className="an-grid">
                <ChartCard title={t("En çok görüntülenen sayfalar")} sub={t("Sayfa görüntüleme")} table={() => <SimpleTable caption={t("Sayfalar")} head={[t("Sayfa"), t("Görüntüleme"), t("Giriş")]} rows={d.pages.map((p) => [p.key, num(p.views), num(p.entries)])} />}>
                  {d.pages.length ? list3(d.pages, (k) => k, "views", d.totals.views) : <p className="muted small">{t("Bu dönemde veri yok.")}</p>}
                </ChartCard>
                <ChartCard title={t("Trafik kaynakları")} sub={t("Ziyaretin geldiği site (giriş)")}>
                  {d.referrers.length ? list3(d.referrers, (k) => (k === "(doğrudan)" ? t("Doğrudan / bilinmiyor") : k), "entries", d.totals.visitors, "var(--series-3)") : <p className="muted small">{t("Bu dönemde veri yok.")}</p>}
                </ChartCard>
                <ChartCard title={t("Sosyal ağlar")} sub={t("Sosyal ağlardan gelen ziyaretçi")}>
                  {d.social.length ? list3(d.social, (k) => k, "entries", d.totals.social, "var(--series-2)") : <p className="muted small">{t("Henüz sosyal ağlardan ziyaret yok. Gönderilerindeki bağlantılara UTM eklersen kampanya bazında da görürsün.")}</p>}
                </ChartCard>
                <ChartCard title={t("UTM kaynağı ve kampanya")} sub={t("utm_source / utm_campaign")}>
                  {d.utm.length || d.campaigns.length ? (
                    <div className="ws-two">
                      <div>
                        <h3 className="an-h3">{t("Kaynak")}</h3>
                        {list3(d.utm, (k) => k, "entries", d.totals.visitors, "var(--series-4)")}
                      </div>
                      <div>
                        <h3 className="an-h3">{t("Kampanya")}</h3>
                        {list3(d.campaigns, (k) => k, "entries", d.totals.visitors, "var(--series-5)")}
                      </div>
                    </div>
                  ) : (
                    <p className="muted small">{t("UTM etiketli ziyaret yok.")}</p>
                  )}
                </ChartCard>
                <ChartCard title={t("Cihaz ve tarayıcı")} sub={t("Ziyaretçi")}>
                  <div className="ws-two">
                    <div>
                      <h3 className="an-h3">{t("Cihaz")}</h3>
                      {list3(d.devices, (k) => deviceName[k] ?? k, "entries", d.totals.visitors)}
                    </div>
                    <div>
                      <h3 className="an-h3">{t("Tarayıcı")}</h3>
                      {list3(d.browsers, (k) => (k === "Diğer" ? t("Diğer") : k), "entries", d.totals.visitors, "var(--series-7)")}
                    </div>
                  </div>
                </ChartCard>
                <ChartCard title={d.countries.length ? t("Ülke ve dil") : t("Tarayıcı dili")} sub={t("Ziyaretçi")} note={d.countries.length ? undefined : t("Ülke bilgisi yalnızca CDN (ör. Cloudflare) ülke başlığı gönderiyorsa görünür; IP adresi saklanmaz.")}>
                  <div className={d.countries.length ? "ws-two" : undefined}>
                    {d.countries.length > 0 && <div>{list3(d.countries, regionName, "entries", d.totals.visitors, "var(--series-6)")}</div>}
                    <div>{list3(d.langs, langName, "entries", d.totals.visitors, "var(--series-8)")}</div>
                  </div>
                </ChartCard>
              </div>
              <p className="small muted ws-privacy">
                <ShieldCheck aria-hidden="true" /> {t("Gizlilik: çerez ve kalıcı kimlik kullanılmaz; tekil ziyaretçi günlük değişen anahtarla hashlenerek yalnızca o gün için sayılır, hash 2 gün sonra silinir. Çoğu durumda çerez onayı gerekmez.")}
              </p>
            </>
          )}
        </div>
      )}

      {showCode && site && (
        <Modal title={t("İzleme kodu · {d}", { d: site.domain })} onClose={() => setShowCode(false)}>
          <p className="small">{t("Kodu sitenin tüm sayfalarında <head> etiketinin içine ekle:")}</p>
          <Snippet code={snippet} />
          <ul className="ws-tips small">
            <li>{t("WordPress: tema ayarlarındaki “Header kodu” alanı ya da bir header/footer eklentisi")}</li>
            <li>{t("Shopify: Online Store → Themes → Edit code → theme.liquid, </head> öncesi")}</li>
            <li>{t("Wix / Squarespace / Webflow: Ayarlar → Özel kod (Custom code) → Head")}</li>
            <li>{t("Google Tag Manager: Özel HTML etiketi, tüm sayfalarda tetiklenir")}</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}

function Snippet({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="ws-code">
      <code>{code}</code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? t("Kopyalandı") : t("Kopyala")}
      </button>
    </div>
  );
}
