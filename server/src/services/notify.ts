import { pushNotification } from "./webpush.js";
import crypto from "node:crypto";
import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { t } from "../core/i18n.js";
import { notificationsRepo, webhooksRepo } from "../core/repos/content.js";
import { membershipsRepo, orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import type { Notification, WebhookEvent } from "../core/types.js";
import { sendMail } from "./mailer.js";

const log = createLogger("notify");

export function notify(orgId: string, input: { kind: Notification["kind"]; title: string; body?: string | null; link?: string | null; userId?: string | null }): void {
  try {
    notificationsRepo.add(orgId, input);
  } catch (e) {
    log.warn("bildirim yazılamadı", { e: e instanceof Error ? e.message : e });
  }
  // Abone cihazlara anlık bildirim (arka planda; hata akışı durdurmaz)
  void pushNotification(orgId, input).catch(() => undefined);
}

/** Org dilinde bildirim başlığı üret */
export function orgT(orgId: string, key: string, vars: Record<string, string | number> = {}): string {
  const org = orgsRepo.get(orgId);
  return t(org?.locale ?? config.defaultLocale, key, vars);
}

import { dispatchWorkflowEvent } from "./workflow-engine.js";

/**
 * Giden webhook: HMAC-SHA256 imzalı JSON POST.
 * Başlık: X-Reblebi-Signature: t=<unix>,v1=<hex(hmac(secret, t + "." + body))>
 * (Eski entegrasyonlar bozulmasın diye aynı değer X-SosyalPilot-Signature başlığında da gönderilir.)
 */
export function emitWebhook(orgId: string, event: WebhookEvent, data: Record<string, unknown>): void {
  // Zapier tipi iç iş akışlarını anında tetikle
  void dispatchWorkflowEvent(event as any, { ...data, event, orgId }, orgId);

  const hooks = webhooksRepo.forEvent(orgId, event);
  if (!hooks.length) return;
  const payload = JSON.stringify({ event, orgId, createdAt: new Date().toISOString(), data });
  for (const h of hooks) {
    void deliver(h.id, h.url, h.secret, payload);
  }
}

async function deliver(id: string, url: string, secret: string, payload: string, attempt = 1): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": `${config.appName}-Webhook/1.0`, "X-Reblebi-Signature": `t=${ts},v1=${sig}`, "X-SosyalPilot-Signature": `t=${ts},v1=${sig}` },
      body: payload,
      signal: controller.signal,
    });
    webhooksRepo.recordDelivery(id, res.status, res.ok ? null : (await res.text()).slice(0, 300));
    if (!res.ok && res.status >= 500 && attempt < 3) setTimeout(() => void deliver(id, url, secret, payload, attempt + 1), attempt * 30_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    webhooksRepo.recordDelivery(id, null, msg);
    if (attempt < 3) setTimeout(() => void deliver(id, url, secret, payload, attempt + 1), attempt * 30_000);
  } finally {
    clearTimeout(timer);
  }
}

/** Test amaçlı tek webhook'a örnek olay gönder */
export async function testWebhook(orgId: string, id: string): Promise<{ status: number | null; error: string | null }> {
  const h = webhooksRepo.get(orgId, id);
  if (!h) return { status: null, error: "not found" };
  await deliver(h.id, h.url, h.secret, JSON.stringify({ event: "test", orgId, createdAt: new Date().toISOString(), data: { hello: "world" } }), 3);
  const after = webhooksRepo.get(orgId, id);
  return { status: after?.lastStatus ?? null, error: after?.lastError ?? null };
}

/** Yayın hatasını sahiplere/yöneticilere e-posta ile bildir (ayar açıksa) */
export async function emailFailure(orgId: string, channelName: string, error: string, postId: string): Promise<void> {
  const s = orgSettingsRepo.get(orgId);
  if (!s.notifyOnFailureEmail) return;
  const org = orgsRepo.get(orgId);
  if (!org) return;
  const locale = org.locale;
  const recipients = membershipsRepo.list(orgId).filter((m) => m.role === "owner" || m.role === "admin");
  const link = `${config.appUrl}/app/posts/${postId}`;
  for (const r of recipients) {
    await sendMail(
      r.email,
      t(locale, "mail.failure.subject", { app: config.appName }),
      t(locale, "mail.failure.body", { org: org.name, channel: channelName, error: error.slice(0, 500), link }),
    );
  }
}
