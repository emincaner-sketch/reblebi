import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-wf-"));
process.env.DATA_DIR = dir;

const { orgsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { workflowsRepo, workflowRunsRepo } = await import("../src/core/repos/workflows.js");
const {
  interpolate,
  evaluateCondition,
  evaluateFilter,
  runFormatter,
  runAiOrSistemler,
  executeWorkflow,
  dispatchWorkflowEvent,
} = await import("../src/services/workflow-engine.js");

const testUser = usersRepo.create({ email: "test@ornek.com", password: "Password123!", name: "Test User", locale: "tr" });
const testOrg = orgsRepo.create({
  name: "Workflow Test Org",
  plan: "unlimited",
  timezone: "Europe/Istanbul",
  locale: "tr",
  ownerId: testUser.id,
});

test("Değişken interpolasyonu ve derin yol çözümleme", () => {
  const scope = {
    trigger: {
      title: "Yeni Kampanya",
      author: { name: "Ahmet", role: "Manager" },
      items: ["item1", "item2"],
    },
    steps: {
      step_1: { output: "AI çıktısı metin" },
    },
  };

  assert.equal(interpolate("Başlık: {{trigger.title}}", scope), "Başlık: Yeni Kampanya");
  assert.equal(interpolate("Yazan: {{trigger.author.name}} ({{trigger.author.role}})", scope), "Yazan: Ahmet (Manager)");
  assert.equal(interpolate("AI: {{steps.step_1.output}}", scope), "AI: AI çıktısı metin");
  assert.equal(interpolate("Bilinmeyen: {{trigger.missing}}", scope), "Bilinmeyen: ");
});

test("Filtre ve koşul değerlendirici (AND / OR)", () => {
  const scope = {
    trigger: {
      text: "Fiyat nedir acaba?",
      amount: 150,
      status: "active",
      emptyField: "",
    },
  };

  // contains
  assert.equal(evaluateCondition({ field: "trigger.text", operator: "contains", value: "fiyat" }, scope), true);
  assert.equal(evaluateCondition({ field: "trigger.text", operator: "contains", value: "kargo" }, scope), false);

  // greater_than
  assert.equal(evaluateCondition({ field: "trigger.amount", operator: "greater_than", value: "100" }, scope), true);
  assert.equal(evaluateCondition({ field: "trigger.amount", operator: "less_than", value: "50" }, scope), false);

  // is_empty / is_not_empty
  assert.equal(evaluateCondition({ field: "trigger.emptyField", operator: "is_empty", value: "" }, scope), true);
  assert.equal(evaluateCondition({ field: "trigger.status", operator: "is_not_empty", value: "" }, scope), true);

  // evaluateFilter: all
  const filterAll = evaluateFilter(
    {
      match: "all",
      conditions: [
        { field: "trigger.text", operator: "contains", value: "fiyat" },
        { field: "trigger.amount", operator: "greater_than", value: "100" },
      ],
    },
    scope
  );
  assert.equal(filterAll.pass, true);

  // evaluateFilter: any
  const filterAny = evaluateFilter(
    {
      match: "any",
      conditions: [
        { field: "trigger.text", operator: "contains", value: "olmayan" },
        { field: "trigger.amount", operator: "greater_than", value: "100" },
      ],
    },
    scope
  );
  assert.equal(filterAny.pass, true);
});

test("Formatter / Veri Dönüştürücü işlemleri", () => {
  const scope = {
    trigger: {
      name: "   mehmet demir   ",
      count: 10,
    },
  };

  // trim & uppercase
  assert.equal(runFormatter({ type: "text", operation: "trim", input: "{{trigger.name}}" }, scope), "mehmet demir");
  assert.equal(runFormatter({ type: "text", operation: "uppercase", input: "sosyalpilot" }, scope), "SOSYALPİLOT");
  assert.equal(runFormatter({ type: "text", operation: "capitalize", input: "mehmet demir" }, scope), "Mehmet Demir");

  // truncate
  assert.equal(runFormatter({ type: "text", operation: "truncate", input: "Bu çok uzun bir metin", max: 6 }, scope), "Bu çok...");

  // math
  assert.equal(runFormatter({ type: "math", operation: "add", input: "{{trigger.count}}", value: "5" }, scope), 15);
  assert.equal(runFormatter({ type: "math", operation: "multiply", input: "{{trigger.count}}", value: "3" }, scope), 30);
});

test("Sistemler Ajanı (Marka Hafızası, Carousel, vb.)", async () => {
  const scope = { trigger: { topic: "E-ihracat ve Sosyal Medya" } };

  const outMarka = await runAiOrSistemler(testOrg.id, "sistemler", { system: "marka-hafizasi", input: "Yaz indirimleri başladı!" }, scope);
  assert.ok(typeof outMarka === "string" && outMarka.length > 0);

  const outCarousel = await runAiOrSistemler(testOrg.id, "sistemler", { system: "carousel-uretici", input: "{{trigger.topic}}" }, scope);
  assert.ok(typeof outCarousel === "string" && outCarousel.length > 0);
});

test("İş akışı oluşturma, yürütme ve adım günlüğü (Workflow Run Log)", async () => {
  const wf = workflowsRepo.create({
    orgId: testOrg.id,
    name: "Zapier Test Akışı",
    description: "Otomasyon testi",
    triggerType: "webhook.inbound",
    triggerConfig: {},
    steps: [
      {
        id: "step_1",
        type: "formatter",
        name: "Başlığı Büyük Harf Yap",
        config: { type: "text", operation: "uppercase", input: "{{trigger.title}}" },
      },
      {
        id: "step_2",
        type: "filter",
        name: "Başlık kontrolü",
        config: {
          match: "all",
          conditions: [{ field: "steps.step_1.output", operator: "contains", value: "TEST" }],
        },
      },
      {
        id: "step_3",
        type: "action_notify",
        name: "Test Bildirimi",
        config: { title: "Bildirim: {{steps.step_1.output}}", body: "İşlem başarıyla tamamlandı", kind: "success" },
      },
    ],
  });

  assert.ok(wf.id);
  assert.ok(wf.webhookSlug);

  // Çalıştır
  const run = await executeWorkflow(wf, { title: "test akisi calisiyor" });
  assert.equal(run.status, "success");
  assert.equal(run.stepsExecuted.length, 3);
  assert.equal(run.stepsExecuted[0].output, "TEST AKİSİ CALİSİYOR");
  assert.equal(run.stepsExecuted[1].status, "success");
  assert.equal(run.stepsExecuted[2].status, "success");

  // Güncellenen workflow durumu
  const updatedWf = workflowsRepo.get(testOrg.id, wf.id);
  assert.equal(updatedWf?.runCount, 1);
  assert.equal(updatedWf?.lastStatus, "success");

  // Filtre başarısız olursa filtered durumuna geçme
  const runFiltered = await executeWorkflow(wf, { title: "baska bir konu" });
  assert.equal(runFiltered.status, "filtered");
});

test("Code by Zapier (JavaScript Sandbox) çalışması", async () => {
  const { runCode } = await import("../src/services/workflow-engine.js");

  const scope = {
    trigger: {
      total_price: "1200",
      customer: "Ali Veli",
    },
  };

  const config = {
    code: `
      const price = Number(inputData.trigger.total_price);
      const vat = price * 0.20;
      return {
        price,
        vat,
        grandTotal: price + vat
      };
    `,
  };

  const res = runCode(config, scope);
  assert.equal(res.price, 1200);
  assert.equal(res.vat, 240);
  assert.equal(res.grandTotal, 1440);
});

test("Shopify Payload Normalizasyonu", async () => {
  const { normalizeTriggerPayload } = await import("../src/services/workflow-engine.js");

  const shopifyRaw = {
    id: 987654321,
    order_number: 1042,
    total_price: "750.50",
    currency: "TRY",
    customer: { first_name: "Ayşe", last_name: "Yılmaz", email: "ayse@ornek.com" },
    shipping_address: { city: "İzmir" },
    line_items: [
      { title: "Deri Ceket", quantity: 1 },
      { title: "Tişört", quantity: 2 },
    ],
  };

  const normalized = normalizeTriggerPayload("shopify.order_created", shopifyRaw);
  assert.equal(normalized.order_id, 987654321);
  assert.equal(normalized.order_number, 1042);
  assert.equal(normalized.customer_name, "Ayşe Yılmaz");
  assert.equal(normalized.shipping_city, "İzmir");
  assert.equal(normalized.item_count, 3);
  assert.equal(normalized.items_summary, "Deri Ceket (1x), Tişört (2x)");
});

test("App Connections Repo CRUD ve Maskeleme", async () => {
  const { appConnectionsRepo, publicAppConnection } = await import("../src/core/repos/app-connections.js");

  const conn = appConnectionsRepo.create(testOrg.id, {
    appId: "slack",
    name: "Şirket Slack Kanalı",
    credentials: {
      webhookUrl: "https://hooks.slack.com/services/T00/B00/SECRET123456",
    },
  });

  assert.ok(conn.id);
  assert.equal(conn.name, "Şirket Slack Kanalı");
  assert.equal(conn.credentials.webhookUrl, "https://hooks.slack.com/services/T00/B00/SECRET123456");

  // Maskeleme
  const pub = publicAppConnection(conn);
  assert.equal(pub.credentialsMasked.webhookUrl, "***3456");

  // Listeleme
  const list = appConnectionsRepo.list(testOrg.id, "slack");
  assert.equal(list.length, 1);

  // Silme
  const ok = appConnectionsRepo.delete(conn.id, testOrg.id);
  assert.equal(ok, true);
  assert.equal(appConnectionsRepo.getById(conn.id, testOrg.id), null);
});

