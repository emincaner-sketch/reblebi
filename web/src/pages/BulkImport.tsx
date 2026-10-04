import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload, XCircle } from "lucide-react";
import { api, errMsg, type Channel } from "../lib/api";
import { parseCsv, readRows, resolveChannels, templateCsv, type CsvRow } from "../lib/csv-import";
import { useI18n, useLabels } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Empty, PageHead, ProviderIcon, useToast } from "../components/ui";
import "../panel/analytics/autolists.css";

const MAX_ROWS = 500;
const CHUNK = 100;

interface BulkItem {
  index: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  publishAt: string | null;
  status: string;
  postId?: string;
}
interface BulkResult {
  ok: boolean;
  dryRun: boolean;
  campaignId: string | null;
  created: number;
  items: BulkItem[];
}
interface RowState {
  row: CsvRow;
  channelIds: string[];
  /** Sunucuya gitmeden önceki engelleyici sorunlar (kanal, tarih, tür) */
  local: string[];
  /** Engellemeyen uyarılar */
  notes: string[];
  result?: BulkItem;
}

/** CSV ile toplu gönderi yükleme (Metricool "Bulk upload") */
export default function BulkImportPage() {
  const { t, locale, intl } = useI18n();
  const L = useLabels();
  const s = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/api/channels"), staleTime: 60_000 });
  const chans = channels.data ?? [];
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileError, setFileError] = useState("");
  const [fallback, setFallback] = useState<string[]>([]);
  const [allDraft, setAllDraft] = useState(false);
  const [campaign, setCampaign] = useState("");
  const [results, setResults] = useState<Map<number, BulkItem>>(new Map());
  const [mediaMap, setMediaMap] = useState<Map<string, string>>(new Map());
  const [phase, setPhase] = useState<"idle" | "media" | "validating" | "importing">("idle");
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState<{ created: number; campaignId: string | null } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const states: RowState[] = useMemo(
    () =>
      rows.map((row, i) => {
        const r = resolveChannels(row.channelTokens, chans, fallback);
        const local: string[] = [];
        // Bazı kanallar bulunduysa bulunamayanlar yalnızca uyarıdır
        const notes = r.ids.length && r.unknown.length ? [t("Kanal bulunamadı: {list}", { list: r.unknown.join(", ") })] : [];
        if (!r.ids.length) local.push(row.channelTokens.length ? t("Kanal bulunamadı: {list}", { list: r.unknown.join(", ") }) : t("Kanal yok (sütun boş; aşağıdan varsayılan kanal seç)"));
        if (row.problems.includes("date")) local.push(t("Tarih okunamadı (ör. 2026-10-12 ya da 12.10.2026)"));
        if (row.problems.includes("time")) local.push(t("Saat okunamadı (ör. 18:30)"));
        if (row.problems.includes("kind")) local.push(t("Tür tanınmadı (post, reel, story, video, thread)"));
        if (!row.text && !row.media.length) local.push(t("Metin ve medya boş"));
        return { row, channelIds: r.ids, local, notes, result: results.get(i) };
      }),
    [rows, chans, fallback, results, t],
  );

  const reset = () => {
    setResults(new Map());
    setDone(null);
  };
  const load = async (file: File) => {
    reset();
    setFileError("");
    setFileName(file.name);
    if (file.size > 5 * 1024 * 1024) return setFileError(t("Dosya 5 MB'tan büyük."));
    const parsed = readRows(parseCsv(await file.text()));
    if (parsed.fields.text === undefined && parsed.fields.media === undefined) {
      setRows([]);
      return setFileError(t("Metin sütunu bulunamadı. İlk satır başlık olmalı (ör. metin, tarih, saat, kanallar)."));
    }
    if (parsed.items.length > MAX_ROWS) setFileError(t("İlk {n} satır alındı (en fazla {n}).", { n: MAX_ROWS }));
    setRows(parsed.items.slice(0, MAX_ROWS));
  };

  const toInput = (st: RowState, media: Map<string, string>) => {
    const draft = allDraft || st.row.draft || !st.row.publishAt;
    return {
      title: st.row.title,
      kind: st.row.kind,
      content: st.row.text,
      mediaIds: st.row.media.map((u) => media.get(u)).filter((x): x is string => Boolean(x)),
      publishAt: st.row.publishAt,
      draft,
      firstComment: st.row.firstComment,
      targets: st.channelIds.map((channelId) => ({ channelId })),
    };
  };
  const sendable = states.map((st, i) => ({ st, i })).filter(({ st }) => !st.local.length);

  /** Medya bağlantılarını kütüphaneye indirir (bir kez); hatalı bağlantılar satırda hata olur */
  const importMedia = async (): Promise<Map<string, string>> => {
    const urls = [...new Set(sendable.flatMap(({ st }) => st.row.media))].filter((u) => !mediaMap.has(u));
    const next = new Map(mediaMap);
    let n = 0;
    for (const url of urls) {
      setProgress(t("Medya indiriliyor {n}/{total}", { n: ++n, total: urls.length }));
      try {
        const m = await api.post<{ id: string }>("/api/media/import", { url });
        next.set(url, m.id);
      } catch (e) {
        toast(`${url}: ${errMsg(e)}`, "err");
      }
    }
    setMediaMap(next);
    return next;
  };

  const run = async (dryRun: boolean) => {
    if (!sendable.length) return;
    try {
      setPhase(dryRun ? "media" : "importing");
      const media = await importMedia();
      setPhase(dryRun ? "validating" : "importing");
      const out = new Map(results);
      let created = 0;
      let campaignId: string | null = null;
      // İçe aktarırken yalnızca doğrulamadan geçenler gönderilir
      const list = dryRun ? sendable : sendable.filter(({ i }) => results.get(i)?.ok);
      for (let k = 0; k < list.length; k += CHUNK) {
        const part = list.slice(k, k + CHUNK);
        setProgress(dryRun ? t("Doğrulanıyor {n}/{total}", { n: Math.min(k + CHUNK, list.length), total: list.length }) : t("İçe aktarılıyor {n}/{total}", { n: Math.min(k + CHUNK, list.length), total: list.length }));
        const r: BulkResult = await api.post<BulkResult>("/api/posts/bulk", {
          posts: part.map(({ st }) => toInput(st, media)),
          dryRun,
          atomic: false,
          ...(campaignId ? { campaignId } : !dryRun && campaign.trim() ? { campaign: { name: campaign.trim() } } : {}),
        });
        r.items.forEach((it) => out.set(part[it.index].i, it));
        created += r.created;
        campaignId = campaignId ?? r.campaignId;
      }
      setResults(out);
      if (!dryRun) {
        setDone({ created, campaignId });
        qc.invalidateQueries({ queryKey: ["posts"] });
        qc.invalidateQueries({ queryKey: ["calendar"] });
        toast(t("{n} gönderi eklendi", { n: created }), "ok");
      }
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setPhase("idle");
      setProgress("");
    }
  };

  const validated = sendable.length > 0 && sendable.every(({ i }) => results.has(i));
  const okCount = sendable.filter(({ i }) => results.get(i)?.ok).length;
  const errCount = states.length - okCount;
  const statusLabel = (st: string) => (st === "scheduled" ? t("Planlanacak") : st === "draft" ? t("Taslak") : st === "pending_approval" ? t("Onaya düşecek") : st);
  const fmtAt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.org.timezone }).format(new Date(iso)) : "—");
  const download = () => {
    const blob = new Blob([templateCsv(chans, locale)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = locale === "tr" ? "reblebi-toplu-gonderi-sablonu.csv" : "reblebi-bulk-posts-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!s.can("editor"))
    return (
      <div className="bi">
        <PageHead title={t("Toplu yükleme (CSV)")} />
        <div className="card">
          <Empty icon={<FileUp />} title={t("Bu işlem için yetkin yok")} text={t("Toplu yükleme için editör rolü gerekir.")} />
        </div>
      </div>
    );

  return (
    <div className="bi">
      <PageHead
        title={t("Toplu yükleme (CSV)")}
        sub={t("Yüzlerce gönderiyi tek dosyayla planla: her satır bir gönderi. Önce doğrulanır, sonra içe aktarılır; tarihler çalışma alanı saatine ({tz}) göre okunur.", { tz: s.org.timezone })}
        actions={
          <button className="btn" onClick={download}>
            <Download aria-hidden="true" /> {t("Şablonu indir")}
          </button>
        }
      />

      <div
        className={`card bi-drop${dragOver ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
      >
        <Upload aria-hidden="true" />
        <div>
          <strong>{fileName || t("CSV dosyasını buraya bırak")}</strong>
          <p className="muted small">{t("Sütunlar: metin, tarih, saat, kanallar (instagram|facebook ya da kanal adı), tür, ilk yorum, medya (bağlantı), taslak. Ayraç virgül ya da noktalı virgül olabilir.")}</p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="bi-file" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        <label htmlFor="bi-file" className="btn btn-primary">
          <FileUp aria-hidden="true" /> {t("Dosya seç")}
        </label>
      </div>
      {fileError && (
        <p className="al-err small">
          <AlertTriangle aria-hidden="true" /> {fileError}
        </p>
      )}

      {rows.length > 0 && !done && (
        <>
          <div className="card bi-opts">
            <div className="field">
              <span className="bi-l">{t("Kanal sütunu boş satırlar için")}</span>
              <div className="al-chans">
                {chans.map((c) => {
                  const on = fallback.includes(c.id);
                  return (
                    <label key={c.id} className={`al-chan${on ? " on" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => (reset(), setFallback(on ? fallback.filter((x) => x !== c.id) : [...fallback, c.id]))} />
                      <ProviderIcon provider={c.provider} size={18} />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="bi-opts-row">
              <label className="check">
                <input type="checkbox" checked={allDraft} onChange={(e) => (reset(), setAllDraft(e.target.checked))} />
                <span>{t("Hepsini taslak olarak ekle")}</span>
              </label>
              <div className="field bi-camp">
                <label htmlFor="bi-camp">{t("Kampanyada topla (isteğe bağlı)")}</label>
                <input id="bi-camp" className="input" value={campaign} maxLength={120} placeholder={t("Kampanya adı")} onChange={(e) => setCampaign(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="bi-bar">
              <strong>{t("{n} satır", { n: rows.length })}</strong>
              {validated && (
                <span className="small">
                  <span className="bi-ok">
                    <CheckCircle2 aria-hidden="true" /> {t("{n} hazır", { n: okCount })}
                  </span>{" "}
                  {errCount > 0 && (
                    <span className="bi-bad">
                      <XCircle aria-hidden="true" /> {t("{n} sorunlu (atlanacak)", { n: errCount })}
                    </span>
                  )}
                </span>
              )}
              <span className="muted small" aria-live="polite">
                {progress}
              </span>
              <span className="bi-actions">
                <button className="btn btn-sm" disabled={phase !== "idle" || !sendable.length} onClick={() => void run(true)}>
                  {t("Doğrula")}
                </button>
                <button className="btn btn-sm btn-primary" disabled={phase !== "idle" || !validated || !okCount} onClick={() => void run(false)}>
                  {t("{n} gönderiyi içe aktar", { n: okCount })}
                </button>
              </span>
            </div>
            <div className="table-wrap">
              <table className="table bi-table">
                <caption className="sr-only">{t("İçe aktarılacak satırlar")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Satır")}</th>
                    <th scope="col">{t("Metin")}</th>
                    <th scope="col">{t("Zaman")}</th>
                    <th scope="col">{t("Kanallar")}</th>
                    <th scope="col">{t("Durum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((st, i) => {
                    const r = st.result;
                    const problems = [...st.local, ...(r?.errors ?? [])];
                    return (
                      <tr key={i} className={problems.length ? "bad" : r?.ok ? "ok" : ""}>
                        <td className="num">{st.row.line}</td>
                        <td>
                          <div className="bi-text">{st.row.text || <span className="muted">{t("(metin yok)")}</span>}</div>
                          <span className="muted small">
                            {L.kind(st.row.kind)}
                            {st.row.media.length > 0 && ` · ${t("{n} medya", { n: st.row.media.length })}`}
                            {st.row.firstComment && ` · ${t("ilk yorum")}`}
                          </span>
                        </td>
                        <td className="bi-when">{r?.publishAt ? fmtAt(r.publishAt) : st.row.publishAt ?? <span className="muted">{t("tarihsiz")}</span>}</td>
                        <td>
                          <span className="bi-chans">
                            {st.channelIds.map((id) => {
                              const c = chans.find((x) => x.id === id);
                              return c ? <ProviderIcon key={id} provider={c.provider} size={18} /> : null;
                            })}
                          </span>
                        </td>
                        <td className="bi-status">
                          {problems.length ? (
                            <ul className="bi-errs">
                              {problems.slice(0, 3).map((p, k) => (
                                <li key={k}>{p}</li>
                              ))}
                            </ul>
                          ) : r ? (
                            <>
                              <span className="bi-ok">{statusLabel(r.status)}</span>
                              {[...st.notes, ...r.warnings].slice(0, 2).map((w, k) => (
                                <span key={k} className="muted small bi-warn">
                                  {w}
                                </span>
                              ))}
                            </>
                          ) : (
                            <span className="muted small">{st.notes[0] ?? t("doğrulanmadı")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {done && (
        <div className="card">
          <Empty
            icon={<CheckCircle2 />}
            title={t("{n} gönderi eklendi", { n: done.created })}
            text={t("Planlananlar takvimde, taslaklar listede. Onay modu açıksa bazıları onaya düşmüş olabilir.")}
            action={
              <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                <Link className="btn btn-primary" to="/app/posts">
                  {t("Takvime git")}
                </Link>
                {done.campaignId && (
                  <Link className="btn" to={`/app/campaigns/${done.campaignId}`}>
                    {t("Kampanyayı aç")}
                  </Link>
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setRows([]);
                    setFileName("");
                    reset();
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  {t("Yeni dosya")}
                </button>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
