import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Birim testleri de config yüklediği için izole veri klasörü
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-unit-"));
process.env.DATA_DIR = dir;

const { zonedToUtc, localDate, parseFlexibleDate, hhmmToMinutes, tzOffsetMinutes } = await import("../src/services/time.js");
const { splitThread } = await import("../src/providers/meta/threads.js");
const { ruleMatches } = await import("../src/services/dm-engine.js");
const { t, pickLocale, AppError } = await import("../src/core/i18n.js");
const { effectivePlan, getPlan } = await import("../src/core/plans.js");
const { encrypt, decrypt, sign, unsign, pkcePair } = await import("../src/core/crypto.js");

test("İstanbul saat dilimi: yerel 10:00 = UTC 07:00", () => {
  const d = zonedToUtc(2026, 10, 1, 600, "Europe/Istanbul");
  assert.equal(d.toISOString(), "2026-10-01T07:00:00.000Z");
  assert.equal(tzOffsetMinutes(d, "Europe/Istanbul"), 180);
});

test("Yaz saati geçişi olan bölgede (New York) doğru ofset", () => {
  // 1 Kasım 2026 EDT biter; 2 Kasım 09:00 EST = 14:00 UTC
  assert.equal(zonedToUtc(2026, 11, 2, 540, "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");
  assert.equal(zonedToUtc(2026, 7, 2, 540, "America/New_York").toISOString(), "2026-07-02T13:00:00.000Z");
});

test("localDate gün ve dakika döndürür", () => {
  const l = localDate(new Date("2026-10-01T21:30:00Z"), "Europe/Istanbul");
  assert.deepEqual({ y: l.year, m: l.month, d: l.day, min: l.minuteOfDay }, { y: 2026, m: 10, d: 2, min: 30 });
});

test("parseFlexibleDate: yerel format, ISO ve 'now'", () => {
  assert.equal(parseFlexibleDate("2026-10-01 10:30", "Europe/Istanbul")?.toISOString(), "2026-10-01T07:30:00.000Z");
  assert.equal(parseFlexibleDate("2026-10-01T10:30:00Z", "Europe/Istanbul")?.toISOString(), "2026-10-01T10:30:00.000Z");
  assert.ok(Math.abs((parseFlexibleDate("now", "UTC")?.getTime() ?? 0) - Date.now()) < 2000);
  assert.equal(parseFlexibleDate("yarın", "UTC"), null);
});

test("hhmmToMinutes doğrular", () => {
  assert.equal(hhmmToMinutes("09:15"), 555);
  assert.equal(hhmmToMinutes("24:00"), null);
  assert.equal(hhmmToMinutes("abc"), null);
});

test("splitThread: --- ile ve uzunlukla bölme", () => {
  assert.deepEqual(splitThread("a\n---\nb\n---\nc", 280), ["a", "b", "c"]);
  const long = "Bu bir cümle. ".repeat(40).trim();
  const parts = splitThread(long, 100);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 100));
});

test("ruleMatches: anahtar kelime Türkçe büyük/küçük harf duyarsız", () => {
  assert.equal(ruleMatches({ matchType: "keyword", pattern: "fiyat, ücret" }, "ÜCRET ne kadar?", false), true);
  assert.equal(ruleMatches({ matchType: "keyword", pattern: "kargo" }, "merhaba", false), false);
  assert.equal(ruleMatches({ matchType: "first_contact", pattern: null }, "x", true), true);
  assert.equal(ruleMatches({ matchType: "regex", pattern: "(\\d{5,})" }, "sipariş 123456", false), true);
  assert.equal(ruleMatches({ matchType: "regex", pattern: "([" }, "x", false), false);
});

test("i18n: çeviri, değişken ve dil seçimi", () => {
  assert.equal(t("en", "limit.channels", { limit: 3 }), "You've reached your plan's channel limit (3). Upgrade for more channels.");
  assert.match(t("tr", "limit.channels", { limit: 3 }), /kanal sınırına/);
  assert.equal(pickLocale("en-US,en;q=0.9"), "en");
  assert.equal(pickLocale("tr-TR"), "tr");
  const e = new AppError(404, "err.not_found", { what: "what.post" });
  assert.equal(e.localized("en"), "Post not found");
  assert.equal(e.localized("tr"), "Gönderi bulunamadı");
});

test("Plan süresi dolunca ücretsize düşer", () => {
  assert.equal(effectivePlan({ plan: "pro", planExpiresAt: new Date(Date.now() - 1000).toISOString() }).id, "free");
  assert.equal(effectivePlan({ plan: "pro", planExpiresAt: new Date(Date.now() + 86400_000).toISOString() }).id, "pro");
  assert.equal(getPlan("yok").id, "free");
});

test("Şifreleme, imza ve PKCE", () => {
  assert.equal(decrypt(encrypt("gizli-token")), "gizli-token");
  const s = sign("oturum");
  assert.equal(unsign(s), "oturum");
  assert.equal(unsign(s.slice(0, -1) + (s.endsWith("a") ? "b" : "a")), null);
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43 && challenge.length === 43);
});
