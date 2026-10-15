import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-metasig-"));
process.env.DISABLE_SCHEDULER = "1";
process.env.META_APP_SECRET = "meta-secret-test";
process.env.INSTAGRAM_APP_SECRET = "ig-secret-test";

const { verifyMetaSignature } = await import("../src/providers/index.js");
const { webhookEventsRepo } = await import("../src/core/repos/misc.js");

const sign = (body: string, key: string) => "sha256=" + crypto.createHmac("sha256", key).update(body, "utf8").digest("hex");

test("imza: tanımlı anahtarlardan biri tutarsa geçerli", () => {
  const body = '{"object":"instagram","entry":[]}';
  const keys = ["meta-k", "ig-k"];
  assert.equal(verifyMetaSignature(body, sign(body, "meta-k"), keys), true);
  assert.equal(verifyMetaSignature(body, sign(body, "ig-k"), keys), true);
  assert.equal(verifyMetaSignature(body, sign(body, "baska"), keys), false);
  assert.equal(verifyMetaSignature(body + " ", sign(body, "ig-k"), keys), false, "gövde değişirse imza tutmaz");
});

test("imza: başlık eksik ya da biçimi bozuksa reddedilir", () => {
  const body = "{}";
  const keys = ["k"];
  assert.equal(verifyMetaSignature(body, undefined, keys), false);
  assert.equal(verifyMetaSignature(body, "", keys), false);
  assert.equal(verifyMetaSignature(body, sign(body, "k").slice(7), keys), false, "sha256= öneki şart");
  assert.equal(verifyMetaSignature(body, "sha256=abc", keys), false);
  assert.equal(verifyMetaSignature(body, "sha1=" + sign(body, "k").slice(7), keys), false);
});

test("imza: büyük harfli hex kabul edilir, Türkçe karakterli gövde UTF-8 olarak imzalanır", () => {
  const body = '{"text":"Öğretmenle görüşmek istiyorum, ışık"}';
  const keys = ["k"];
  assert.equal(verifyMetaSignature(body, "sha256=" + sign(body, "k").slice(7).toUpperCase(), keys), true);
  assert.equal(verifyMetaSignature(body, sign(body, "k"), keys), true);
});

test("imza: hiç anahtar yoksa (yerel geliştirme) atlanır, boş anahtarlar yok sayılır", () => {
  assert.equal(verifyMetaSignature("{}", undefined, []), true);
  assert.equal(verifyMetaSignature("{}", undefined, ["", undefined]), true);
  assert.equal(verifyMetaSignature("{}", undefined, ["", "ig-k"]), false);
});

let app: FastifyInstance;
before(async () => {
  const { buildServer } = await import("../src/api/server.js");
  app = await buildServer();
  await app.ready();
});
after(async () => {
  await app?.close();
});

const post = (payload: string, signature?: string) =>
  app.inject({
    method: "POST",
    url: "/webhooks/meta",
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
    payload,
  });

test("webhook adresi: Meta ve Instagram anahtarıyla imzalı olaylar kabul edilir, diğerleri 401", async () => {
  const before = webhookEventsRepo.recent(100).length;
  const fb = JSON.stringify({ object: "page", entry: [] });
  const ig = JSON.stringify({ object: "instagram", entry: [{ id: "ig-yok", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "İndir linki?" } }] }] });

  assert.equal((await post(fb, sign(fb, "meta-secret-test"))).statusCode, 200);
  assert.equal((await post(ig, sign(ig, "ig-secret-test"))).statusCode, 200);
  assert.equal((await post(ig, sign(ig, "yanlis"))).statusCode, 401);
  assert.equal((await post(ig)).statusCode, 401);
  assert.equal(webhookEventsRepo.recent(100).length - before, 2, "yalnızca imzası doğru iki olay kaydedilmeli");
});
