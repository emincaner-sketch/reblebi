import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { notFound } from "../../core/i18n.js";
import { workflowRunsRepo, workflowsRepo } from "../../core/repos/workflows.js";
import { requireRole } from "../../services/access.js";
import { executeWorkflow } from "../../services/workflow-engine.js";
import { ctxOf, requireCtx } from "../context.js";

const IdParam = z.object({ id: z.string() });
const RunIdParam = z.object({ runId: z.string() });
const SlugParam = z.object({ slug: z.string() });

const WorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum([
    "filter",
    "paths",
    "formatter",
    "code",
    "looping",
    "ai",
    "sistemler",
    "delay",
    "action_post",
    "action_reply",
    "action_slack",
    "action_discord",
    "action_telegram",
    "action_calendar_event",
    "action_shopify",
    "action_webhook",
    "action_email",
    "action_notify",
  ]),
  name: z.string().min(1).max(100),
  config: z.record(z.string(), z.any()).default({}),
});

const WorkflowCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.number().int().min(0).max(1).default(1),
  triggerType: z.enum([
    "webhook.inbound",
    "shopify.order_created",
    "shopify.cart_abandoned",
    "stripe.payment_succeeded",
    "forms.submission",
    "post.published",
    "post.failed",
    "post.scheduled",
    "message.received",
    "rss.new_item",
    "schedule.cron",
    "manual",
  ]),
  triggerConfig: z.record(z.string(), z.any()).default({}),
  webhookSlug: z.string().max(80).nullable().optional(),
  steps: z.array(WorkflowStepSchema).default([]),
});

const WorkflowUpdateSchema = WorkflowCreateSchema.partial();

export const WORKFLOW_TEMPLATES = [
  {
    id: "shopify_panel_calendar",
    name: "Shopify Siparişi → Panel Zili Bildirimi → Takvime Ekle → Sosyal Medya Taslağı",
    description: "Shopify'dan yeni sipariş geldiğinde Reblebi paneline canlı bildirim düşürür, takvime kargolama görevi ekler ve kutlama gönderisi hazırlar.",
    triggerType: "shopify.order_created",
    triggerConfig: {},
    steps: [
      {
        id: "step_panel_notify",
        type: "action_notify",
        name: "Panel Ziline Anlık Bildirim Düşür",
        config: {
          title: "🎉 Yeni Sipariş: #{{trigger.order_number}} — {{trigger.total_price}} {{trigger.currency}}",
          body: "Müşteri: {{trigger.customer_name}} ({{trigger.shipping_city}})\nÜrünler: {{trigger.items_summary}}",
          kind: "ok",
        },
      },
      {
        id: "step_calendar_add",
        type: "action_calendar_event",
        name: "Teslimat / Sipariş Görevini Takvime Ekle",
        config: {
          title: "Sipariş Hazırlığı: #{{trigger.order_number}} ({{trigger.customer_name}})",
          content: "Sipariş no: #{{trigger.order_number}}\nMüşteri: {{trigger.customer_name}}\nŞehir: {{trigger.shipping_city}}\nÜrünler: {{trigger.items_summary}}",
          isDraft: true,
        },
      },
      {
        id: "step_brand_post",
        type: "sistemler",
        name: "Marka Hafızası ile Sosyal Başarı Taslağı",
        config: {
          system: "marka-hafizasi",
          input: "Yeni bir mutlu müşterimiz daha oldu! {{trigger.shipping_city}} şehrine #{{trigger.order_number}} nolu siparişi hazırlıyoruz. Samimi, enerjik bir Instagram hikayesi/gönderi taslağı yaz.",
        },
      },
      {
        id: "step_post_draft",
        type: "action_post",
        name: "Sosyal Medyaya Taslak Olarak Ekle",
        config: {
          publishMode: "draft",
          content: "{{steps.step_3.output}}",
          channelIds: [],
        },
      },
    ],
  },
  {
    id: "code_calc_workflow",
    name: "Özel JS Kod Motoru → KDV & Kar Marjı Hesapla → Discord Bildir",
    description: "Gelen webhook veya sipariş tutarını güvenli JavaScript koduyla işler, KDV ve net kar marjını hesaplayıp Discord'a raporlar.",
    triggerType: "webhook.inbound",
    triggerConfig: {},
    steps: [
      {
        id: "step_js_code",
        type: "code",
        name: "JavaScript ile Kar Hesapla",
        config: {
          code: `const price = Number(inputData.total_price || 1000);
const vat = price * 0.20;
const cost = price * 0.60;
const netProfit = price - vat - cost;
return {
  originalPrice: price,
  vatAmount: vat.toFixed(2),
  netProfit: netProfit.toFixed(2),
  marginPercent: ((netProfit / price) * 100).toFixed(1) + '%'
};`,
        },
      },
      {
        id: "step_discord_report",
        type: "action_discord",
        name: "Discord VIP Kanalına Raporla",
        config: {
          title: "📊 Yeni Finansal Rapor (JS Motoru)",
          description: "Sipariş Tutarı: {{steps.step_1.output.originalPrice}} TL\nKDV: {{steps.step_1.output.vatAmount}} TL\nNet Kar: {{steps.step_1.output.netProfit}} TL (Marj: {{steps.step_1.output.marginPercent}})",
          color: "#2ECC71",
        },
      },
    ],
  },
  {
    id: "rss_to_social",
    name: "RSS Feed → AI Özet & Hook → Sosyal Medyada Paylaş",
    description: "Blogunuzda veya haber kaynağınızda yeni içerik yayınlandığında AI ile sosyal medyaya uygun kanca ve özet çıkarıp otomatik paylaşır.",
    triggerType: "rss.new_item",
    triggerConfig: { rssUrl: "https://ornek.com/feed.xml" },
    steps: [
      {
        id: "step_ai_rewrite",
        type: "ai",
        name: "AI ile Sosyal Medyaya Uyarla",
        config: {
          mode: "rewrite",
          input: "{{trigger.title}}\n\n{{trigger.description}}\n\nKaynak: {{trigger.link}}",
        },
      },
      {
        id: "step_share_post",
        type: "action_post",
        name: "Kanallara Planla",
        config: {
          publishMode: "next_slot",
          content: "{{steps.step_1.output}}",
          channelIds: [],
        },
      },
    ],
  },
  {
    id: "shopify_order_webhook",
    name: "E-Ticaret Webhook → AI Müşteri Teşekkürü & Özel Kupon",
    description: "Shopify, WooCommerce veya Stripe'tan gelen yeni sipariş webhook'unu yakalar, Marka Hafızası ile tebrik metni üretir ve bildirim gönderir.",
    triggerType: "webhook.inbound",
    triggerConfig: {},
    steps: [
      {
        id: "step_filter_paid",
        type: "filter",
        name: "Ödeme Başarılı mı?",
        config: {
          match: "all",
          conditions: [
            { field: "trigger.body.financial_status", operator: "equals", value: "paid" },
          ],
        },
      },
      {
        id: "step_brand_voice",
        type: "sistemler",
        name: "Marka Hafızası Sesiyle Teşekkür",
        config: {
          system: "marka-hafizasi",
          input: "Müşteri {{trigger.body.customer.first_name}} yeni sipariş verdi (Tutar: {{trigger.body.total_price}} TL). Samimi bir teşekkür ve %15 indirim kuponu hazırla.",
        },
      },
      {
        id: "step_notify",
        type: "action_notify",
        name: "Ekibe Bildir",
        config: {
          title: "Yeni Sipariş Tebriki Hazır!",
          body: "{{steps.step_2.output}}",
          kind: "success",
        },
      },
    ],
  },
  {
    id: "dm_complaint_alert",
    name: "Gelen DM → AI Şikayet Tespiti → Anında Ekibe E-posta Bildirimi",
    description: "Gelen DM mesajlarını AI ile analiz eder. Şikayet veya iade içeriyorsa acil olarak destek ekibine e-posta atar.",
    triggerType: "message.received",
    triggerConfig: {},
    steps: [
      {
        id: "step_ai_sentiment",
        type: "ai",
        name: "Duygu & Niyet Analizi",
        config: {
          mode: "sentiment_analysis",
          input: "Gelen Mesaj: {{trigger.text}}",
        },
      },
      {
        id: "step_filter_complaint",
        type: "filter",
        name: "Şikayet mi?",
        config: {
          match: "any",
          conditions: [
            { field: "steps.step_1.output", operator: "contains", value: "şikayet" },
            { field: "steps.step_1.output", operator: "contains", value: "negatif" },
            { field: "trigger.text", operator: "contains", value: "iade" },
          ],
        },
      },
      {
        id: "step_email_alert",
        type: "action_email",
        name: "Destek Ekibine E-posta",
        config: {
          subject: "⚠️ Acil Müşteri Şikayeti Alındı: {{trigger.from}}",
          body: "Kanal: {{trigger.channelId}}\nGönderen: {{trigger.from}}\nMesaj:\n{{trigger.text}}\n\nAI Analizi:\n{{steps.step_1.output}}",
        },
      },
    ],
  },
  {
    id: "post_failure_webhook",
    name: "Yayın Hatası → Harici Webhook (Slack / Discord)",
    description: "Sosyal medyada paylaşım başarısız olduğunda Slack, Discord veya şirket webhook'una anında hata detayını iletir.",
    triggerType: "post.failed",
    triggerConfig: {},
    steps: [
      {
        id: "step_formatter",
        type: "formatter",
        name: "Hata Mesajını Biçimlendir",
        config: {
          type: "text",
          operation: "template_merge",
          template: "🚨 Reblebi Yayın Hatası!\nGönderi: {{trigger.title}}\nHata: {{trigger.targets[0].error}}",
        },
      },
      {
        id: "step_alert_webhook",
        type: "action_webhook",
        name: "Slack/Discord Webhook İsteği",
        config: {
          method: "POST",
          url: "https://webhook.site/test",
          body: '{"text": "{{steps.step_1.output}}"}',
        },
      },
    ],
  },
  {
    id: "weekly_trend_radar",
    name: "Haftalık Trend Radarı → AI İle 3 Viral İçerik Taslağı",
    description: "Trend Radarı ajanını kullanarak her pazartesi sektörel trend kancaları ve viral taslak fikirleri üretir.",
    triggerType: "schedule.cron",
    triggerConfig: { interval: "daily", hour: 9 },
    steps: [
      {
        id: "step_trend_analysis",
        type: "sistemler",
        name: "Trend Radarı Analizi",
        config: {
          system: "trend-radari",
          input: "Bu hafta sektörümüzdeki güncel trendler, dikkat çeken sorular ve paylaşılabilecek 3 viral içerik açısı.",
        },
      },
      {
        id: "step_notify_ideas",
        type: "action_notify",
        name: "İçerik Fikirlerini Bildir",
        config: {
          title: "Haftalık Trend Radarı Raporu Hazır",
          body: "{{steps.step_1.output}}",
          kind: "info",
        },
      },
    ],
  },
  {
    id: "carousel_creator_sistemler",
    name: "Sistemler Carousel Fabrikası → 3 Hook + 7 Slayt Taslağı",
    description: "Sistemler klasöründeki Carousel Üretici ajanını tetikleyerek 3 kanca ve 7 slaytlık profesyonel senaryo üretir.",
    triggerType: "webhook.inbound",
    triggerConfig: {},
    steps: [
      {
        id: "step_carousel",
        type: "sistemler",
        name: "Carousel & Slayt Yönergesi Üret",
        config: {
          system: "carousel-uretici",
          input: "{{trigger.body.topic}}",
        },
      },
      {
        id: "step_save_draft",
        type: "action_post",
        name: "Taslak Gönderi Oluştur",
        config: {
          title: "AI Carousel: {{trigger.body.topic}}",
          publishMode: "draft",
          content: "{{steps.step_1.output}}",
          channelIds: [],
        },
      },
    ],
  },
];

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  /* ============================================================
     Herkese Açık Inbound Webhook (Catch Hook) Uç Noktası
  ============================================================ */
  const handleCatchHook = async (req: FastifyRequest, reply: any) => {
    const { slug } = SlugParam.parse(req.params);
    const wf = workflowsRepo.getBySlug(slug);
    if (!wf || !wf.enabled) {
      return reply.code(404).send({ error: "Webhook bulunamadı veya pasif", slug });
    }

    const payload = {
      method: req.method,
      query: req.query ?? {},
      headers: req.headers ?? {},
      body: req.body ?? {},
      receivedAt: new Date().toISOString(),
    };

    // Arka planda çalıştır ve anında 200 OK dön
    void executeWorkflow(wf, payload);

    return reply.code(200).send({
      success: true,
      message: "Webhook başarıyla alındı ve iş akışı tetiklendi",
      workflow: { id: wf.id, name: wf.name },
    });
  };

  app.post("/api/webhooks/catch/:slug", handleCatchHook);
  app.get("/api/webhooks/catch/:slug", handleCatchHook);
  app.post("/webhooks/catch/:slug", handleCatchHook);
  app.get("/webhooks/catch/:slug", handleCatchHook);

  /* ============================================================
     Çalışma Alanı İçi Korumalı Rotalar
  ============================================================ */

  app.register(async (authed) => {
    authed.addHook("preHandler", requireCtx);

    // Hazır şablonlar
    authed.get("/api/workflows/templates", async () => WORKFLOW_TEMPLATES);

    // İş akışlarını listele
    authed.get("/api/workflows", async (req) => {
      const ctx = ctxOf(req);
      return workflowsRepo.list(ctx.orgId);
    });

    // Tek iş akışı getir
    authed.get("/api/workflows/:id", async (req) => {
      const ctx = ctxOf(req);
      const wf = workflowsRepo.get(ctx.orgId, IdParam.parse(req.params).id);
      if (!wf) throw notFound("workflow");
      return wf;
    });

    // Yeni iş akışı oluştur
    authed.post("/api/workflows", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const body = WorkflowCreateSchema.parse(req.body);
      return workflowsRepo.create({
        ...body,
        orgId: ctx.orgId,
        createdBy: ctx.userId,
      });
    });

    // İş akışı güncelle
    authed.put("/api/workflows/:id", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const { id } = IdParam.parse(req.params);
      const body = WorkflowUpdateSchema.parse(req.body);
      const updated = workflowsRepo.update(ctx.orgId, id, body);
      if (!updated) throw notFound("workflow");
      return updated;
    });

    // Aç / Kapat (Toggle)
    authed.post("/api/workflows/:id/toggle", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const { id } = IdParam.parse(req.params);
      const updated = workflowsRepo.toggle(ctx.orgId, id);
      if (!updated) throw notFound("workflow");
      return updated;
    });

    // Sil
    authed.delete("/api/workflows/:id", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const { id } = IdParam.parse(req.params);
      const ok = workflowsRepo.delete(ctx.orgId, id);
      if (!ok) throw notFound("workflow");
      return { ok: true };
    });

    // Test Çalıştırması (Canlı simülasyon)
    authed.post("/api/workflows/:id/test", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const { id } = IdParam.parse(req.params);
      const wf = workflowsRepo.get(ctx.orgId, id);
      if (!wf) throw notFound("workflow");

      const testPayload =
        req.body && typeof req.body === "object" && Object.keys(req.body).length > 0
          ? (req.body as Record<string, any>)
          : {
              title: "Reblebi Test Gönderisi",
              text: "Merhaba! Bu Reblebi otomasyon motoru test mesajıdır.",
              from: "Test Kullanıcısı",
              body: { topic: "AI ile Sosyal Medya Otomasyonu", customer: { first_name: "Mehmet" }, total_price: 1500, financial_status: "paid" },
            };

      const run = await executeWorkflow(wf, testPayload, { testMode: true });
      return run;
    });

    // İş akışı çalışma kayıtları (Runs)
    authed.get("/api/workflows/:id/runs", async (req) => {
      const ctx = ctxOf(req);
      const { id } = IdParam.parse(req.params);
      return workflowRunsRepo.list(ctx.orgId, id, 50);
    });

    // Tüm çalışma kayıtları
    authed.get("/api/workflows/runs", async (req) => {
      const ctx = ctxOf(req);
      return workflowRunsRepo.list(ctx.orgId, undefined, 50);
    });

    // Tek bir çalışma detayı
    authed.get("/api/workflows/runs/:runId", async (req) => {
      const ctx = ctxOf(req);
      const { runId } = RunIdParam.parse(req.params);
      const run = workflowRunsRepo.get(ctx.orgId, runId);
      if (!run) throw notFound("workflow_run");
      return run;
    });

    // Başarısız çalışmayı yeniden dene (Retry)
    authed.post("/api/workflows/runs/:runId/retry", async (req) => {
      const ctx = ctxOf(req);
      requireRole(ctx, "editor");
      const { runId } = RunIdParam.parse(req.params);
      const run = workflowRunsRepo.get(ctx.orgId, runId);
      if (!run) throw notFound("workflow_run");

      const wf = workflowsRepo.get(ctx.orgId, run.workflowId);
      if (!wf) throw notFound("workflow");

      const newRun = await executeWorkflow(wf, run.triggerPayload);
      return newRun;
    });
  });
}
