import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Check, Inbox, PlugZap, Sparkles, X } from "lucide-react";
import { api, errMsg, type Channel, type Dashboard, type Post } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Can, Empty, Loading, PageHead, ProviderIcon, Stat, StatusBadge, UsageBar, useToast } from "../components/ui";

function PostRow({ p, chMap, when }: { p: Post; chMap: Map<string, Channel>; when: string }) {
  const L = useLabels();
  const { t } = useI18n();
  return (
    <li className="dash-row">
      <span className="muted small dash-when">{when}</span>
      <Link to={`/app/posts/${p.id}`} className="truncate" style={{ color: "inherit" }}>
        <span className="badge" style={{ marginRight: 6 }}>
          {L.kind(p.kind)}
        </span>
        {p.title || p.content || t("(metin yok)")}
      </Link>
      <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
        {p.targets.map((tg) => {
          const c = chMap.get(tg.channelId);
          return c ? <ProviderIcon key={tg.id} provider={c.provider} size={20} /> : null;
        })}
      </span>
    </li>
  );
}

export default function DashboardPage() {
  const { t } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/api/dashboard"), refetchInterval: 30_000 });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const d = dash.data;
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));

  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.post<Post>(`/api/posts/${id}/${ok ? "approve" : "reject"}`, ok ? {} : { reason: null }),
    onSuccess: (_r, v) => {
      toast(v.ok ? t("Onaylandı") : t("Reddedildi, taslağa döndü"), "ok");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast(errMsg(e), "err"),
  });

  const firstRun = d && d.channels.total === 0;

  return (
    <>
      <PageHead
        title={t("Merhaba{name}", { name: s.user.name ? `, ${s.user.name.split(" ")[0]}` : "" })}
        sub={t("Bugün ne oluyor: planlanan gönderiler, gelen mesajlar ve kanal sağlığı.")}
        actions={
          <Can role="editor">
            <Link to="/app/posts/new" className="btn btn-primary">
              <CalendarPlus /> {t("Yeni gönderi")}
            </Link>
            <Link to="/app/inbox" className="btn">
              <Inbox /> {t("Gelen kutusu")}
            </Link>
          </Can>
        }
      />

      {!d ? (
        <Loading />
      ) : (
        <>
          {firstRun && (
            <div className="card onboarding">
              <h2>{t("Başlangıç")}</h2>
              <ol className="steps">
                <li className={d.channels.total > 0 ? "done" : ""}>
                  <PlugZap /> <Link to="/app/channels">{t("İlk kanalını bağla")}</Link> <span className="muted small">— {t("Instagram, Facebook, TikTok, X, LinkedIn…")}</span>
                </li>
                <li>
                  <Sparkles /> <Link to="/app/settings?tab=brand">{t("Marka sesini tanımla")}</Link> <span className="muted small">— {t("AI metinleri buna göre yazar")}</span>
                </li>
                <li>
                  <CalendarPlus /> <Link to="/app/posts/new">{t("İlk gönderini planla")}</Link>
                </li>
              </ol>
            </div>
          )}
          {!d.ai && (
            <div className="notice notice-warn row" style={{ marginBottom: 16 }}>
              <Sparkles />
              <span>
                <strong>{t("AI kapalı.")}</strong> {t("Ayarlar > AI bölümünden bir sağlayıcı anahtarı ekleyince içerik üretimi ve AI DM yanıtları açılır.")}
              </span>
              <Can role="admin">
                <Link to="/app/settings?tab=ai" className="btn btn-sm" style={{ marginLeft: "auto" }}>
                  {t("AI ayarları")}
                </Link>
              </Can>
            </div>
          )}
          {d.channels.problem > 0 && (
            <div className="notice notice-err row" style={{ marginBottom: 16 }}>
              <AlertTriangle />
              <span>
                <strong>{t("{n} kanalda bağlantı sorunu var.", { n: d.channels.problem })}</strong> <Link to="/app/channels">{t("Kanallar sayfasından yeniden bağla.")}</Link>
              </span>
            </div>
          )}
          <div className="grid grid-4">
            <Stat label={t("Bağlı kanal")} value={d.channels.total} sub={t("{n} aktif", { n: d.channels.active })} />
            <Stat label={t("Planlanan")} value={d.posts.scheduled} sub={t("{n} taslak", { n: d.posts.draft })} />
            <Stat
              label={t("Son 7 gün yayın")}
              value={d.posts.publishedLast7}
              sub={d.posts.failed > 0 ? <span style={{ color: "var(--err)" }}>{t("{n} başarısız", { n: d.posts.failed })}</span> : t("sorunsuz")}
            />
            <Stat
              label={t("Okunmamış DM")}
              value={d.inbox.unread}
              sub={d.inbox.attention > 0 ? <span style={{ color: "var(--warn)" }}>{t("{n} dikkat bekliyor", { n: d.inbox.attention })}</span> : t("{n} otomatik yanıt / 7 gün", { n: d.inbox.autoRepliedLast7 })}
            />
          </div>

          {d.pendingApproval.length > 0 && (
            <div className="card" style={{ marginTop: 16, borderColor: "var(--warn)" }}>
              <div className="card-title">
                <h2>{t("Onay bekleyenler ({n})", { n: d.posts.pendingApproval })}</h2>
                <Link to="/app/posts?status=pending_approval" className="small">
                  {t("Tümü →")}
                </Link>
              </div>
              <ul className="dash-list">
                {d.pendingApproval.map((p) => (
                  <li key={p.id} className="dash-row dash-row-2 dash-wrap">
                    <span style={{ minWidth: 0 }}>
                      <Link to={`/app/posts/${p.id}`} className="truncate" style={{ display: "block", color: "inherit" }}>
                        {p.title || p.content || t("(metin yok)")}
                      </Link>
                      <span className="muted small">
                        {L.kind(p.kind)} · {p.publishAt ? f.short(p.publishAt) : t("tarih yok")} · {p.source}
                      </span>
                    </span>
                    <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <Can role="admin" fallback={<StatusBadge status="pending_approval" />}>
                        <button className="btn btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, ok: false })}>
                          <X /> {t("Reddet")}
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, ok: true })}>
                          <Check /> {t("Onayla")}
                        </button>
                      </Can>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-title">
                <h2>{t("Önümüzdeki 48 saat")}</h2>
                <Link to="/app/posts" className="small">
                  {t("Takvim →")}
                </Link>
              </div>
              {d.upcoming.length === 0 ? (
                <Empty title={t("Planlı gönderi yok")} text={t("Yeni gönderi oluşturup tarih seç.")} />
              ) : (
                <ul className="dash-list">
                  {d.upcoming.map((p) => (
                    <PostRow key={p.id} p={p} chMap={chMap} when={f.short(p.publishAt)} />
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <div className="card-title">
                <h2>{t("Son yayınlar")}</h2>
              </div>
              {d.recent.length === 0 ? (
                <Empty title={t("Henüz yayın yok")} />
              ) : (
                <ul className="dash-list">
                  {d.recent.map((p) => (
                    <li key={p.id} className="dash-row dash-row-2">
                      <span style={{ minWidth: 0 }}>
                        <Link to={`/app/posts/${p.id}`} className="truncate" style={{ display: "block", color: "inherit" }}>
                          {p.title || p.content || t("(metin yok)")}
                        </Link>
                        <span className="muted small">{f.date(p.publishedAt ?? p.updatedAt)}</span>
                      </span>
                      <StatusBadge status={p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="card-title">
                <h2>{t("Bu ayki kullanım")}</h2>
                <Link to="/app/billing" className="small">
                  {L.plan(d.usage.plan.name, d.usage.plan.id)} →
                </Link>
              </div>
              <div className="form">
                <UsageBar label={t("Gönderi")} q={d.usage.posts} />
                <UsageBar label={t("AI üretimi")} q={d.usage.ai} />
                <UsageBar label={t("Kanal")} q={d.usage.channels} />
              </div>
            </div>
            <div className="card">
              <div className="card-title">
                <h2>{t("Aktif kampanyalar")}</h2>
                <Link to="/app/campaigns" className="small">
                  {t("Tümü →")}
                </Link>
              </div>
              {d.campaigns.length === 0 ? (
                <Empty title={t("Aktif kampanya yok")} text={t("AI planlayıcıyla 2 haftalık içerik takvimi oluştur.")} />
              ) : (
                <table className="table">
                  <tbody>
                    {d.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/app/campaigns/${c.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                            {c.name}
                          </Link>
                          <div className="muted small">{t("{p}/{n} yayınlandı", { p: c.publishedCount ?? 0, n: c.postCount ?? 0 })}</div>
                        </td>
                        <td className="muted small" style={{ textAlign: "right" }}>
                          {c.nextAt ? f.short(c.nextAt) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">
              <h2>{t("Son aktivite")}</h2>
            </div>
            {d.activity.length === 0 ? (
              <Empty title={t("Henüz aktivite yok")} />
            ) : (
              <div className="activity">
                {d.activity.map((a) => (
                  <div key={a.id} className="activity-item">
                    <span className="dot" style={{ color: a.level === "error" ? "var(--err)" : a.level === "warn" ? "var(--warn)" : "var(--ok)" }} />
                    <div>
                      <div>{a.message}</div>
                      <div className="when">
                        {a.source} · {f.ago(a.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
