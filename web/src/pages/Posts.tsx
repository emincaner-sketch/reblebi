import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, MessageSquare, Play, Trash2, X, XCircle } from "lucide-react";
import { api, errMsg, type Campaign, type Channel, type Post, type PostStatus, type Tag } from "../lib/api";
import { useI18n, useLabels } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { addDays, dayKey, keyOf, todayIn, wallClock, weekdayOf, zonedToUtc } from "../lib/tz";
import { Can, Empty, PageHead, ProviderIcon, StatusBadge, useLocalState, useToast } from "../components/ui";

interface BestTimes {
  range: { from: string; to: string; tz: string };
  cells: Array<{ weekday: number; hour: number; posts: number; withMetrics: number; avgInteractions: number | null }>;
  maxAvg: number;
  top: Array<{ weekday: number; hour: number }>;
}

const DAYS = { tr: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"], en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };

function usePostActions() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const onError = (e: unknown) => toast(errMsg(e), "err");
  return {
    publishNow: useMutation({
      mutationFn: (id: string) => api.post<Post>(`/api/posts/${id}/publish`),
      onSuccess: (p) => {
        toast(p.status === "published" ? t("Yayınlandı") : p.status === "partial" ? t("Kısmen yayınlandı, detaya bak") : t("Yayın başarısız, detaya bak"), p.status === "published" ? "ok" : "err");
        invalidate();
      },
      onError,
    }),
    cancel: useMutation({ mutationFn: (id: string) => api.post(`/api/posts/${id}/cancel`), onSuccess: () => (toast(t("Plan iptal edildi, taslağa döndü"), "ok"), invalidate()), onError }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/posts/${id}`), onSuccess: () => (toast(t("Gönderi silindi; 30 gün içinde Silinenler bölümünden geri alabilirsin."), "ok"), invalidate(), qc.invalidateQueries({ queryKey: ["posts-trash"] })), onError }),
    duplicate: useMutation({ mutationFn: (id: string) => api.post<Post>(`/api/posts/${id}/duplicate`), onSuccess: (p) => nav(`/app/posts/${p.id}`), onError }),
    approve: useMutation({ mutationFn: (id: string) => api.post<Post>(`/api/posts/${id}/approve`), onSuccess: () => (toast(t("Onaylandı"), "ok"), invalidate()), onError }),
    reject: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string | null }) => api.post<Post>(`/api/posts/${id}/reject`, { reason }),
      onSuccess: () => (toast(t("Reddedildi, taslağa döndü"), "ok"), invalidate()),
      onError,
    }),
    /** Sürükle-bırak: taslak taslak kalır, diğerleri yeni saate planlanır */
    move: useMutation({
      mutationFn: ({ post, local }: { post: Post; local: string }) =>
        post.status === "draft" ? api.put<Post>(`/api/posts/${post.id}`, { publishAt: local, draft: true }) : api.post<Post>(`/api/posts/${post.id}/reschedule`, { publishAt: local }),
      onSuccess: () => toast(t("Yeni saate taşındı"), "ok"),
      onError,
      onSettled: invalidate,
    }),
  };
}

const MOVABLE: PostStatus[] = ["draft", "scheduled", "pending_approval", "failed", "cancelled"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export default function PostsPage() {
  const { t, locale, intl } = useI18n();
  const L = useLabels();
  const f = useFmt();
  const s = useSession();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useLocalState<"month" | "week" | "list">("sp_posts_view2", "month");
  const today = todayIn(f.tz);
  const [month, setMonth] = useState({ year: today.year, month: today.month });
  const mondayOf = (y: number, m: number, d: number) => addDays(y, m, d, -((weekdayOf(y, m, d) + 6) % 7));
  const [week, setWeek] = useState(() => mondayOf(today.year, today.month, today.day));
  const [over, setOver] = useState<string | null>(null);
  // Telefonda ay görünümü sıkışık: güne dokununca o günün gönderileri takvimin altında listelenir
  const [pick, setPick] = useState<string | null>(null);
  const weekScroll = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const status = (params.get("status") as PostStatus | null) ?? "";
  const [channelId, setChannelId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const a = usePostActions();
  const effView = status ? "list" : view;
  const isCal = effView !== "list";
  // Takvim katmanı: son 90 günün gün × saat ortalama etkileşimi (yalnızca hafta görünümünde ve açıkken çekilir)
  const [bestOn, setBestOn] = useLocalState<boolean>("sp_best_times", true);
  const best = useQuery({
    queryKey: ["best-times", channelId],
    queryFn: () => api.get<BestTimes>(`/api/analytics/best-times?days=90${channelId ? `&channelId=${channelId}` : ""}`),
    enabled: effView === "week" && bestOn,
    staleTime: 10 * 60_000,
  });
  const bestMap = useMemo(() => new Map((best.data?.cells ?? []).map((c) => [`${c.weekday}-${c.hour}`, c])), [best.data]);
  const bestTop = useMemo(() => new Set((best.data?.top ?? []).map((c) => `${c.weekday}-${c.hour}`)), [best.data]);
  const heatStep = (v: number | null) => (v === null || !best.data?.maxAvg ? 0 : Math.max(1, Math.min(6, Math.ceil((v / best.data.maxAvg) * 6))));

  const grid = useMemo(() => {
    if (effView === "week") {
      const cells = Array.from({ length: 7 }, (_, i) => addDays(week.year, week.month, week.day, i));
      const after = addDays(week.year, week.month, week.day, 7);
      return {
        cells,
        from: zonedToUtc(week.year, week.month, week.day, 0, 0, f.tz).toISOString(),
        to: zonedToUtc(after.year, after.month, after.day, 0, 0, f.tz).toISOString(),
      };
    }
    const offset = (weekdayOf(month.year, month.month, 1) + 6) % 7;
    const cells = Array.from({ length: 42 }, (_, i) => addDays(month.year, month.month, 1, i - offset));
    const first = cells[0];
    const after = addDays(cells[41].year, cells[41].month, cells[41].day, 1);
    return {
      cells,
      from: zonedToUtc(first.year, first.month, first.day, 0, 0, f.tz).toISOString(),
      to: zonedToUtc(after.year, after.month, after.day, 0, 0, f.tz).toISOString(),
    };
  }, [effView, month, week, f.tz]);

  // Hafta görünümü açılınca 07:00'a kaydır
  useEffect(() => {
    if (effView === "week" && weekScroll.current) weekScroll.current.scrollTop = 7 * 46;
  }, [effView]);

  const qs = new URLSearchParams();
  if (isCal) {
    qs.set("from", grid.from);
    qs.set("to", grid.to);
    qs.set("limit", "1000");
    qs.set("order", "asc");
  } else {
    qs.set("limit", "300");
    if (status) qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
  }
  if (channelId) qs.set("channelId", channelId);
  if (campaignId) qs.set("campaignId", campaignId);
  if (tag) qs.set("tag", tag);

  const posts = useQuery({ queryKey: ["posts", qs.toString()], queryFn: () => api.get<Post[]>(`/api/posts?${qs.toString()}`), refetchInterval: 20_000 });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels") });
  const campaigns = useQuery({ queryKey: ["campaigns"], queryFn: () => api.get<Campaign[]>("/api/campaigns") });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/api/tags") });
  const chMap = new Map((channels.data ?? []).map((c) => [c.id, c]));
  const tagMap = new Map((tags.data ?? []).map((x) => [x.id, x]));

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts.data ?? []) {
      const k = dayKey(p.publishAt ?? p.createdAt, f.tz);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts.data, f.tz]);

  const byHour = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts.data ?? []) {
      const w = wallClock(p.publishAt ?? p.createdAt, f.tz);
      const k = `${keyOf(w.year, w.month, w.day)}|${w.hour}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts.data, f.tz]);

  /* ---------------- Sürükle-bırak ---------------- */

  const canMove = (p: Post) => s.can("editor") && MOVABLE.includes(p.status);
  const onDragStart = (e: DragEvent, p: Post) => {
    e.dataTransfer.setData("text/plain", p.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const dropProps = (key: string, target: { year: number; month: number; day: number; hour?: number }) =>
    s.can("editor")
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== key) setOver(key);
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData("text/plain");
            const post = posts.data?.find((x) => x.id === id);
            if (!post || !canMove(post)) return;
            const orig = wallClock(post.publishAt ?? post.createdAt, f.tz);
            const hour = target.hour ?? orig.hour;
            const minute = target.hour === undefined || target.hour === orig.hour ? orig.minute : 0;
            if (orig.year === target.year && orig.month === target.month && orig.day === target.day && orig.hour === hour && orig.minute === minute) return;
            const local = `${keyOf(target.year, target.month, target.day)} ${pad2(hour)}:${pad2(minute)}`;
            // İyimser güncelleme: kart hemen yeni yerine geçer
            const newIso = zonedToUtc(target.year, target.month, target.day, hour, minute, f.tz).toISOString();
            qc.setQueryData<Post[]>(["posts", qs.toString()], (old) => old?.map((x) => (x.id === id ? { ...x, publishAt: newIso } : x)));
            a.move.mutate({ post, local });
          },
        }
      : {};

  const todayKey = keyOf(today.year, today.month, today.day);
  const monthLabel = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.year, month.month - 1, 15)));
  const weekEnd = addDays(week.year, week.month, week.day, 6);
  const dm = (d: { year: number; month: number; day: number }) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
  const periodLabel = effView === "week" ? `${dm(week)} – ${dm(weekEnd)} ${weekEnd.year}` : monthLabel;
  const shift = (n: number) => {
    if (effView === "week") {
      setWeek(addDays(week.year, week.month, week.day, 7 * n));
      return;
    }
    const d = new Date(Date.UTC(month.year, month.month - 1 + n, 1));
    setMonth({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  };
  const inMonth = (k: string) => k.startsWith(`${month.year}-${pad2(month.month)}-`);
  const picked = pick && inMonth(pick) ? pick : inMonth(todayKey) ? todayKey : keyOf(month.year, month.month, 1);
  const pickedItems = byDay.get(picked) ?? [];
  const goToday = () => {
    setPick(null);
    setMonth({ year: today.year, month: today.month });
    setWeek(mondayOf(today.year, today.month, today.day));
  };
  const setStatus = (v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set("status", v);
    else p.delete("status");
    setParams(p, { replace: true });
    if (v) setView("list");
  };

  const filters = (
    <div className="row" style={{ marginBottom: 12 }}>
      {effView === "list" && (
        <>
          <input className="input" style={{ width: 220 }} placeholder={t("Metinde ara…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Ara")} />
          <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("Durum")}>
            <option value="">{t("Tüm durumlar")}</option>
            {L.statuses.map((st) => (
              <option key={st} value={st}>
                {L.status(st)}
              </option>
            ))}
          </select>
        </>
      )}
      <select className="select" style={{ width: 190 }} value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label={t("Kanal")}>
        <option value="">{t("Tüm kanallar")}</option>
        {channels.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {(campaigns.data?.length ?? 0) > 0 && (
        <select className="select" style={{ width: 190 }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label={t("Kampanya")}>
          <option value="">{t("Tüm kampanyalar")}</option>
          {campaigns.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {(tags.data?.length ?? 0) > 0 && (
        <select className="select" style={{ width: 160 }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t("Etiket")}>
          <option value="">{t("Tüm etiketler")}</option>
          {tags.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <>
      <PageHead
        title={t("Gönderiler & Takvim")}
        sub={t("Planlanan, yayınlanan ve taslak içerikler. Saatler {tz} saat dilimindedir.", { tz: f.tz })}
        actions={
          <>
            <div className="segmented">
              <button className={effView === "month" ? "active" : ""} onClick={() => (setStatus(""), setView("month"))}>
                {t("Ay")}
              </button>
              <button className={effView === "week" ? "active" : ""} onClick={() => (setStatus(""), setView("week"))}>
                {t("Hafta")}
              </button>
              <button className={effView === "list" ? "active" : ""} onClick={() => setView("list")}>
                {t("Liste")}
              </button>
            </div>
            <Can role="editor">
              <Link to="/app/posts/new" className="btn btn-primary">
                <CalendarPlus /> {t("Yeni gönderi")}
              </Link>
            </Can>
          </>
        }
      />

      {isCal ? (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div className="row">
              <button className="btn btn-icon" onClick={() => shift(-1)} aria-label={t("Önceki")}>
                <ChevronLeft />
              </button>
              <h2 style={{ minWidth: 190, textAlign: "center", textTransform: "capitalize" }}>{periodLabel}</h2>
              <button className="btn btn-icon" onClick={() => shift(1)} aria-label={t("Sonraki")}>
                <ChevronRight />
              </button>
              <button className="btn btn-sm" onClick={goToday}>
                {t("Bugün")}
              </button>
            </div>
            <div className="row small muted">
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ color: "var(--accent)" }} /> {t("Planlı")}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ color: "var(--warn)" }} /> {t("Onayda")}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ color: "var(--ok)" }} /> {t("Yayınlandı")}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ color: "var(--err)" }} /> {t("Hatalı")}
              </span>
            </div>
          </div>
          {filters}
          {s.can("editor") && <p className="muted small cal-hint" style={{ margin: "0 0 10px" }}>{t("İpucu: gönderileri sürükleyip başka bir güne ya da saate bırakarak yeniden zamanlayabilirsin.")}</p>}
          {effView === "week" && (
            <div className="best-bar">
              <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={bestOn} onChange={(e) => setBestOn(e.target.checked)} />
                <strong>{t("En iyi saatleri göster")}</strong>
              </label>
              {bestOn && (
                <span className="muted small">
                  {best.data && best.data.cells.length > 0
                    ? t("Son 90 günde yayınladığın gönderilerin ortalama etkileşimi; koyu hücre daha iyi, noktalı hücreler en iyi 5 saat.")
                    : best.isFetching
                      ? t("Yükleniyor…")
                      : t("Henüz yeterli gönderi metriği yok.")}
                </span>
              )}
              {bestOn && best.data && best.data.cells.length > 0 && (
                <span className="best-scale" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <i key={i} style={{ background: `var(--heat-${i})` }} />
                  ))}
                </span>
              )}
            </div>
          )}
          {effView === "week" ? (
            <div className="cal-scroll">
              <div className="week-head">
                <div />
                {grid.cells.map((d, i) => {
                  const k = keyOf(d.year, d.month, d.day);
                  return (
                    <div key={k} className={k === todayKey ? "today" : ""}>
                      {DAYS[locale][i]} <strong>{d.day}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="week-body" ref={weekScroll}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div className="week-row" key={h}>
                    <div className="week-hour">{pad2(h)}:00</div>
                    {grid.cells.map((d, wi) => {
                      const dk = keyOf(d.year, d.month, d.day);
                      const key = `${dk}|${h}`;
                      const items = byHour.get(key) ?? [];
                      const bc = bestOn ? bestMap.get(`${wi}-${h}`) : undefined;
                      const step = bc ? heatStep(bc.avgInteractions) : 0;
                      const isTop = bestOn && bestTop.has(`${wi}-${h}`);
                      return (
                        <div
                          key={key}
                          className={`week-cell ${over === key ? "drop-over" : ""} ${dk === todayKey ? "today" : ""}${step ? " best" : ""}`}
                          style={step ? { ["--best" as string]: `var(--heat-${step})` } : undefined}
                          title={bc && bc.avgInteractions !== null ? t("En iyi saatler: ort. {v} etkileşim · {n} gönderi", { v: f.num(Math.round(bc.avgInteractions)), n: bc.posts }) : undefined}
                          onDoubleClick={() => s.can("editor") && nav(`/app/posts/new?date=${dk}&time=${pad2(h)}:00`)}
                          {...dropProps(key, { ...d, hour: h })}
                        >
                          {isTop && <span className="best-dot" aria-hidden="true" />}
                          {items.map((p) => (
                            <div
                              key={p.id}
                              className={`cal-item ${p.status} ${canMove(p) ? "movable" : ""}`}
                              draggable={canMove(p)}
                              onDragStart={(e) => onDragStart(e, p)}
                              onClick={() => nav(`/app/posts/${p.id}`)}
                              role="link"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === "Enter" && nav(`/app/posts/${p.id}`)}
                              title={p.title || p.content}
                            >
                              <span className="t">{f.time(p.publishAt ?? p.createdAt)}</span>
                              {p.targets.slice(0, 3).map((tg) => {
                                const c = chMap.get(tg.channelId);
                                return c ? (
                                  <span key={tg.id} style={{ marginRight: 3 }}>
                                    <ProviderIcon provider={c.provider} size={12} />
                                  </span>
                                ) : null;
                              })}
                              <span className="truncate" style={{ display: "block" }}>
                                {p.title || p.content || L.kind(p.kind)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <>
          <div className="cal-scroll cal-month">
            <div className="cal-head">
              {DAYS[locale].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="cal-grid">
              {grid.cells.map((d) => {
                const k = keyOf(d.year, d.month, d.day);
                const items = byDay.get(k) ?? [];
                return (
                  <div
                    key={k}
                    className={`cal-day ${d.month !== month.month ? "other" : ""} ${k === todayKey ? "today" : ""} ${over === k ? "drop-over" : ""} ${k === picked ? "picked" : ""}`}
                    onClick={() => setPick(k)}
                    onDoubleClick={() => s.can("editor") && nav(`/app/posts/new?date=${k}`)}
                    title={s.can("editor") ? t("Çift tık: bu güne gönderi planla") : ""}
                    {...dropProps(k, d)}
                  >
                    <span className="num">{d.day}</span>
                    {items.length > 0 && (
                      <span className="cal-dots" aria-label={t("{n} gönderi", { n: items.length })}>
                        {items.slice(0, 3).map((p) => (
                          <i key={p.id} className={p.status} />
                        ))}
                        {items.length > 3 && <b>+{items.length - 3}</b>}
                      </span>
                    )}
                    {items.slice(0, 4).map((p) => (
                      <div
                        key={p.id}
                        className={`cal-item ${p.status} ${canMove(p) ? "movable" : ""}`}
                        draggable={canMove(p)}
                        onDragStart={(e) => onDragStart(e, p)}
                        onClick={() => nav(`/app/posts/${p.id}`)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && nav(`/app/posts/${p.id}`)}
                      >
                        <span className="t">{f.time(p.publishAt ?? p.createdAt)}</span>
                        {p.targets.slice(0, 3).map((tg) => {
                          const c = chMap.get(tg.channelId);
                          return c ? (
                            <span key={tg.id} style={{ marginRight: 3 }}>
                              <ProviderIcon provider={c.provider} size={13} />
                            </span>
                          ) : null;
                        })}
                        <span className="truncate" style={{ display: "block" }}>
                          {p.title || p.content || L.kind(p.kind)}
                        </span>
                      </div>
                    ))}
                    {items.length > 4 && <span className="small muted cal-more">{t("+{n} daha", { n: items.length - 4 })}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="cal-daylist">
            <div className="row-between">
              <strong>{new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${picked}T12:00:00Z`))}</strong>
              <Can role="editor">
                <Link to={`/app/posts/new?date=${picked}`} className="btn btn-sm">
                  <CalendarPlus /> {t("Planla")}
                </Link>
              </Can>
            </div>
            {pickedItems.length === 0 ? (
              <p className="muted small" style={{ margin: "8px 0 0" }}>{t("Bu gün için gönderi yok.")}</p>
            ) : (
              pickedItems.map((p) => (
                <Link key={p.id} to={`/app/posts/${p.id}`} className={`cal-item ${p.status}`}>
                  <span className="t">{f.time(p.publishAt ?? p.createdAt)}</span>
                  {p.targets.slice(0, 4).map((tg) => {
                    const c = chMap.get(tg.channelId);
                    return c ? (
                      <span key={tg.id} style={{ marginRight: 3 }}>
                        <ProviderIcon provider={c.provider} size={13} />
                      </span>
                    ) : null;
                  })}
                  <span className="truncate" style={{ display: "block" }}>
                    {p.title || p.content || L.kind(p.kind)}
                  </span>
                </Link>
              ))
            )}
          </div>
          </>
          )}
        </div>
      ) : (
        <div className="card">
          {filters}
          {posts.data?.length === 0 ? (
            <Empty
              title={t("Gönderi yok")}
              action={
                <Can role="editor">
                  <Link to="/app/posts/new" className="btn btn-primary">
                    {t("Yeni gönderi")}
                  </Link>
                </Can>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t("İçerik")}</th>
                    <th>{t("Kanallar")}</th>
                    <th>{t("Tarih")}</th>
                    <th>{t("Durum")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.data?.map((p) => (
                    <tr key={p.id}>
                      <td style={{ maxWidth: 380 }}>
                        <Link to={`/app/posts/${p.id}`} className="truncate" style={{ display: "block", color: "inherit", fontWeight: 500 }}>
                          {p.title || p.content || t("(metin yok)")}
                        </Link>
                        <span className="muted small row" style={{ gap: 6 }}>
                          {L.kind(p.kind)}
                          {p.mediaIds.length ? ` · ${t("{n} medya", { n: p.mediaIds.length })}` : ""}
                          {p.tags.map((id) => tagMap.get(id)).filter(Boolean).map((x) => (
                            <span key={x!.id} className="tag" style={{ borderColor: x!.color, color: x!.color }}>
                              {x!.name}
                            </span>
                          ))}
                          {(p.noteCount ?? 0) > 0 && (
                            <span title={t("Notlar")}>
                              <MessageSquare style={{ width: 12, verticalAlign: "middle" }} /> {p.noteCount}
                            </span>
                          )}
                          {p.rejectionReason !== null && p.status === "draft" && <span style={{ color: "var(--err)" }}>{t("reddedildi")}</span>}
                        </span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 4 }}>
                          {p.targets.map((tg) => {
                            const c = chMap.get(tg.channelId);
                            if (!c) return null;
                            return (
                              <span key={tg.id} title={`${c.name}: ${tg.status}${tg.error ? " - " + tg.error : ""}`} style={{ position: "relative" }}>
                                <ProviderIcon provider={c.provider} size={20} />
                                {tg.status === "published" && tg.externalUrl && (
                                  <a href={tg.externalUrl} target="_blank" rel="noreferrer" style={{ position: "absolute", right: -5, top: -5 }} aria-label={t("Yayını aç")}>
                                    <ExternalLink style={{ width: 10, color: "var(--ok)" }} />
                                  </a>
                                )}
                                {tg.status === "failed" && <span className="dot" style={{ position: "absolute", right: -3, top: -3, color: "var(--err)", width: 7, height: 7 }} />}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td className="small muted">{f.date(p.publishAt ?? p.createdAt)}</td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {p.status === "pending_approval" && s.can("admin") && (
                          <>
                            <button className="btn btn-ghost btn-sm" title={t("Onayla")} aria-label={t("Onayla")} onClick={() => a.approve.mutate(p.id)}>
                              <Check />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              title={t("Reddet")}
                              aria-label={t("Reddet")}
                              onClick={() => {
                                const reason = prompt(t("Red nedeni (isteğe bağlı)"));
                                if (reason !== null) a.reject.mutate({ id: p.id, reason: reason || null });
                              }}
                            >
                              <X />
                            </button>
                          </>
                        )}
                        <Can role="editor">
                          {(p.status === "draft" || p.status === "scheduled" || p.status === "failed" || p.status === "partial" || p.status === "cancelled") && (
                            <button className="btn btn-ghost btn-sm" title={t("Şimdi yayınla")} aria-label={t("Şimdi yayınla")} onClick={() => confirm(t("Şimdi yayınlansın mı?")) && a.publishNow.mutate(p.id)}>
                              <Play />
                            </button>
                          )}
                          {(p.status === "scheduled" || p.status === "pending_approval") && (
                            <button className="btn btn-ghost btn-sm" title={t("Planı iptal et")} aria-label={t("Planı iptal et")} onClick={() => a.cancel.mutate(p.id)}>
                              <XCircle />
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" title={t("Kopyala")} aria-label={t("Kopyala")} onClick={() => a.duplicate.mutate(p.id)}>
                            <Copy />
                          </button>
                          {p.status !== "publishing" && (
                            <button className="btn btn-ghost btn-sm" title={t("Sil")} aria-label={t("Sil")} onClick={() => confirm(t("Silinsin mi?")) && a.remove.mutate(p.id)}>
                              <Trash2 />
                            </button>
                          )}
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
