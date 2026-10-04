import vm from "node:vm";
import { config } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { channelsRepo } from "../core/repos/channels.js";
import { orgSettingsRepo, orgsRepo } from "../core/repos/orgs.js";
import { workflowRunsRepo, workflowsRepo } from "../core/repos/workflows.js";
import type {
  Channel,
  Ctx,
  Workflow,
  WorkflowCondition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepExecution,
  WorkflowTriggerType,
} from "../core/types.js";
import { aiAvailable, resolveAiConfig } from "../ai/index.js";
import { aiText } from "../ai/providers.js";
import { createPost, type PostInput } from "./posts.js";
import { publishPost } from "./publisher.js";
import { sendMail } from "./mailer.js";
import { notify } from "./notify.js";
import { sendReply } from "./dm-engine.js";
import { inboxRepo } from "../core/repos/inbox.js";

const log = createLogger("workflows");

/* ---------------- Payload Normalizasyonu (Shopify, Stripe vb.) ---------------- */

export function normalizeTriggerPayload(triggerType: string, raw: Record<string, any>): Record<string, any> {
  const norm: Record<string, any> = { ...raw };

  // Shopify Order Webhook normalizasyonu
  if (triggerType.startsWith("shopify.") || raw.order_number || raw.line_items) {
    norm.order_id = raw.id ?? raw.order_id ?? "";
    norm.order_number = raw.order_number ?? raw.name ?? "";
    norm.total_price = raw.total_price ?? raw.current_total_price ?? "0.00";
    norm.currency = raw.currency ?? "TRY";
    norm.customer_name = raw.customer
      ? `${raw.customer.first_name || ""} ${raw.customer.last_name || ""}`.trim() || raw.customer.email
      : (raw.customer_name ?? "Misafir Müşteri");
    norm.customer_email = raw.customer?.email ?? raw.email ?? "";
    norm.customer_phone = raw.customer?.phone ?? raw.phone ?? "";
    norm.shipping_city = raw.shipping_address?.city ?? "";
    norm.financial_status = raw.financial_status ?? "paid";

    if (Array.isArray(raw.line_items)) {
      norm.items_summary = raw.line_items.map((i: any) => `${i.title} (${i.quantity}x)`).join(", ");
      norm.item_count = raw.line_items.reduce((acc: number, i: any) => acc + (Number(i.quantity) || 1), 0);
    }
  }

  // Stripe Payment Webhook normalizasyonu
  if (triggerType.startsWith("stripe.") || raw.object === "charge" || raw.object === "payment_intent") {
    norm.payment_id = raw.id ?? "";
    norm.amount = raw.amount ? (Number(raw.amount) / 100).toFixed(2) : "0.00";
    norm.currency = (raw.currency ?? "try").toUpperCase();
    norm.customer_email = raw.receipt_email ?? raw.billing_details?.email ?? "";
    norm.customer_name = raw.billing_details?.name ?? "";
  }

  return norm;
}

/* ---------------- Değişken Çözümleyici (Variable Interpolation) ---------------- */

export function resolvePath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function interpolate(template: string, scope: Record<string, any>): string {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (match, path) => {
    const val = resolvePath(scope, path);
    if (val === undefined || val === null) return "";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  });
}

export function interpolateDeep<T>(value: T, scope: Record<string, any>): T {
  if (typeof value === "string") {
    // Eğer tüm dize tek bir değişkense (örn. "{{steps.step_1.output}}") ve çıktı bir nesneyse doğrudan nesneyi döndür
    const match = value.trim().match(/^\{\{\s*([\w.[\]]+)\s*\}\}$/);
    if (match) {
      const resolved = resolvePath(scope, match[1]);
      if (resolved !== undefined) return resolved as T;
    }
    return interpolate(value, scope) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, scope)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = interpolateDeep(v, scope);
    }
    return res as T;
  }
  return value;
}

/* ---------------- Koşul Değerlendirme (Filter Evaluator) ---------------- */

export function evaluateCondition(cond: WorkflowCondition, scope: Record<string, any>): boolean {
  const rawActual = resolvePath(scope, cond.field);
  const actualStr = rawActual === undefined || rawActual === null ? "" : String(rawActual);
  const expectedStr = interpolate(cond.value ?? "", scope);

  switch (cond.operator) {
    case "equals":
      return actualStr.trim().toLowerCase() === expectedStr.trim().toLowerCase();
    case "not_equals":
      return actualStr.trim().toLowerCase() !== expectedStr.trim().toLowerCase();
    case "contains":
      return actualStr.toLowerCase().includes(expectedStr.toLowerCase());
    case "not_contains":
      return !actualStr.toLowerCase().includes(expectedStr.toLowerCase());
    case "starts_with":
      return actualStr.toLowerCase().startsWith(expectedStr.toLowerCase());
    case "ends_with":
      return actualStr.toLowerCase().endsWith(expectedStr.toLowerCase());
    case "regex":
      try {
        return new RegExp(expectedStr, "i").test(actualStr);
      } catch {
        return false;
      }
    case "greater_than":
      return Number(actualStr) > Number(expectedStr);
    case "less_than":
      return Number(actualStr) < Number(expectedStr);
    case "is_empty":
      return rawActual === undefined || rawActual === null || actualStr.trim() === "";
    case "is_not_empty":
      return rawActual !== undefined && rawActual !== null && actualStr.trim() !== "";
    default:
      return true;
  }
}

export function evaluateFilter(config: any, scope: Record<string, any>): { pass: boolean; details: any[] } {
  const conditions: WorkflowCondition[] = config.conditions || [];
  const matchMode = config.match === "any" ? "any" : "all";

  if (!conditions.length) return { pass: true, details: [] };

  const details = conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value,
    pass: evaluateCondition(c, scope),
  }));

  const pass = matchMode === "any" ? details.some((d) => d.pass) : details.every((d) => d.pass);
  return { pass, details };
}

/* ---------------- Formatter / Veri Dönüştürücü ---------------- */

export function runFormatter(config: any, scope: Record<string, any>): any {
  const type = config.type || "text";
  const op = config.operation || "trim";
  const input = interpolate(String(config.input ?? ""), scope);

  if (type === "text") {
    switch (op) {
      case "uppercase":
        return input.toLocaleUpperCase("tr-TR");
      case "lowercase":
        return input.toLocaleLowerCase("tr-TR");
      case "capitalize":
        return input.replace(/(?:^|\s)\S/g, (a) => a.toLocaleUpperCase("tr-TR"));
      case "trim":
        return input.trim();
      case "truncate": {
        const max = Number(config.max || config.length || 100);
        return input.length > max ? input.slice(0, max) + "..." : input;
      }
      case "replace": {
        const find = interpolate(String(config.find ?? ""), scope);
        const replaceWith = interpolate(String(config.replace ?? ""), scope);
        return input.replaceAll(find, replaceWith);
      }
      case "regex_extract": {
        try {
          const re = new RegExp(config.pattern, "i");
          const m = input.match(re);
          return m ? m[1] ?? m[0] : "";
        } catch {
          return "";
        }
      }
      case "template_merge":
        return interpolate(String(config.template ?? input), scope);
      default:
        return input;
    }
  }

  if (type === "math") {
    const num = Number(input) || 0;
    const operand = Number(interpolate(String(config.value ?? "0"), scope)) || 0;
    switch (op) {
      case "add":
        return num + operand;
      case "subtract":
        return num - operand;
      case "multiply":
        return num * operand;
      case "divide":
        return operand !== 0 ? num / operand : 0;
      case "round":
        return Math.round(num);
      default:
        return num;
    }
  }

  if (type === "date") {
    const d = input ? new Date(input) : new Date();
    if (isNaN(d.getTime())) return new Date().toISOString();
    switch (op) {
      case "add_hours": {
        const hours = Number(config.hours || 1);
        return new Date(d.getTime() + hours * 3600_000).toISOString();
      }
      case "add_days": {
        const days = Number(config.days || 1);
        return new Date(d.getTime() + days * 86400_000).toISOString();
      }
      case "format_date": {
        return d.toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" });
      }
      case "now_iso":
      default:
        return d.toISOString();
    }
  }

  return input;
}

/* ---------------- Zapier Code Runner (JavaScript Sandbox) ---------------- */

export function runCode(config: any, scope: Record<string, any>): any {
  const code = config.code || "return inputData;";
  const inputData = config.inputData ? interpolateDeep(config.inputData, scope) : scope;

  const sandbox: Record<string, any> = {
    inputData,
    output: {},
    console: {
      log: () => {},
    },
    Buffer,
    URL,
    Date,
    Math,
    JSON,
    parseInt,
    parseFloat,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };

  const context = vm.createContext(sandbox);
  const wrapped = `
    (function(inputData) {
      ${code}
    })(inputData)
  `;
  const script = new vm.Script(wrapped);
  const result = script.runInContext(context, { timeout: 3000 });
  return result !== undefined ? result : sandbox.output;
}

/* ---------------- Sistemler ve AI Entegrasyonu ---------------- */

const SISTEMLER_PROMPTS: Record<string, { role: string; instructions: string }> = {
  "marka-hafizasi": {
    role: "Marka Kimliği & Ses Tonu Ajanı",
    instructions: `Sen bir markanın Kimlik ve Ses Tonu yöneticisisin.
Verilen metni markanın değerlerine ve profesyonel üslubuna uygun hale getir.
Kurallar:
1. Samimi, özgüvenli, abartıdan uzak bir ses tonu kullan.
2. Basmakalıp reklam klişeleri ('benzersiz fırsat', 'şok kampanya', vb.) ve yasaklı kelimeleri kullanma.
3. Cümleleri akıcı ve net tut. Doğrudan hedef kitleye değer katan bir anlatımla yeniden yaz.`,
  },
  "carousel-uretici": {
    role: "Carousel & Hook Üretici Ajanı",
    instructions: `Sen sosyal medya için dikkat çekici Carousel (Kaydırmalı Gönderi) uzmanısın.
Girdi konusundan:
1. 3 farklı vurucu Kanca (Hook) başlığı üret (Merak, Karşıt Görüş, Sonuç odaklı).
2. 7 slaytlık kaydırmalı içerik metni hazırla (Slayt 1: Kanca, Slayt 2-6: Değer/Adımlar, Slayt 7: Net CTA).
3. Her slayt için tasarımcıya veya AI görsel motoruna hitap eden 1 cümlelik görsel yönergesi ekle.`,
  },
  "trend-radari": {
    role: "İçerik Trendleri & Niş Radarı",
    instructions: `Sen sosyal medya trend ve viral içerik stratejistisin.
Gelen konu/sektör için:
1. Şu an kitlenin ilgisini çekecek 3 trend bakış açısı çıkar.
2. Yorumlarda tartışma başlatacak 2 merak uyandırıcı soru üret.
3. Bu hafta Instagram, LinkedIn veya X'te paylaşılabilecek 3 viral taslak formatı sun.`,
  },
  "konsept-fabrikasi": {
    role: "Reklam & İçerik Konsept Fabrikası",
    instructions: `Sen performans pazarlaması ve yaratıcı konsept üreticisisin.
Girdi için 3 farklı yaratıcı konsept geliştir:
- Konsept 1: Problem-Çözüm (Müşterinin acı noktası -> Çözüm).
- Konsept 2: Sosyal Kanıt & Dönüşüm (Öncesi / Sonrası, Başarı hikayesi açısı).
- Konsept 3: Beklenmedik Kanca (Kalıplaşmış bir doğruyu yıkan açılış).
Her konsept için kanca + ana senaryo + eylem çağrısı belirt.`,
  },
  "review-madenci": {
    role: "Yorum & İtiraz Madencisi",
    instructions: `Sen müşteri psikolojisi ve itiraz karşılama uzmanısın.
Gelen müşteri mesajı, soru veya yorumunu derinlemesine analiz et:
1. Müşterinin açık ve örtük ana endişesini/itirazını tespit et (fiyat, güven, teslimat süresi, kalite vb.).
2. Bu itirazı empatik, güven veren ve doğrudan karşılayan profesyonel bir yanıt oluştur.
3. Müşteriyi nazikçe bir sonraki adıma (sipariş, kayıt, görüşme) yönlendirecek ikna edici bir kapanış cümlesi ekle.`,
  },
  "satis-sayfasi": {
    role: "Dönüşüm Odaklı Satış & Landing Page Metin Yazarı",
    instructions: `Sen yüksek dönüşümlü satış metni yazarı (Direct Response Copywriter) ajanısın.
Girdi için:
1. Mıknatıs gibi çeken bir Ana Başlık (Headline) ve Alt Başlık.
2. 3 adet sonuç odaklı Fayda Maddesi (Özellik değil, müşterinin elde edeceği kazanım).
3. Tereddütleri yıkan güçlü bir Harekete Geçirici Mesaj (CTA butonu metni ve destekleyici güvence cümlesi) oluştur.`,
  },
};

export async function runAiOrSistemler(
  orgId: string,
  type: "ai" | "sistemler",
  config: any,
  scope: Record<string, any>
): Promise<string> {
  const inputText = interpolate(String(config.input || config.prompt || ""), scope);
  const cfg = resolveAiConfig(orgId);

  if (type === "sistemler") {
    const systemKey = config.system || "marka-hafizasi";
    const sys = SISTEMLER_PROMPTS[systemKey] || SISTEMLER_PROMPTS["marka-hafizasi"];
    const prompt = `${sys.instructions}\n\nİncelenecek Metin/Konu:\n${inputText}`;

    if (!cfg) {
      // AI yapılandırılmamışsa zeki şablon çıktısı üret
      return `[${sys.role}] İşlendi:\n${inputText}\n\nÖneri: Harika bir içerik açısı. Hedef kitleye samimi bir dille sunun.`;
    }
    return (await aiText(cfg, { system: sys.role, user: prompt, maxTokens: 1500 })).trim();
  }

  // Standart AI
  const mode = config.mode || "custom";
  let prompt = inputText;
  let systemRole = "Sosyal medya ve içerik otomasyonu asistanı.";

  switch (mode) {
    case "summarize":
      prompt = `Aşağıdaki metni Türkçe olarak kısa ve vurucu bir şekilde 2-3 cümlede özetle:\n\n${inputText}`;
      break;
    case "rewrite":
      prompt = `Aşağıdaki metni sosyal medyada paylaşılacak ilgi çekici, samimi ve akıcı bir dille yeniden yaz:\n\n${inputText}`;
      break;
    case "extract_hashtags":
      prompt = `Aşağıdaki metne uygun, etkileşimi artıracak 5-8 adet popüler ve alakalı Türkçe hashtag çıkar. Sadece hashtagleri listele:\n\n${inputText}`;
      break;
    case "sentiment_analysis":
      prompt = `Aşağıdaki müşteri mesajının duygu durumunu (pozitif, nötr, negatif, acil şikayet) ve kısa sebebini belirt:\n\n${inputText}`;
      break;
    case "translate":
      prompt = `Aşağıdaki metni akıcı bir Türkçeye çevir:\n\n${inputText}`;
      break;
    default:
      prompt = interpolate(String(config.prompt || inputText), scope);
      break;
  }

  if (!cfg) {
    return inputText;
  }

  return (await aiText(cfg, { system: systemRole, user: prompt, maxTokens: 1500 })).trim();
}

/* ---------------- Eylemler (Actions) ---------------- */

export async function runAction(
  workflow: Workflow,
  step: WorkflowStep,
  scope: Record<string, any>
): Promise<any> {
  const conf = step.config || {};
  const org = orgsRepo.get(workflow.orgId);
  const locale = org?.locale ?? config.defaultLocale;

  switch (step.type) {
    case "action_post": {
      const channelIds: string[] = conf.channelIds || [];
      const content = interpolate(String(conf.content || ""), scope);
      const publishMode = conf.publishMode || "next_slot"; // "now" | "next_slot" | "draft"
      const mediaUrls: string[] = conf.mediaUrls ? interpolateDeep(conf.mediaUrls, scope) : [];

      if (!channelIds.length) {
        throw new Error("action_post: En az bir kanal seçilmelidir.");
      }

      const input: PostInput = {
        title: conf.title ? interpolate(String(conf.title), scope) : null,
        content,
        publishAt: publishMode === "now" ? "now" : publishMode === "next_slot" ? "next_slot" : null,
        draft: publishMode === "draft",
        targets: channelIds.map((cid) => ({ channelId: cid })),
      };

      const systemCtx: Ctx = {
        orgId: workflow.orgId,
        userId: workflow.createdBy,
        role: "admin",
        via: "system",
        locale,
      };

      const post = await createPost(systemCtx, input, { skipPublish: true });
      if (publishMode === "now" && post.id) {
        await publishPost(post.id).catch((e) =>
          log.warn("Gönderi hemen yayınlama hatası", { e: e instanceof Error ? e.message : e })
        );
      }

      return { postId: post.id, status: post.status, content: post.content, publishAt: post.publishAt };
    }

    case "action_reply": {
      const text = interpolate(String(conf.text || ""), scope);
      const conversationId =
        conf.conversationId ? interpolate(String(conf.conversationId), scope) : scope.trigger?.conversationId;

      if (!conversationId) {
        throw new Error("action_reply: conversationId bulunamadı.");
      }

      const conv = inboxRepo.getConversation(workflow.orgId, conversationId);
      if (!conv) throw new Error(`action_reply: Konuşma bulunamadı (${conversationId})`);

      const ch = channelsRepo.get(workflow.orgId, conv.channelId);
      if (!ch) throw new Error("action_reply: Bağlı kanal bulunamadı");

      const msg = await sendReply(ch, conv, text, "rule");
      return { messageId: msg.id, text: msg.text, status: msg.status };
    }

    case "action_webhook": {
      const url = interpolate(String(conf.url || ""), scope);
      const method = (conf.method || "POST").toUpperCase();
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      if (conf.headers) {
        headers = { ...headers, ...interpolateDeep(conf.headers, scope) };
      }

      let bodyData: any = undefined;
      if (method !== "GET" && method !== "HEAD") {
        if (conf.body) {
          const raw = interpolate(String(conf.body), scope);
          try {
            bodyData = JSON.parse(raw);
          } catch {
            bodyData = raw;
          }
        } else {
          bodyData = scope;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: bodyData ? (typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData)) : undefined,
          signal: controller.signal,
        });

        const text = await res.text();
        let parsed: any = text;
        try {
          parsed = JSON.parse(text);
        } catch {}

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        }

        return { status: res.status, data: parsed };
      } finally {
        clearTimeout(timeout);
      }
    }

    case "action_email": {
      const to = conf.to ? interpolate(String(conf.to), scope) : config.mail.user;
      const subject = interpolate(String(conf.subject || "Reblebi Otomasyon Bildirimi"), scope);
      const body = interpolate(String(conf.body || ""), scope);

      if (!to) throw new Error("action_email: Alıcı e-posta adresi belirtilmemiş.");
      await sendMail(to, subject, body);
      return { sent: true, to, subject };
    }

    case "action_notify": {
      const title = interpolate(String(conf.title || "Otomasyon"), scope);
      const body = conf.body ? interpolate(String(conf.body), scope) : null;
      const kind = conf.kind || "info";

      notify(workflow.orgId, {
        kind,
        title,
        body,
        link: conf.link ? interpolate(String(conf.link), scope) : null,
      });

      return { notified: true, title, kind };
    }

    case "action_slack": {
      const webhookUrl = conf.webhookUrl ? interpolate(String(conf.webhookUrl), scope) : null;
      const channel = conf.channel ? interpolate(String(conf.channel), scope) : undefined;
      const message = interpolate(String(conf.message || conf.text || "Yeni Reblebi bildirimi"), scope);
      const botName = conf.botName ? interpolate(String(conf.botName), scope) : "Reblebi Otomasyon";
      const iconEmoji = conf.iconEmoji || ":rocket:";

      if (!webhookUrl && !channel) {
        throw new Error("action_slack: Webhook URL veya Slack Kanalı zorunludur.");
      }

      const payload: Record<string, any> = {
        text: message,
        username: botName,
        icon_emoji: iconEmoji,
      };
      if (channel) payload.channel = channel;
      if (conf.blocks) payload.blocks = interpolateDeep(conf.blocks, scope);

      if (webhookUrl) {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Slack HTTP ${res.status}: ${errText.slice(0, 300)}`);
        }
      }
      return { ok: true, channel, sentText: message };
    }

    case "action_discord": {
      const webhookUrl = conf.webhookUrl ? interpolate(String(conf.webhookUrl), scope) : null;
      const content = conf.content ? interpolate(String(conf.content), scope) : undefined;
      const title = conf.title ? interpolate(String(conf.title), scope) : undefined;
      const description = interpolate(String(conf.description || conf.text || ""), scope);
      const hexColor = (conf.color || "#5865F2").replace("#", "");
      const color = parseInt(hexColor, 16) || 0x5865f2;

      if (!webhookUrl) throw new Error("action_discord: Webhook URL zorunludur.");

      const payload: Record<string, any> = {};
      if (content) payload.content = content;
      if (title || description) {
        payload.embeds = [
          {
            title,
            description,
            color,
            fields: conf.fields ? interpolateDeep(conf.fields, scope) : undefined,
            timestamp: new Date().toISOString(),
            footer: { text: "Reblebi · Otomasyon Motoru" },
          },
        ];
      }

      const res = await fetch(`${webhookUrl}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Discord HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, id: (data as any)?.id, title };
    }

    case "action_telegram": {
      const botToken = conf.botToken ? interpolate(String(conf.botToken), scope) : null;
      const chatId = conf.chatId ? interpolate(String(conf.chatId), scope) : null;
      const text = interpolate(String(conf.text || conf.message || ""), scope);

      if (!botToken || !chatId) {
        throw new Error("action_telegram: Bot Token ve Chat ID zorunludur.");
      }

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: conf.parseMode || "Markdown",
          disable_web_page_preview: conf.disablePreview ?? false,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!data?.ok) {
        throw new Error(`Telegram: ${data?.description || "Bilinmeyen hata"}`);
      }
      return { ok: true, messageId: data.result?.message_id };
    }

    case "action_calendar_event": {
      const title = interpolate(String(conf.title || "Planlı Otomasyon Etkinliği"), scope);
      const content = interpolate(String(conf.content || conf.description || title), scope);
      const scheduledAt = conf.scheduledAt ? interpolate(String(conf.scheduledAt), scope) : null;
      const channelIds: string[] = conf.channelIds || [];

      const systemCtx: Ctx = {
        orgId: workflow.orgId,
        userId: workflow.createdBy,
        role: "admin",
        via: "system",
        locale,
      };

      const post = await createPost(
        systemCtx,
        {
          title,
          content,
          publishAt: scheduledAt || "next_slot",
          draft: conf.isDraft ?? true,
          targets: channelIds.map((cid) => ({ channelId: cid })),
        },
        { skipPublish: true }
      );

      return { ok: true, eventId: post.id, title, scheduledAt: post.publishAt };
    }

    case "action_shopify": {
      const shop = conf.shopDomain ? interpolate(String(conf.shopDomain), scope) : null;
      const token = conf.accessToken ? interpolate(String(conf.accessToken), scope) : null;
      const orderId = conf.orderId ? interpolate(String(conf.orderId), scope) : scope.trigger?.order_id || scope.trigger?.id;
      const note = conf.note ? interpolate(String(conf.note), scope) : null;
      const tags = conf.tags ? interpolate(String(conf.tags), scope) : null;

      if (!shop || !token || !orderId) {
        return { ok: true, shop, orderId, note, tags, simulated: true };
      }

      const res = await fetch(`https://${shop}/admin/api/2024-01/orders/${orderId}.json`, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order: {
            id: Number(orderId),
            note: note || undefined,
            tags: tags || undefined,
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Shopify HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, order: (data as any)?.order };
    }

    default:
      throw new Error(`Bilinmeyen eylem tipi: ${step.type}`);
  }
}

/* ---------------- İş Akışı Yürütücüsü (Workflow Engine Main) ---------------- */

export async function executeWorkflow(
  workflow: Workflow,
  triggerPayload: Record<string, any>,
  options?: { testMode?: boolean }
): Promise<WorkflowRun> {
  const startTime = Date.now();
  const run = workflowRunsRepo.create({
    workflowId: workflow.id,
    orgId: workflow.orgId,
    triggerType: workflow.triggerType,
    triggerPayload,
    status: "running",
  });

  const normalizedTrigger = normalizeTriggerPayload(workflow.triggerType, triggerPayload);
  const scope: Record<string, any> = {
    trigger: normalizedTrigger,
    steps: {},
    env: { appName: config.appName, publicUrl: config.publicUrl },
  };

  const executedSteps: WorkflowStepExecution[] = [];
  let currentStatus: "success" | "failed" | "filtered" = "success";
  let executionError: string | null = null;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const stepStart = Date.now();
    const stepKey = `step_${i + 1}`;

    try {
      if (step.type === "filter") {
        const res = evaluateFilter(step.config, scope);
        const durationMs = Date.now() - stepStart;
        if (!res.pass) {
          executedSteps.push({
            stepId: step.id,
            name: step.name,
            type: step.type,
            status: "filtered",
            input: step.config,
            output: res,
            durationMs,
          });
          currentStatus = "filtered";
          break; // Akış durdurulur
        }
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: step.config,
          output: res,
          durationMs,
        });
        scope.steps[stepKey] = { output: res };
        continue;
      }

      if (step.type === "code") {
        const output = runCode(step.config, scope);
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: step.config,
          output,
          durationMs,
        });
        scope.steps[stepKey] = { output };
        continue;
      }

      if (step.type === "paths") {
        const paths: any[] = step.config?.paths || [];
        let matchedPath: any = null;
        for (const p of paths) {
          const filterRes = evaluateFilter(p, scope);
          if (filterRes.pass) {
            matchedPath = p;
            break;
          }
        }
        const output: Record<string, any> = {
          selectedPath: matchedPath ? matchedPath.name : "none",
          pathResults: [],
        };
        if (matchedPath && Array.isArray(matchedPath.steps)) {
          for (const subStep of matchedPath.steps) {
            const subRes = await runAction(workflow, subStep, scope);
            output.pathResults.push({ subStepId: subStep.id, result: subRes });
          }
        }
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: step.config,
          output,
          durationMs,
        });
        scope.steps[stepKey] = { output };
        continue;
      }

      if (step.type === "looping") {
        const rawItems = interpolateDeep(step.config?.items || [], scope);
        const items = Array.isArray(rawItems) ? rawItems.slice(0, 50) : [];
        const loopResults: any[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          const loopScope = { ...scope, item: items[idx], index: idx };
          if (step.config?.step) {
            const subRes = await runAction(workflow, step.config.step, loopScope);
            loopResults.push(subRes);
          }
        }
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: { count: items.length },
          output: { itemsProcessed: items.length, loopResults },
          durationMs,
        });
        scope.steps[stepKey] = { output: { itemsProcessed: items.length, loopResults } };
        continue;
      }

      if (step.type === "formatter") {
        const output = runFormatter(step.config, scope);
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: step.config,
          output,
          durationMs,
        });
        scope.steps[stepKey] = { output };
        continue;
      }

      if (step.type === "ai" || step.type === "sistemler") {
        const output = await runAiOrSistemler(workflow.orgId, step.type, step.config, scope);
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: step.config,
          output,
          durationMs,
        });
        scope.steps[stepKey] = { output };
        continue;
      }

      if (step.type === "delay") {
        const seconds = Math.min(Number(step.config?.seconds || 1), 60);
        await new Promise((r) => setTimeout(r, seconds * 1000));
        const durationMs = Date.now() - stepStart;
        executedSteps.push({
          stepId: step.id,
          name: step.name,
          type: step.type,
          status: "success",
          input: { seconds },
          output: { delayedSeconds: seconds },
          durationMs,
        });
        scope.steps[stepKey] = { output: { delayedSeconds: seconds } };
        continue;
      }

      // Actions
      const output = await runAction(workflow, step, scope);
      const durationMs = Date.now() - stepStart;
      executedSteps.push({
        stepId: step.id,
        name: step.name,
        type: step.type,
        status: "success",
        input: step.config,
        output,
        durationMs,
      });
      scope.steps[stepKey] = { output };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const durationMs = Date.now() - stepStart;
      executedSteps.push({
        stepId: step.id,
        name: step.name,
        type: step.type,
        status: "failed",
        input: step.config,
        output: null,
        durationMs,
        error: msg,
      });
      currentStatus = "failed";
      executionError = `Adım '${step.name}' hatası: ${msg}`;
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  workflowRunsRepo.update(run.id, {
    status: currentStatus,
    error: executionError,
    stepsExecuted: executedSteps,
    durationMs: totalDurationMs,
  });

  if (!options?.testMode) {
    workflowsRepo.recordRun(workflow.id, currentStatus);
  }

  return workflowRunsRepo.get(workflow.orgId, run.id)!;
}

/* ---------------- Olay Dağıtıcı (Event Dispatcher) ---------------- */

export async function dispatchWorkflowEvent(
  triggerType: WorkflowTriggerType,
  payload: Record<string, any>,
  orgId?: string
): Promise<void> {
  const workflows = workflowsRepo.forTrigger(triggerType, orgId);
  if (!workflows.length) return;

  for (const wf of workflows) {
    // Kanal kısıtlaması varsa filtrele
    if (wf.triggerConfig?.channelId && payload.channelId && wf.triggerConfig.channelId !== payload.channelId) {
      continue;
    }
    // Arka planda çalıştır
    executeWorkflow(wf, payload).catch((e) =>
      log.error(`İş akışı çalıştırma hatası [${wf.name}]`, { e: e instanceof Error ? e.message : e })
    );
  }
}

/* ---------------- RSS Feed Okuyucu ---------------- */

const lastSeenRssGuids = new Map<string, Set<string>>();

export function parseRssXml(xml: string): Array<{ title: string; link: string; description: string; pubDate: string; guid: string }> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string; guid: string }> = [];
  const itemMatches = xml.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi);

  const clean = (s: string) =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

  for (const match of itemMatches) {
    const raw = match[1];
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = raw.match(/<link[^>]*href=["']([^"']+)["']/i) || raw.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch =
      raw.match(/<content[^>]*>([\s\S]*?)<\/content>/i) ||
      raw.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
      raw.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const dateMatch = raw.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
    const guidMatch = raw.match(/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i);

    const title = titleMatch ? clean(titleMatch[1]) : "";
    const link = linkMatch ? clean(linkMatch[1]) : "";
    const description = descMatch ? clean(descMatch[1]) : "";
    const pubDate = dateMatch ? clean(dateMatch[1]) : "";
    const guid = guidMatch ? clean(guidMatch[1]) : link || title;

    if (title || link) {
      items.push({ title, link, description, pubDate, guid });
    }
  }

  return items;
}

export async function checkRssWorkflows(): Promise<void> {
  const workflows = workflowsRepo.forTrigger("rss.new_item");
  if (!workflows.length) return;

  for (const wf of workflows) {
    const url = wf.triggerConfig?.rssUrl;
    if (!url) continue;

    try {
      const res = await fetch(url, { headers: { "User-Agent": "Reblebi-RSS/1.0" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const text = await res.text();
      const items = parseRssXml(text);
      if (!items.length) continue;

      let seen = lastSeenRssGuids.get(wf.id);
      if (!seen) {
        // İlk çalışmada mevcutları gördü sayalım ki geçmiş tüm haberleri bir anda paylaşmasın
        seen = new Set(items.map((i) => i.guid));
        lastSeenRssGuids.set(wf.id, seen);
        continue;
      }

      for (const item of items) {
        if (!seen.has(item.guid)) {
          seen.add(item.guid);
          void executeWorkflow(wf, {
            ...item,
            text: `${item.title}\n\n${item.description}\n\n${item.link}`,
          });
        }
      }
    } catch (e) {
      log.warn("RSS akış hatası", { wf: wf.id, url, err: e instanceof Error ? e.message : e });
    }
  }
}

/* ---------------- Zamanlanmış Cron Tetikleyicisi ---------------- */

export async function checkCronWorkflows(): Promise<void> {
  const workflows = workflowsRepo.forTrigger("schedule.cron");
  if (!workflows.length) return;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  for (const wf of workflows) {
    const interval = wf.triggerConfig?.interval || "daily"; // "hourly", "daily"
    const targetHour = Number(wf.triggerConfig?.hour ?? 9);

    if (interval === "hourly") {
      // Her saat başı (ilk 3 dakikada bir kere)
      if (currentMinute <= 3) {
        const lastRun = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
        if (Date.now() - lastRun > 50 * 60_000) {
          void executeWorkflow(wf, { triggeredAt: now.toISOString(), interval });
        }
      }
    } else if (interval === "daily") {
      // Günde bir kez belirtilen saatte
      if (currentHour === targetHour && currentMinute <= 3) {
        const lastRun = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
        if (Date.now() - lastRun > 20 * 3600_000) {
          void executeWorkflow(wf, { triggeredAt: now.toISOString(), interval, hour: targetHour });
        }
      }
    }
  }
}
