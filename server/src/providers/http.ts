import fs from "node:fs";
import { ProviderError } from "./types.js";

export interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** JSON gövde */
  json?: unknown;
  /** application/x-www-form-urlencoded gövde */
  form?: Record<string, string | number | boolean | undefined | null>;
  /** multipart/form-data gövde */
  multipart?: FormData;
  /** Ham gövde (dosya yükleme) */
  body?: Buffer | Uint8Array | string;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
  /** 429/5xx için tekrar sayısı */
  retries?: number;
  /** Yanıtı JSON yerine metin olarak döndür */
  asText?: boolean;
}

type FetchBody = NonNullable<RequestInit["body"]>;

function buildUrl(url: string, query?: HttpOptions["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function toForm(obj: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/** Tekrar denemeli, hata gövdesini koruyan fetch sarmalayıcı. */
export async function http<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once<T>(url, opts);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof ProviderError ? e.retryable : true;
      if (!retryable || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

async function once<T>(url: string, opts: HttpOptions): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: FetchBody | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toForm(opts.form);
  } else if (opts.multipart) {
    body = opts.multipart;
  } else if (opts.body !== undefined) {
    body = opts.body as FetchBody;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(buildUrl(url, opts.query), {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* metin kalsın */
      }
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(extractError(parsed, res.status), res.status, parsed, retryable);
    }
    if (opts.asText) return text as unknown as T;
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderError(`Ağ hatası: ${msg}`, undefined, undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

function extractError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error as Record<string, unknown> | string | undefined;
    if (typeof err === "string") return `${status}: ${err}${b.error_description ? " - " + b.error_description : ""}`;
    if (err && typeof err === "object") {
      const m = (err.message as string) ?? (err.error_user_msg as string) ?? JSON.stringify(err);
      const code = err.code !== undefined ? ` (kod ${err.code}${err.error_subcode ? "/" + err.error_subcode : ""})` : "";
      return `${status}: ${m}${code}`;
    }
    if (typeof b.message === "string") return `${status}: ${b.message}`;
    if (typeof b.description === "string") return `${status}: ${b.description}`;
    if (typeof b.detail === "string") return `${status}: ${b.detail}`;
    if (typeof b.title === "string") return `${status}: ${b.title}`;
    return `${status}: ${JSON.stringify(body).slice(0, 400)}`;
  }
  return `${status}: ${String(body).slice(0, 400)}`;
}

export function fileBlob(localPath: string, mime: string): Blob {
  return new Blob([fs.readFileSync(localPath)], { type: mime });
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Sağlayıcı yanıtlarında süre (saniye) -> ISO tarih */
export function expiresIn(seconds: number | undefined | null): string | null {
  if (!seconds || Number.isNaN(Number(seconds))) return null;
  return new Date(Date.now() + Number(seconds) * 1000).toISOString();
}
