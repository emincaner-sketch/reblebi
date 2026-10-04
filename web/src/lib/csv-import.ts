import { PROVIDER_NAME, type Channel, type PostKind, type ProviderId } from "./api";

/**
 * CSV ile toplu gönderi (Metricool "Bulk upload"): dosya tarayıcıda ayrıştırılır, sütunlar Türkçe/İngilizce
 * başlıklarla eşlenir, satırlar /api/posts/bulk biçimine çevrilir (önce dryRun ile doğrulanır).
 */

export type CsvField = "text" | "date" | "time" | "datetime" | "channels" | "kind" | "firstComment" | "draft" | "media" | "title";

export const HEADER_ALIASES: Record<CsvField, string[]> = {
  text: ["text", "metin", "content", "içerik", "icerik", "message", "mesaj", "caption", "açıklama"],
  date: ["date", "tarih", "gün", "gun", "day"],
  time: ["time", "saat", "hour"],
  datetime: ["datetime", "publish_at", "publishat", "yayın zamanı", "yayin zamani", "zaman", "schedule"],
  channels: ["channels", "channel", "kanallar", "kanal", "networks", "network", "ağlar", "ag", "ağ", "accounts", "hesaplar"],
  kind: ["kind", "type", "tür", "tur", "format"],
  firstComment: ["first_comment", "firstcomment", "first comment", "ilk yorum", "ilk_yorum", "comment", "yorum"],
  draft: ["draft", "taslak"],
  media: ["media", "medya", "image", "görsel", "gorsel", "image_url", "media_url", "video", "url", "urls"],
  title: ["title", "başlık", "baslik"],
};

const KIND_ALIASES: Record<string, PostKind> = {
  post: "post",
  gönderi: "post",
  gonderi: "post",
  image: "post",
  reel: "reel",
  reels: "reel",
  story: "story",
  stories: "story",
  hikaye: "story",
  hikâye: "story",
  video: "video",
  short: "video",
  shorts: "video",
  thread: "thread",
  zincir: "thread",
};
const YES = new Set(["1", "x", "yes", "y", "true", "evet", "e", "taslak", "draft"]);

/** RFC 4180 CSV: tırnaklı alanlar, satır içi satır sonu, "" kaçışı; ayraç (, ; sekme) başlık satırından seçilir */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  const delim = counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts[0].d : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

export function mapHeader(header: string[]): Partial<Record<CsvField, number>> {
  const out: Partial<Record<CsvField, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[CsvField, string[]]>) {
      if (out[field] === undefined && aliases.some((a) => norm(a) === n)) {
        out[field] = i;
        break;
      }
    }
  });
  return out;
}

/** "12.10.2026", "12/10/2026", "2026-10-12" → "2026-10-12" */
export function normDate(s: string): string | null {
  const v = s.trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v))) [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])];
  else return null;
  // 31.02 gibi olmayan günler reddedilir
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "9:05", "09.05", "0905" → "09:05" */
export function normTime(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

export interface CsvRow {
  /** Dosyadaki satır numarası (başlık = 1) */
  line: number;
  title: string | null;
  text: string;
  /** "YYYY-MM-DD HH:mm" (çalışma alanı saati) ya da yoksa null → taslak */
  publishAt: string | null;
  channelTokens: string[];
  kind: PostKind;
  firstComment: string | null;
  draft: boolean;
  media: string[];
  /** Ayrıştırma sorunları (sunucu doğrulamasından önce) */
  problems: string[];
}

export function readRows(rows: string[][]): { fields: Partial<Record<CsvField, number>>; items: CsvRow[] } {
  const [header = [], ...body] = rows;
  const fields = mapHeader(header);
  const get = (r: string[], f: CsvField) => (fields[f] === undefined ? "" : (r[fields[f]!] ?? "").trim());
  const items = body.map((r, i): CsvRow => {
    const problems: string[] = [];
    let publishAt: string | null = null;
    const dt = get(r, "datetime");
    if (dt) {
      const [d0, t0] = dt.split(/[ T]+/);
      const d = normDate(d0 ?? "");
      const tm = normTime(t0 ?? "") ?? (t0 ? null : "09:00");
      if (!d || !tm) problems.push("date");
      else publishAt = `${d} ${tm}`;
    } else if (get(r, "date")) {
      const d = normDate(get(r, "date"));
      const tm = get(r, "time") ? normTime(get(r, "time")) : "09:00";
      if (!d) problems.push("date");
      else if (!tm) problems.push("time");
      else publishAt = `${d} ${tm}`;
    }
    const rawKind = norm(get(r, "kind"));
    const kind = rawKind ? KIND_ALIASES[rawKind] : "post";
    if (!kind) problems.push("kind");
    return {
      line: i + 2,
      title: get(r, "title") || null,
      text: fields.text === undefined ? "" : (r[fields.text] ?? "").replace(/\r\n/g, "\n").trim(),
      publishAt,
      channelTokens: get(r, "channels")
        .split(/[|;,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      kind: kind ?? "post",
      firstComment: get(r, "firstComment") || null,
      draft: YES.has(norm(get(r, "draft"))),
      media: get(r, "media")
        .split(/[\s|;,]+/)
        .map((x) => x.trim())
        .filter((x) => /^https?:\/\//i.test(x)),
      problems,
    };
  });
  return { fields, items };
}

/** Kanal belirteçleri: kanal kimliği, ağ (instagram → o ağın tüm kanalları), ağ adı, kanal adı ya da @kullanıcı adı */
export function resolveChannels(tokens: string[], channels: Channel[], fallback: string[] = []): { ids: string[]; unknown: string[] } {
  if (!tokens.length) return { ids: fallback, unknown: [] };
  const ids = new Set<string>();
  const unknown: string[] = [];
  const low = (s: string | null | undefined) => (s ?? "").replace(/^@/, "").toLocaleLowerCase("tr").trim();
  for (const tok of tokens) {
    const k = low(tok);
    const byId = channels.find((c) => c.id === tok);
    const byProvider = channels.filter((c) => c.provider === k || low(PROVIDER_NAME[c.provider as ProviderId]) === k || (k === "twitter" && c.provider === "x"));
    const byName = channels.filter((c) => low(c.name) === k || low(c.username) === k);
    const found = byId ? [byId] : byName.length ? byName : byProvider;
    if (!found.length) unknown.push(tok);
    found.forEach((c) => ids.add(c.id));
  }
  return { ids: [...ids], unknown };
}

/** Örnek şablon: bağlı kanalların ağlarıyla iki satır */
export function templateCsv(channels: Channel[], locale: "tr" | "en"): string {
  const nets = [...new Set(channels.map((c) => c.provider))].slice(0, 2);
  const ch = nets.length ? nets.join("|") : "instagram|facebook";
  const d = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const head = locale === "tr" ? ["metin", "tarih", "saat", "kanallar", "tür", "ilk yorum", "medya", "taslak"] : ["text", "date", "time", "channels", "kind", "first_comment", "media", "draft"];
  const rows = [
    head,
    [locale === "tr" ? "Hafta sonu kampanyası başladı! #indirim" : "Weekend sale is live! #sale", d, "10:00", ch, "post", "", "", ""],
    [locale === "tr" ? "Yeni ürün: satırlar arası\nçok satırlı metin de olur" : "New product: multi-line\ntext works too", d, "18:30", nets[0] ?? "instagram", "post", locale === "tr" ? "Ayrıntılar profilde" : "Details in bio", "https://ornek.com/gorsel.jpg", locale === "tr" ? "evet" : "yes"],
  ];
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}
