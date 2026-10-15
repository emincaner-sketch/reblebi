import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ListPlus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, errMsg, type Channel, type DmProfile, type DmProfileItem } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFmt } from "../../lib/session";
import { Can, Empty, useToast } from "../../components/ui";

/** Meta sınırları (sunucudaki dm-profile.ts ile aynı) */
const ICE_BREAKER_MAX = 4;
const ICE_BREAKER_CHARS = 80;
const MENU_MAX = 20;
const MENU_TITLE_CHARS = 30;

const isLink = (i: DmProfileItem) => i.url !== null && i.url !== undefined;

/**
 * Sohbet menüsü: kanal başına hazır sorular (ice breakers) ve sabit menü (persistent menu).
 * Kaydedince Meta'ya gönderilir; kişilerin Instagram/Messenger sohbet ekranında görünür.
 */
export function DmProfileTab({ channels, inboxEnabled }: { channels: Channel[]; inboxEnabled: boolean }) {
  const { t } = useI18n();
  const metaChannels = channels.filter((c) => c.provider === "instagram" || c.provider === "facebook");
  const [channelId, setChannelId] = useState<string>("");
  const selected = metaChannels.find((c) => c.id === channelId) ?? metaChannels[0] ?? null;

  if (!metaChannels.length) {
    return <Empty icon={<ListPlus style={{ width: 36, color: "var(--accent)" }} />} title={t("Sohbet menüsü")} text={t("Önce bir Instagram ya da Facebook kanalı bağla.")} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      <div className="card small" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <AlertTriangle style={{ width: 18, color: "var(--warn)", flexShrink: 0 }} />
        <div>
          {t("Hazır sorular, kişi sohbeti ilk açtığında çıkar; sabit menü sohbet ekranında hep durur. Kaydedince hemen Meta'ya gönderilir ve gerçek kişiler görür. Cevabı boş bırakırsan DM kuralların ya da yapay zekâ cevaplar.")}
        </div>
      </div>

      <div className="field" style={{ maxWidth: 360 }}>
        <label>{t("Kanal")}</label>
        <select className="input" value={selected?.id ?? ""} onChange={(e) => setChannelId(e.target.value)}>
          {metaChannels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.provider})
            </option>
          ))}
        </select>
      </div>

      {selected && <ProfileEditor key={selected.id} channel={selected} inboxEnabled={inboxEnabled} />}
    </div>
  );
}

function ProfileEditor({ channel, inboxEnabled }: { channel: Channel; inboxEnabled: boolean }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ["dm-profile", channel.id];
  const profile = useQuery({ queryKey: key, queryFn: () => api.get<DmProfile>(`/api/channels/${channel.id}/dm-profile`) });
  const [ice, setIce] = useState<DmProfileItem[]>([]);
  const [menu, setMenu] = useState<DmProfileItem[]>([]);

  useEffect(() => {
    if (!profile.data) return;
    setIce(profile.data.iceBreakers);
    setMenu(profile.data.menu);
  }, [profile.data]);

  const onResult = (p: DmProfile) => {
    qc.setQueryData(key, p);
    if (p.syncError) toast(t("Kaydedildi ama Meta'ya gönderilemedi: {e}", { e: p.syncError }), "err");
    else toast(t("Sohbet menüsü kaydedildi ve Meta'ya gönderildi"), "ok");
  };
  const save = useMutation({
    mutationFn: () =>
      api.put<DmProfile>(`/api/channels/${channel.id}/dm-profile`, {
        iceBreakers: ice.map((i) => ({ title: i.title.trim(), replyText: (i.replyText ?? "").trim() || null })),
        menu: menu.map((i) => (isLink(i) ? { title: i.title.trim(), url: (i.url ?? "").trim() } : { title: i.title.trim(), replyText: (i.replyText ?? "").trim() || null })),
      }),
    onSuccess: onResult,
    onError: (e) => toast(errMsg(e), "err"),
  });
  const resync = useMutation({
    mutationFn: () => api.post<DmProfile>(`/api/channels/${channel.id}/dm-profile/sync`, {}),
    onSuccess: onResult,
    onError: (e) => toast(errMsg(e), "err"),
  });

  const valid =
    ice.every((i) => i.title.trim() && i.title.trim().length <= ICE_BREAKER_CHARS) &&
    menu.every((i) => i.title.trim() && i.title.trim().length <= MENU_TITLE_CHARS && (!isLink(i) || /^https:\/\/\S+\.\S+/.test(i.url ?? "")));
  const onSave = () => {
    if (!window.confirm(t("Sohbet menüsü Meta'ya gönderilecek ve kişiler hemen görecek. Devam edilsin mi?"))) return;
    save.mutate();
  };

  if (profile.isLoading) return <div className="card muted small">{t("Yükleniyor…")}</div>;
  const p = profile.data;

  return (
    <>
      {p && (p.syncError || p.syncedAt) && (
        <div className="card small" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {p.syncError ? (
            <>
              <AlertTriangle style={{ width: 16, color: "var(--err)" }} />
              <span style={{ flex: 1, minWidth: 200 }}>{t("Meta'ya gönderilemedi: {e}", { e: p.syncError })}</span>
              <Can role="admin">
                <button className="btn btn-ghost btn-sm" onClick={() => resync.mutate()} disabled={resync.isPending}>
                  <RefreshCw style={{ width: 14 }} /> {t("Yeniden gönder")}
                </button>
              </Can>
            </>
          ) : (
            <>
              <CheckCircle2 style={{ width: 16, color: "var(--ok)" }} />
              <span>{t("Meta'ya gönderildi: {d}", { d: fmt.short(p.syncedAt!) })}</span>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h3>{t("Hazır sorular (ice breakers)")}</h3>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t("Kişi seninle ilk kez sohbet açtığında bu sorular düğme olarak çıkar. En fazla 4 soru.")}
        </p>
        <ItemList
          items={ice}
          onChange={setIce}
          max={ICE_BREAKER_MAX}
          titleMax={ICE_BREAKER_CHARS}
          allowLink={false}
          titlePlaceholder={t("Örn: Fiyatlar nedir?")}
          addLabel={t("Soru ekle")}
        />
      </div>

      <div className="card">
        <div className="card-title">
          <h3>{t("Sabit menü")}</h3>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t("Sohbet ekranındaki menüde her zaman durur. Her öğe bir bağlantı açar ya da basınca cevap gönderir. En fazla 20 öğe.")}
        </p>
        <ItemList items={menu} onChange={setMenu} max={MENU_MAX} titleMax={MENU_TITLE_CHARS} allowLink titlePlaceholder={t("Örn: Destek")} addLabel={t("Menü öğesi ekle")} />
      </div>

      <Can role="admin">
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={onSave} disabled={!inboxEnabled || !valid || save.isPending}>
            {save.isPending ? t("Gönderiliyor…") : t("Kaydet ve Meta'ya gönder")}
          </button>
        </div>
      </Can>
    </>
  );
}

function ItemList({
  items,
  onChange,
  max,
  titleMax,
  allowLink,
  titlePlaceholder,
  addLabel,
}: {
  items: DmProfileItem[];
  onChange: (items: DmProfileItem[]) => void;
  max: number;
  titleMax: number;
  allowLink: boolean;
  titlePlaceholder: string;
  addLabel: string;
}) {
  const { t } = useI18n();
  const setItem = (i: number, patch: Partial<DmProfileItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: "1 1 180px" }}
              value={it.title}
              maxLength={titleMax}
              onChange={(e) => setItem(i, { title: e.target.value })}
              placeholder={titlePlaceholder}
              aria-label={t("Başlık")}
            />
            {allowLink && (
              <select
                className="input"
                style={{ flex: "0 1 170px" }}
                value={isLink(it) ? "url" : "reply"}
                onChange={(e) => setItem(i, e.target.value === "url" ? { url: "", replyText: null } : { url: null, replyText: "" })}
                aria-label={t("Düğme türü")}
              >
                <option value="reply">{t("Basınca cevap gönder")}</option>
                <option value="url">{t("Bağlantı aç")}</option>
              </select>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("Yukarı taşı")}>
              ↑
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={t("Aşağı taşı")}>
              ↓
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={t("Kaldır")}>
              <Trash2 style={{ width: 14 }} />
            </button>
          </div>
          {isLink(it) ? (
            <input className="input" value={it.url ?? ""} onChange={(e) => setItem(i, { url: e.target.value })} placeholder="https://ydsmatik.com" aria-label={t("Bağlantı")} />
          ) : (
            <textarea
              className="input"
              rows={2}
              value={it.replyText ?? ""}
              onChange={(e) => setItem(i, { replyText: e.target.value })}
              placeholder={t("Basınca gidecek cevap (boşsa DM kuralları cevaplar)")}
              aria-label={t("Basınca gidecek cevap (boşsa DM kuralları cevaplar)")}
            />
          )}
          <span className="help">
            {it.title.length}/{titleMax}
          </span>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...items, { title: "", url: null, replyText: "" }])}>
          <Plus style={{ width: 14 }} /> {addLabel}
        </button>
      )}
    </div>
  );
}
