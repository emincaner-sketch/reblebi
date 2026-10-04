import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clapperboard, Copy, Grid3x3, Info, Plus } from "lucide-react";
import { api, errMsg, type Channel, type Media, type Post } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useFmt, useSession } from "../lib/session";
import { Empty, PageHead, useLocalState, useToast } from "../components/ui";
import "../panel/analytics/autolists.css";

interface FeedItem {
  id: string;
  caption: string;
  mediaType: string;
  imageUrl: string | null;
  permalink: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
}
interface Tile {
  key: string;
  planned: boolean;
  postId?: string;
  at: string;
  caption: string;
  image: string | null;
  video: boolean;
  multi: boolean;
  status?: string;
  link?: string | null;
}

/**
 * Instagram ızgara planlayıcı (Metricool/Later "feed preview"): planlanan gönderiler profilin üstünde nasıl
 * duracak, canlı akışla birlikte görülür; planlananlar sürükle-bırak ya da düğmelerle yer (saat) değiştirir.
 */
export default function FeedGridPage() {
  const { t } = useI18n();
  const f = useFmt();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("editor");
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels"), staleTime: 60_000 });
  const igs = (channels.data ?? []).filter((c) => c.provider === "instagram");
  const [selRaw, setSel] = useLocalState<string>("sp_grid_channel", "");
  const ch = igs.find((c) => c.id === selRaw) ?? igs[0] ?? null;
  const planned = useQuery({
    queryKey: ["grid-planned", ch?.id],
    queryFn: () => api.get<Post[]>(`/api/posts?${new URLSearchParams({ channelId: ch!.id, status: "scheduled,pending_approval", limit: "60", order: "asc" })}`),
    enabled: Boolean(ch),
  });
  const published = useQuery({
    queryKey: ["grid-published", ch?.id],
    queryFn: () => api.get<Post[]>(`/api/posts?${new URLSearchParams({ channelId: ch!.id, status: "published,partial", limit: "30", order: "desc" })}`),
    enabled: Boolean(ch),
  });
  const feed = useQuery({ queryKey: ["grid-feed", ch?.id], queryFn: () => api.get<{ items: FeedItem[]; live: boolean }>(`/api/channels/${ch!.id}/feed`), enabled: Boolean(ch), staleTime: 5 * 60_000 });
  const media = useQuery({ queryKey: ["media", "grid"], queryFn: () => api.get<Media[]>("/api/media?limit=500"), staleTime: 60_000 });
  const mediaMap = useMemo(() => new Map((media.data ?? []).map((m) => [m.id, m])), [media.data]);

  const firstMedia = (p: Post) => {
    const target = p.targets.find((x) => x.channelId === ch?.id);
    const ids = target?.mediaIds?.length ? target.mediaIds : p.mediaIds;
    return { first: ids.length ? mediaMap.get(ids[0]) : undefined, count: ids.length };
  };
  const toTile = (p: Post, plannedTile: boolean): Tile => {
    const m = firstMedia(p);
    const target = p.targets.find((x) => x.channelId === ch?.id);
    return {
      key: `${plannedTile ? "p" : "d"}-${p.id}`,
      planned: plannedTile,
      postId: p.id,
      at: (plannedTile ? p.publishAt : (target?.publishedAt ?? p.publishedAt ?? p.publishAt)) ?? p.createdAt,
      caption: target?.content ?? p.content,
      image: m.first?.kind === "image" ? m.first.url : null,
      video: m.first?.kind === "video" || p.kind === "reel" || p.kind === "video",
      multi: m.count > 1,
      status: p.status,
      link: target?.externalUrl ?? null,
    };
  };
  // Instagram en yeniyi sol üstte gösterir: planlananlar (en geç tarih önce) + canlı akış (ya da panelden yayınlananlar)
  const plannedTiles = [...(planned.data ?? [])].filter((p) => p.publishAt && p.kind !== "story").map((p) => toTile(p, true)).sort((a, b) => b.at.localeCompare(a.at));
  const liveTiles: Tile[] = feed.data?.live
    ? feed.data.items.map((it) => ({ key: `f-${it.id}`, planned: false, at: it.timestamp, caption: it.caption, image: it.imageUrl, video: it.mediaType === "VIDEO", multi: it.mediaType === "CAROUSEL_ALBUM", link: it.permalink }))
    : (published.data ?? []).filter((p) => p.kind !== "story").map((p) => toTile(p, false));
  const tiles = [...plannedTiles, ...liveTiles];

  const swap = useMutation({
    mutationFn: async ({ a, b }: { a: Tile; b: Tile }) => {
      // İki planlı gönderinin saatlerini değiştir (sıra = yayın zamanı)
      await api.post(`/api/posts/${a.postId}/reschedule`, { publishAt: b.at });
      await api.post(`/api/posts/${b.postId}/reschedule`, { publishAt: a.at });
    },
    onSuccess: () => {
      toast(t("Gönderilerin yayın saatleri değiştirildi"), "ok");
      qc.invalidateQueries({ queryKey: ["grid-planned"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => {
      toast(errMsg(e), "err");
      qc.invalidateQueries({ queryKey: ["grid-planned"] });
    },
  });
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  if (channels.isLoading) return <p className="muted small">{t("Yükleniyor…")}</p>;
  if (!ch)
    return (
      <div className="fg">
        <PageHead title={t("Instagram ızgarası")} />
        <div className="card">
          <Empty
            icon={<Grid3x3 />}
            title={t("Önce bir Instagram hesabı bağla")}
            text={t("Izgara planlayıcı, planladığın gönderilerin profilinde nasıl görüneceğini canlı akışınla birlikte gösterir.")}
            action={
              <Link className="btn btn-primary" to="/app/channels">
                {t("Kanal bağla")}
              </Link>
            }
          />
        </div>
      </div>
    );

  return (
    <div className="fg">
      <PageHead
        title={t("Instagram ızgarası")}
        sub={t("Planladığın gönderiler profilinin en üstünde nasıl duracak, gör. Planlanan iki gönderiyi sürükleyip birbirinin üstüne bırakınca yayın saatleri yer değiştirir.")}
        actions={
          canEdit && (
            <Link className="btn btn-primary" to="/app/posts/new">
              <Plus aria-hidden="true" /> {t("Yeni gönderi")}
            </Link>
          )
        }
      />
      <div className="card fg-bar">
        {igs.length > 1 ? (
          <label>
            <span className="sr-only">{t("Hesap")}</span>
            <select className="select" value={ch.id} onChange={(e) => setSel(e.target.value)}>
              {igs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.username ? `@${c.username}` : c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <strong>{ch.username ? `@${ch.username}` : ch.name}</strong>
        )}
        <span className="muted small">
          {t("{n} planlı", { n: plannedTiles.length })} · {feed.data?.live ? t("canlı akış Instagram'dan") : t("yayınlananlar paneldeki kayıtlardan")}
        </span>
      </div>
      {feed.data && !feed.data.live && (
        <p className="muted small fg-note">
          <Info aria-hidden="true" /> {t("Instagram'daki canlı akış okunamadı (izin ya da bağlantı sorunu); altta yalnızca panelden yayınlanan gönderiler görünüyor.")}
        </p>
      )}

      <div className="fg-phone">
        <ul className="fg-grid" aria-label={t("Profil ızgarası önizlemesi")}>
          {tiles.map((tile, i) => {
            const plannedIdx = tile.planned ? plannedTiles.findIndex((x) => x.key === tile.key) : -1;
            const body = (
              <>
                {tile.image ? <img src={tile.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fg-text">{tile.caption.slice(0, 90) || t("(metin yok)")}</span>}
                {tile.video && <Clapperboard className="fg-ico" aria-label={t("Video")} />}
                {tile.multi && !tile.video && <Copy className="fg-ico" aria-label={t("Birden çok görsel")} />}
                {tile.planned && (
                  <span className={`fg-badge${tile.status === "pending_approval" ? " warn" : ""}`}>
                    {tile.status === "pending_approval" ? t("Onay bekliyor") : t("Planlandı")} · {f.short(tile.at)}
                  </span>
                )}
              </>
            );
            return (
              <li
                key={tile.key}
                className={`fg-cell${tile.planned ? " planned" : ""}${drag === tile.key ? " dragging" : ""}${over === tile.key && drag && drag !== tile.key ? " over" : ""}`}
                draggable={tile.planned && canEdit}
                onDragStart={(e) => {
                  setDrag(tile.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", tile.key);
                }}
                onDragEnd={() => (setDrag(null), setOver(null))}
                onDragOver={(e) => {
                  if (!drag || !tile.planned || drag === tile.key) return;
                  e.preventDefault();
                  setOver(tile.key);
                }}
                onDragLeave={() => setOver((o) => (o === tile.key ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const a = plannedTiles.find((x) => x.key === drag);
                  if (a && tile.planned && a.key !== tile.key) swap.mutate({ a, b: tile });
                  setDrag(null);
                  setOver(null);
                }}
              >
                {tile.planned && tile.postId ? (
                  <Link to={`/app/posts/${tile.postId}`} className="fg-tile" aria-label={t("Planlı gönderi, {d}: {c}", { d: f.short(tile.at), c: tile.caption.slice(0, 60) })}>
                    {body}
                  </Link>
                ) : tile.link ? (
                  <a href={tile.link} target="_blank" rel="noreferrer" className="fg-tile" aria-label={t("Yayınlanan gönderi, {d}", { d: f.short(tile.at) })}>
                    {body}
                  </a>
                ) : (
                  <span className="fg-tile">{body}</span>
                )}
                {tile.planned && canEdit && plannedTiles.length > 1 && (
                  <span className="fg-move">
                    <button
                      type="button"
                      aria-label={t("Bir öncekiyle yer değiştir (daha geç yayınla)")}
                      disabled={plannedIdx <= 0 || swap.isPending}
                      onClick={() => swap.mutate({ a: tile, b: plannedTiles[plannedIdx - 1] })}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("Bir sonrakiyle yer değiştir (daha erken yayınla)")}
                      disabled={plannedIdx < 0 || plannedIdx >= plannedTiles.length - 1 || swap.isPending}
                      onClick={() => swap.mutate({ a: tile, b: plannedTiles[plannedIdx + 1] })}
                    >
                      <ArrowRight aria-hidden="true" />
                    </button>
                  </span>
                )}
                <span className="sr-only">{i + 1}</span>
              </li>
            );
          })}
        </ul>
        {!tiles.length && <p className="muted small">{t("Henüz planlı ya da yayınlanmış gönderi yok.")}</p>}
      </div>
      <p className="muted small fg-note">
        <Info aria-hidden="true" /> {t("Instagram profil ızgarası görselleri 3:4 oranında kırpar; hikâyeler ızgarada görünmez. Taslaklar ve tarihsiz gönderiler burada yer almaz.")}
      </p>
    </div>
  );
}
