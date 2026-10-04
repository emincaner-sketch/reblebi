import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Megaphone, Plug, Plus, RefreshCw, Rocket } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, PageHead, useLocalState, useToast } from "../components/ui";
import { BrandSvg } from "../components/BrandIcons";
import { ChartCard, SimpleTable } from "../panel/charts/ChartCard";
import { DataTable, type Column } from "../panel/charts/DataTable";
import { delta, fmtCompact, fmtDay, fmtNum } from "../panel/charts/format";
import { seriesVar } from "../panel/charts/palette";
import { StatTile } from "../panel/charts/StatTile";
import { TimeChart } from "../panel/charts/TimeChart";
import "../panel/charts/charts.css";
import { BoostDialog, CampaignStatusCell, Recommendations, type CampaignStatus } from "../panel/ads/AdsManage";
import { CreateAdDialog } from "../panel/ads/CreateAdDialog";
import "../panel/analytics/competitors.css";

type Num = number | null;
type ProviderId = "meta" | "google" | "tiktok";
interface AdAccount {
  id: string;
  provider: ProviderId;
  externalId: string;
  name: string;
  currency: string | null;
  enabled: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
}
type Totals = Record<"spend" | "impressions" | "reach" | "clicks" | "linkClicks" | "conversions" | "purchases" | "leads" | "messages" | "ctr" | "cpc" | "cpm" | "costPerConversion", Num>;
type Entity = Totals & {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  extra: Record<string, unknown>;
  status?: CampaignStatus;
};
interface AdsReport {
  providers: Array<{
    id: ProviderId;
    label: string;
    configured: boolean;
    missing: string[];
    redirectUri: string;
  }>;
  accounts: AdAccount[];
  range: { from: string; to: string; days: number; tz: string };
  account: AdAccount | null;
  totals: Totals | null;
  prev: Totals | null;
  daily: Array<{
    date: string;
    spend: Num;
    impressions: Num;
    reach: Num;
    clicks: Num;
    conversions: Num;
  }>;
  campaigns: Entity[];
  groups: Entity[];
  ads: Entity[];
  keywords: Entity[];
}

const ERRORS: Record<string, string> = {
  "ads.not_configured": "Bu reklam platformu sunucuda tanımlı değil.",
  "ads.state": "Bağlantı oturumu zaman aşımına uğradı, tekrar dene.",
  "ads.no_accounts": "Bu kullanıcının erişebildiği reklam hesabı yok.",
  "ads.failed": "Reklam hesabı bağlanamadı.",
};

/** Platform işareti: Meta reklamları Facebook + Instagram'da yayınlanır; Google Ads için sade üç parçalı işaret */
function PlatformIcon({ id, size = 18 }: { id: ProviderId; size?: number }) {
  if (id === "google")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9.2" y="1.5" width="6" height="19" rx="3" transform="rotate(30 12.2 11)" fill="#FBBC04" />
        <rect x="3" y="7" width="6" height="15" rx="3" transform="rotate(-30 6 14.5)" fill="#4285F4" />
        <circle cx="5.3" cy="18.6" r="3.1" fill="#34A853" />
      </svg>
    );
  return (
    <span
      style={{
        color: id === "meta" ? "#0866FF" : "var(--text)",
        display: "inline-flex",
      }}
    >
      <BrandSvg id={id === "meta" ? "facebook" : "tiktok"} size={size} />
    </span>
  );
}

/** Reklamlar (Metricool "Ads"): Meta, Google Ads, TikTok Ads · metrikler + yönetim (yönetici rolü) */
export default function AdsPage() {
  const { t, intl } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useLocalState<number>("sp_ads_days", 30);
  const [accountId, setAccountId] = useLocalState<string>("sp_ads_account", "");
  const [tab, setTab] = useLocalState<"campaigns" | "groups" | "ads" | "keywords" | "recs">("sp_ads_tab", "campaigns");
  const [boosting, setBoosting] = useState(false);
  const [creatingAd, setCreatingAd] = useState(false);
  const q = useQuery({
    queryKey: ["ads", days, accountId],
    queryFn: () => api.get<AdsReport>(`/api/ads/report?${new URLSearchParams({ days: String(days), ...(accountId ? { accountId } : {}) })}`),
  });
  const sync = useMutation({
    mutationFn: (id: string) => api.post(`/api/ads/${id}/sync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ads"] }),
    onError: (e) => toast(errMsg(e), "err"),
  });

  // Bağlantı dönüşü: ?connected=n ya da ?error=…
  useEffect(() => {
    const err = params.get("error");
    const ok = params.get("connected");
    if (!err && !ok) return;
    if (err) toast(t(ERRORS[err] ?? ERRORS["ads.failed"]), "err");
    if (ok) toast(t("{n} reklam hesabı bağlandı; son 30 günün verisi birkaç saniye içinde gelir.", { n: ok }), "ok");
    setParams({}, { replace: true });
    setTimeout(() => qc.invalidateQueries({ queryKey: ["ads"] }), 4000);
  }, [params, setParams, t, toast, qc]);

  const d = q.data;
  const acc = d?.account ?? null;
  const cur = acc?.currency ?? "TRY";
  const money = (n: Num, digits = 2) =>
    n === null
      ? "—"
      : new Intl.NumberFormat(intl, {
          style: "currency",
          currency: cur,
          maximumFractionDigits: digits,
          minimumFractionDigits: digits,
        }).format(n);
  const num = (n: Num) => fmtNum(n, intl);
  const compact = (n: number) => fmtCompact(n, intl);
  const pct = (n: Num) => (n === null ? "—" : `%${fmtNum(n, intl)}`);
  const k = d?.totals;
  const p = d?.prev;
  const tile = (key: keyof Totals, label: string, format: (n: Num) => string, note?: string, upIsGood = true) =>
    k && k[key] !== null ? <StatTile key={key} label={label} value={format(k[key])} delta={delta(k[key], p?.[key] ?? null)} compare upIsGood={upIsGood} note={note} /> : null;
  const groupLabel = acc?.provider === "meta" ? t("Reklam setleri") : t("Reklam grupları");
  const isAdmin = s.can("admin");
  const matchLabel = (m: string) =>
    ({
      EXACT: t("Tam eşleme"),
      PHRASE: t("Sıralı eşleme"),
      BROAD: t("Geniş eşleme"),
    })[m] ?? m;

  const metricCols: Column<Entity>[] = [
    {
      key: "spend",
      label: t("Harcama"),
      align: "right",
      render: (r) => money(r.spend),
      sort: (r) => r.spend,
      csv: (r) => r.spend,
    },
    {
      key: "impressions",
      label: t("Gösterim"),
      align: "right",
      render: (r) => num(r.impressions),
      sort: (r) => r.impressions,
      csv: (r) => r.impressions,
    },
    {
      key: "reach",
      label: t("Erişim"),
      align: "right",
      render: (r) => num(r.reach),
      sort: (r) => r.reach,
      csv: (r) => r.reach,
      hidden: acc?.provider === "google",
    },
    {
      key: "clicks",
      label: t("Tıklama"),
      align: "right",
      render: (r) => num(r.clicks),
      sort: (r) => r.clicks,
      csv: (r) => r.clicks,
    },
    {
      key: "ctr",
      label: t("CTR"),
      align: "right",
      render: (r) => pct(r.ctr),
      sort: (r) => r.ctr,
      csv: (r) => r.ctr,
    },
    {
      key: "cpc",
      label: t("CPC"),
      align: "right",
      render: (r) => money(r.cpc),
      sort: (r) => r.cpc,
      csv: (r) => r.cpc,
    },
    {
      key: "cpm",
      label: t("CPM"),
      align: "right",
      render: (r) => money(r.cpm),
      sort: (r) => r.cpm,
      csv: (r) => r.cpm,
    },
    {
      key: "conversions",
      label: t("Dönüşüm"),
      align: "right",
      render: (r) => num(r.conversions),
      sort: (r) => r.conversions,
      csv: (r) => r.conversions,
    },
    {
      key: "cpa",
      label: t("Dönüşüm başı maliyet"),
      align: "right",
      render: (r) => money(r.costPerConversion),
      sort: (r) => r.costPerConversion,
      csv: (r) => r.costPerConversion,
      hidden: true,
    },
  ];
  const nameCol = (label: string, parent?: string): Column<Entity> => ({
    key: "name",
    label,
    locked: true,
    width: "34%",
    render: (r) => (
      <div>
        <strong>{r.name || t("(adsız)")}</strong>
        {parent && r.parentName && <div className="muted small">{`${parent}: ${r.parentName}`}</div>}
        {typeof r.extra.matchType === "string" && <div className="muted small">{matchLabel(r.extra.matchType)}</div>}
      </div>
    ),
    sort: (r) => r.name,
    csv: (r) => r.name,
  });
  const statusCol: Column<Entity> = {
    key: "status",
    label: t("Durum"),
    render: (r) => <CampaignStatusCell accountId={acc!.id} campaignId={r.id} name={r.name} status={r.status} canManage={isAdmin} />,
    sort: (r) => (r.status === "active" ? 0 : r.status === "paused" ? 1 : 2),
    csv: (r) => r.status ?? "",
  };
  const tabs = [
    {
      id: "campaigns" as const,
      label: t("Kampanyalar"),
      rows: d?.campaigns ?? [],
      cols: [nameCol(t("Kampanya")), statusCol, ...metricCols],
    },
    {
      id: "groups" as const,
      label: groupLabel,
      rows: d?.groups ?? [],
      cols: [nameCol(groupLabel, t("Kampanya")), ...metricCols],
    },
    {
      id: "ads" as const,
      label: t("Reklamlar"),
      rows: d?.ads ?? [],
      cols: [nameCol(t("Reklam"), groupLabel), ...metricCols],
    },
    ...(acc?.provider === "google"
      ? [
          {
            id: "keywords" as const,
            label: t("Anahtar kelimeler"),
            rows: d?.keywords ?? [],
            cols: [nameCol(t("Anahtar kelime"), t("Reklam grubu")), ...metricCols],
          },
        ]
      : []),
    ...(acc?.provider === "google" && isAdmin
      ? [
          {
            id: "recs" as const,
            label: t("Öneriler"),
            rows: [] as Entity[],
            cols: [] as Column<Entity>[],
          },
        ]
      : []),
  ];
  const active = tabs.find((x) => x.id === tab) ?? tabs[0];

  const connectButtons = (primary = false) =>
    (d?.providers ?? []).map((pr) =>
      pr.configured ? (
        <a key={pr.id} className={`btn ${primary ? "btn-primary" : ""}`} href={`/api/ads/${pr.id}/connect`}>
          <PlatformIcon id={pr.id} size={16} /> {pr.label}
        </a>
      ) : (
        <span
          key={pr.id}
          className="btn"
          aria-disabled="true"
          title={t("Sunucu ayarı eksik: {list}", {
            list: pr.missing.join(", "),
          })}
          style={{ opacity: 0.55, cursor: "not-allowed" }}
        >
          <PlatformIcon id={pr.id} size={16} /> {pr.label}
        </span>
      ),
    );

  return (
    <div className="ads">
      <PageHead
        title={t("Reklamlar")}
        sub={t(
          "Meta (Facebook ve Instagram), Google Ads ve TikTok Ads hesaplarının harcama ve sonuçları. Yöneticiler kampanyaları duraklatıp başlatabilir, gönderi öne çıkarabilir ve Google Ads önerilerini uygulayabilir.",
        )}
        actions={
          <div className="segmented" role="group" aria-label={t("Dönem")}>
            {[7, 30, 90].map((n) => (
              <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} onClick={() => setDays(n)}>
                {t("{n} gün", { n })}
              </button>
            ))}
          </div>
        }
      />

      {!d ? (
        <p className="muted small">{t("Yükleniyor…")}</p>
      ) : !d.accounts.length ? (
        <div className="card">
          <Empty
            icon={<Megaphone />}
            title={t("Reklam hesabı bağlı değil")}
            text={t("Her platform yalnızca reklam verilerini okuma izni ister; kanal izinlerin değişmez. Bağlamak için platform seç.")}
            action={
              isAdmin ? (
                <div className="row" style={{ justifyContent: "center", gap: 8 }}>
                  {connectButtons(true)}
                </div>
              ) : undefined
            }
          />
          {isAdmin && (
            <ul className="ads-setup">
              {d.providers.map((pr) => (
                <li key={pr.id}>
                  <PlatformIcon id={pr.id} size={16} /> <strong>{pr.label}</strong>{" "}
                  {pr.configured ? (
                    <span className="muted small">{t("Yönlendirme adresi: {u}", { u: pr.redirectUri })}</span>
                  ) : (
                    <span className="small" style={{ color: "var(--warn)" }}>
                      {t("Sunucu ayarı eksik: {list}", {
                        list: pr.missing.join(", "),
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card ads-bar">
            <label className="ads-acc">
              <span className="sr-only">{t("Reklam hesabı")}</span>
              {acc && <PlatformIcon id={acc.provider} />}
              <select className="input select-sm" value={acc?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
                {d.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {`${d.providers.find((x) => x.id === a.provider)?.label ?? a.provider} · ${a.name} (${a.externalId.replace(/^act_/, "")})`}
                  </option>
                ))}
              </select>
            </label>
            {acc && (
              <span className="small muted row" style={{ gap: 8 }}>
                <span>{cur}</span>
                <span>· {acc.lastSyncedAt ? t("Son güncelleme: {d}", { d: f.short(acc.lastSyncedAt) }) : t("Henüz güncellenmedi")}</span>
                {acc.lastError && (
                  <span className="cp-err" title={acc.lastError}>
                    <AlertTriangle aria-hidden="true" /> {t("Son güncelleme başarısız")}
                  </span>
                )}
                {s.can("editor") && (
                  <button className="btn btn-ghost btn-sm" onClick={() => sync.mutate(acc.id)} disabled={sync.isPending}>
                    <RefreshCw className={sync.isPending ? "spin" : ""} aria-hidden="true" /> {t("Şimdi çek")}
                  </button>
                )}
              </span>
            )}
            {isAdmin && acc?.provider === "meta" && (
              <>
                <button className="btn btn-sm" onClick={() => setCreatingAd(true)}>
                  <Plus aria-hidden="true" /> {t("Yeni reklam")}
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => setBoosting(true)}>
                  <Rocket aria-hidden="true" /> {t("Gönderiyi öne çıkar")}
                </button>
              </>
            )}
            {isAdmin && (
              <details className="ads-add">
                <summary className="btn btn-sm">
                  <Plug aria-hidden="true" /> {t("Hesap ekle")}
                </summary>
                <div className="ads-add-menu">{connectButtons()}</div>
              </details>
            )}
          </div>

          {!k || k.spend === null ? (
            <div className="card">
              <Empty icon={<Megaphone />} title={t("Bu dönemde reklam verisi yok")} text={t("Hesapta yayında reklam yoksa ya da veri henüz gelmediyse burası boş kalır.")} />
            </div>
          ) : (
            <>
              <div className="an-kpis">
                {tile("spend", t("Harcama"), (n) => money(n, (n ?? 0) >= 1000 ? 0 : 2))}
                {tile("impressions", t("Gösterim"), (n) => compact(n ?? 0))}
                {tile("reach", t("Erişim"), (n) => compact(n ?? 0), t("günlük erişimlerin toplamı"))}
                {tile("clicks", t("Tıklama"), (n) => num(n))}
                {tile("ctr", t("CTR"), pct, t("tıklama / gösterim"))}
                {tile("cpc", t("CPC"), (n) => money(n), t("tıklama başına maliyet"), false)}
                {tile("cpm", t("CPM"), (n) => money(n), t("1.000 gösterim maliyeti"), false)}
                {tile("conversions", t("Dönüşüm"), (n) => num(n))}
                {tile("costPerConversion", t("Dönüşüm başı maliyet"), (n) => money(n), undefined, false)}
                {tile("messages", t("Başlatılan sohbet"), (n) => num(n))}
              </div>

              <div className="an-grid">
                <ChartCard
                  title={t("Günlük harcama")}
                  sub={cur}
                  table={() => (
                    <SimpleTable
                      caption={t("Günlük harcama")}
                      head={[t("Gün"), t("Harcama"), t("Gösterim"), t("Tıklama"), t("Dönüşüm")]}
                      rows={d.daily.map((x) => [fmtDay(x.date, intl), money(x.spend), num(x.impressions), num(x.clicks), num(x.conversions)])}
                    />
                  )}
                >
                  <TimeChart
                    kind="bar"
                    dates={d.daily.map((x) => x.date)}
                    format={(n) => money(n, 0)}
                    ariaLabel={t("Günlük harcama")}
                    height={170}
                    series={[
                      {
                        key: "s",
                        label: t("Harcama"),
                        color: seriesVar(1),
                        values: d.daily.map((x) => x.spend),
                      },
                    ]}
                  />
                </ChartCard>
                <ChartCard title={t("Günlük tıklama")} sub={t("Tüm tıklamalar")}>
                  <TimeChart
                    kind="line"
                    area
                    zeroBaseline
                    dates={d.daily.map((x) => x.date)}
                    format={num}
                    ariaLabel={t("Günlük tıklama")}
                    height={170}
                    series={[
                      {
                        key: "c",
                        label: t("Tıklama"),
                        color: seriesVar(2),
                        values: d.daily.map((x) => x.clicks),
                      },
                    ]}
                  />
                </ChartCard>
              </div>
            </>
          )}

          {(d.campaigns.length > 0 || (k && k.spend !== null) || tabs.some((x) => x.id === "recs")) && (
            <div className="card" style={{ padding: 0 }}>
              <div className="tabs ads-tabs" role="tablist" aria-label={t("Düzey")}>
                {tabs.map((x) => (
                  <button key={x.id} role="tab" aria-selected={active.id === x.id} className={`tab ${active.id === x.id ? "active" : ""}`} onClick={() => setTab(x.id)}>
                    {x.label} {x.id !== "recs" && <span className="ads-tabnum">{x.rows.length}</span>}
                  </button>
                ))}
              </div>
              <div style={{ padding: "4px 16px 16px" }}>
                {active.id === "recs" && acc ? (
                  <Recommendations accountId={acc.id} currency={cur} canManage={isAdmin} />
                ) : (
                  <DataTable
                    key={`${acc?.id}-${active.id}`}
                    caption={active.label}
                    rows={active.rows}
                    rowKey={(r) => r.id}
                    columns={active.cols}
                    search={(r, qq) => (r.name ?? "").toLocaleLowerCase().includes(qq) || (r.parentName ?? "").toLocaleLowerCase().includes(qq)}
                    csvName={`reblebi-reklam-${active.id}-${d.range.from}_${d.range.to}`}
                    initialSort={{ key: "spend", dir: "desc" }}
                    pageSizes={[25, 50, 100]}
                    empty={t("Bu dönemde veri yok.")}
                  />
                )}
              </div>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            {t("Veriler platformların reklam API'lerinden 6 saatte bir çekilir; son iki günün rakamları platform tarafından kesinleşene kadar değişebilir.")}
          </p>
          {boosting && acc && <BoostDialog accountId={acc.id} currency={cur} onClose={() => setBoosting(false)} />}
          {creatingAd && acc && <CreateAdDialog accountId={acc.id} currency={cur} onClose={() => setCreatingAd(false)} />}
        </div>
      )}
    </div>
  );
}
