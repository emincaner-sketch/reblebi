import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";

const log = createLogger("mail");

let transporter: Transporter | null = null;

/** Geliştirmede SMTP yoksa son e-postalar burada tutulur (admin panelinde görünür) */
const outbox: Array<{ to: string; subject: string; text: string; at: string }> = [];

export function mailConfigured(): boolean {
  return Boolean(config.mail.host);
}

function getTransporter(): Transporter | null {
  if (!mailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transporter;
}

function htmlFromText(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#6d5dfc">$1</a>');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e5ee">
<div style="font-weight:700;font-size:18px;margin-bottom:16px">${config.appName}</div>
<div style="font-size:14px;line-height:1.6;color:#171a24;white-space:pre-wrap">${linked}</div>
</div></body></html>`;
}

/** E-posta gönderimi asla ana akışı bozmamalı: hata loglanır, false döner */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    outbox.unshift({ to, subject, text, at: new Date().toISOString() });
    outbox.length = Math.min(outbox.length, 50);
    log.info("SMTP yapılandırılmamış; e-posta konsola yazıldı", { to, subject });
    log.info(text);
    return false;
  }
  try {
    await t.sendMail({ from: config.mail.from, to, subject, text, html: html ?? htmlFromText(text) });
    return true;
  } catch (e) {
    log.error("e-posta gönderilemedi", { to, subject, e: e instanceof Error ? e.message : e });
    return false;
  }
}

export function devOutbox() {
  return outbox;
}
