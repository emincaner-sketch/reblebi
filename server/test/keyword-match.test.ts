import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// dm-engine config yüklediği için izole veri klasörü
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sp-kw-"));

const { foldText, tokenize, matchesKeywords, parseKeywordList } = await import("../src/services/keyword-match.js");
const { ruleMatches, containsHandoffKeyword } = await import("../src/services/dm-engine.js");

const kw = (pattern: string, text: string) => ruleMatches({ matchType: "keyword", pattern }, text, false);

test("foldText: Türkçe büyük/küçük harf ve işaretler", () => {
  assert.equal(foldText("İNDİR"), "indir");
  assert.equal(foldText("INDIR"), "indir"); // I → ı → i
  assert.equal(foldText("ışık"), "isik");
  assert.equal(foldText("ŞİKAYET Ücret ÖĞRETMEN Çık"), "sikayet ucret ogretmen cik");
  assert.equal(foldText("i̇"), "i"); // birleşik nokta (İ'nin başka dillerde küçültülmüş hali)
});

test("tokenize: noktalama ve kesme işareti kelime sınırıdır", () => {
  assert.deepEqual(tokenize("YDS'ye nasıl çalışmalıyım?!"), ["yds", "ye", "nasil", "calismaliyim"]);
  assert.deepEqual(tokenize("  play-store,android 2026 "), ["play", "store", "android", "2026"]);
  assert.deepEqual(tokenize("🙂 👍"), []);
});

test("tam kelime: başka kelimenin içindeki parça eşleşmez", () => {
  assert.equal(kw("dur", "durum nedir"), false);
  assert.equal(kw("site", "üniversite sınavı"), false);
  assert.equal(kw("sorun", "sorunun cevabı"), false);
  assert.equal(kw("app", "happy"), false);
  assert.equal(kw("stop", "nonstop çalışıyorum"), false);
  assert.equal(kw("dur", "lütfen dur"), true);
  assert.equal(kw("stop", "STOP"), true);
});

test("Türkçe harfler: İ/i, I/ı ve Türkçe karaktersiz yazım", () => {
  assert.equal(kw("indir", "İNDİR"), true);
  assert.equal(kw("indir", "INDIR"), true);
  assert.equal(kw("İndir", "nasıl indir"), true);
  assert.equal(kw("ücret", "ucret ne kadar"), true);
  assert.equal(kw("şikayet", "SIKAYET etmek istiyorum"), true);
  assert.equal(kw("öğretmen", "Öğretmenle görüşebilir miyim"), false); // ek almış, * yok
  assert.equal(kw("öğretmen*", "Öğretmenle görüşebilir miyim"), true);
  assert.equal(kw("ılık", "ILIK"), true);
});

test("* ile ek alma: kelimenin başı eşleşir, ortası eşleşmez", () => {
  assert.equal(kw("fiyat*", "fiyatı nedir"), true);
  assert.equal(kw("fiyat*", "Fiyatlar?"), true);
  assert.equal(kw("fiyat*", "fiyat"), true);
  assert.equal(kw("fiyat*", "zamfiyat"), false);
  assert.equal(kw("fiyat", "fiyatı nedir"), false);
});

test("kelime grupları yan yana aranır", () => {
  assert.equal(kw("play store", "Play Store linki var mı"), true);
  assert.equal(kw("play store", "play the store"), false);
  assert.equal(kw("nereden başla*", "nereden başlamalıyım"), true);
  assert.equal(kw("abonelikten çık*", "Abonelikten çıkmak istiyorum"), true);
  assert.equal(kw("mesaj istemiyorum", "artık mesaj istemiyorum"), true);
  assert.equal(kw("mesaj istemiyorum", "mesajı istemiyorum"), false);
});

test("liste: virgülle ayrılır, boşluklar ve boş girdiler atlanır", () => {
  assert.equal(parseKeywordList(" stop , , durdur ,").length, 2);
  assert.equal(parseKeywordList("").length, 0);
  assert.equal(parseKeywordList(null).length, 0);
  assert.equal(parseKeywordList("*, !!").length, 0);
  assert.equal(matchesKeywords("", "her şey"), false);
  assert.equal(matchesKeywords(" , ", "her şey"), false);
  assert.equal(kw("hoca, öğretmen, yetkili", "bir YETKİLİ ile konuşmak istiyorum"), true);
});

test("insana devretme kelimeleri de tam kelime eşleşir", () => {
  const s = { handoffKeywords: "insan, yetkili, şikayet, iade" };
  assert.equal(containsHandoffKeyword("İnsan ile görüşmek istiyorum", s), true);
  assert.equal(containsHandoffKeyword("insanlar ne diyor", s), false);
  assert.equal(containsHandoffKeyword("İADE", s), true);
  assert.equal(containsHandoffKeyword("iadeli", s), false);
  assert.equal(containsHandoffKeyword("merhaba", { handoffKeywords: "" }), false);
});

test("devir teslimdeki YDS Matik kurallarının riskli örnekleri", () => {
  const stop = "stop, durdur, abonelikten çık, mesaj istemiyorum, otomatik mesaj gönderme";
  assert.equal(kw(stop, "durumum ne"), false);
  assert.equal(kw(stop, "DURDUR"), true);
  const link = "indir, link, uygulama, play store, android";
  assert.equal(kw(link, "üniversite sitesi"), false);
  assert.equal(kw(link, "Android'de var mı"), true);
});
