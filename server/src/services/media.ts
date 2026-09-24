import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "../core/config.js";
import { randomId } from "../core/crypto.js";
import { AppError } from "../core/i18n.js";
import { mediaRepo } from "../core/repos/misc.js";
import type { Ctx, MediaFile } from "../core/types.js";
import { requireRole } from "./access.js";
import { assertStorage } from "./limits.js";
import { mediaPublicUrl } from "./publisher.js";

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB (video)
const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|webm|x-m4v))$/;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
};

export function mimeExt(mime: string): string {
  return EXT_BY_MIME[mime] ?? "";
}

export function kindOf(mime: string): MediaFile["kind"] {
  return mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "other";
}

export function publicMedia(m: MediaFile) {
  return { ...m, url: `/media/${encodeURIComponent(m.filename)}`, publicUrl: mediaPublicUrl(m.filename) };
}

/** Özel/iç ağ adreslerine istek atmayı engelle (SSRF koruması) */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError(400, "err.validation", { detail: "url" });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new AppError(400, "err.validation", { detail: "url protocol" });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new AppError(400, "err.validation", { detail: "url host" });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new AppError(400, "err.validation", { detail: "private address not allowed" });
  return u;
}

/** Herkese açık URL'deki görseli/videoyu kütüphaneye al */
export async function importMediaFromUrl(ctx: Ctx, url: string, name?: string): Promise<MediaFile> {
  requireRole(ctx, "editor");
  const u = await assertPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(u, { signal: controller.signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new AppError(400, "err.validation", { detail: `download ${res.status}` });
    // Yönlendirme sonrası adres de herkese açık olmalı
    if (res.url && res.url !== u.toString()) await assertPublicUrl(res.url);
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME.test(mime)) throw new AppError(400, "err.validation", { detail: `unsupported type ${mime || "unknown"}` });
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new AppError(413, "err.validation", { detail: "file too large" });
    if (declared) assertStorage(ctx.orgId, declared);
    const id = randomId("med");
    const filename = `${id}${mimeExt(mime) || path.extname(u.pathname).toLowerCase()}`;
    const dest = path.join(config.mediaDir, filename);
    let size = 0;
    const limited = Readable.fromWeb(res.body as never).on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) limited.destroy(new Error("file too large"));
    });
    await pipeline(limited, fs.createWriteStream(dest));
    const originalName = (name ?? decodeURIComponent(path.basename(u.pathname)) ?? filename).slice(0, 200) || filename;
    return mediaRepo.create({ id, orgId: ctx.orgId, filename, originalName, mime, size, kind: kindOf(mime) });
  } finally {
    clearTimeout(timer);
  }
}

/** Multipart yükleme sonrası kayıt */
export async function saveUploadedStream(
  ctx: Ctx,
  file: NodeJS.ReadableStream & { truncated?: boolean },
  originalName: string,
  mime: string,
): Promise<MediaFile> {
  requireRole(ctx, "editor");
  const cleanMime = mime.toLowerCase();
  if (!ALLOWED_MIME.test(cleanMime)) throw new AppError(400, "err.validation", { detail: `unsupported type ${cleanMime}` });
  const id = randomId("med");
  const filename = `${id}${mimeExt(cleanMime) || path.extname(originalName).toLowerCase()}`;
  const dest = path.join(config.mediaDir, filename);
  await pipeline(file, fs.createWriteStream(dest));
  if (file.truncated) {
    fs.rmSync(dest, { force: true });
    throw new AppError(413, "err.validation", { detail: "file too large" });
  }
  const size = fs.statSync(dest).size;
  try {
    assertStorage(ctx.orgId, size);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  return mediaRepo.create({ id, orgId: ctx.orgId, filename, originalName: originalName.slice(0, 200) || filename, mime: cleanMime, size, kind: kindOf(cleanMime) });
}

export function deleteMedia(ctx: Ctx, id: string): void {
  requireRole(ctx, "editor");
  const m = mediaRepo.get(ctx.orgId, id);
  if (!m) return;
  fs.rmSync(path.join(config.mediaDir, m.filename), { force: true });
  mediaRepo.remove(ctx.orgId, id);
}
