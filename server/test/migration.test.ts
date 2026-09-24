import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Tek kullanıcılı (v1) kurulumdan çok kiracılı (v2) yapıya geçiş:
 * eski kullanıcı, kanal, gönderi ve ayarlar "org_default" çalışma alanına taşınmalı.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mig-"));
process.env.DATA_DIR = dir;

const { MIGRATIONS } = await import("../src/core/db.js");

// v1 veritabanını elle kur ve eski veriyle doldur
const legacy = new DatabaseSync(path.join(dir, "sosyalpilot.db"));
legacy.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
legacy.exec(MIGRATIONS[0].sql!);
legacy.prepare("INSERT INTO _migrations (id, applied_at) VALUES (1, ?)").run(new Date().toISOString());
const now = new Date().toISOString();
legacy.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('usr_old', 'eski@ornek.com', 'x:y', ?)").run(now);
legacy
  .prepare(
    "INSERT INTO channels (id, provider, external_id, name, access_token, metadata, status, created_at, updated_at) VALUES ('ch_old', 'telegram', '42', 'Eski Kanal', 'enc', '{}', 'active', ?, ?)",
  )
  .run(now, now);
legacy.prepare("INSERT INTO posts (id, kind, status, content, media_ids, created_at, updated_at) VALUES ('post_old', 'post', 'draft', 'merhaba', '[]', ?, ?)").run(now, now);
legacy.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify({ brandName: "Eski Marka" }));
legacy.close();

const { getDb } = await import("../src/core/db.js");
const { orgsRepo, membershipsRepo, orgSettingsRepo, usersRepo } = await import("../src/core/repos/orgs.js");
const { channelsRepo } = await import("../src/core/repos/channels.js");
const { postsRepo } = await import("../src/core/repos/posts.js");

test("migration 2 uygulanır ve eski veri varsayılan çalışma alanına taşınır", () => {
  const db = getDb();
  const ids = (db.prepare("SELECT id FROM _migrations ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
  assert.deepEqual(ids, [1, 2]);

  const org = orgsRepo.get("org_default");
  assert.ok(org, "org_default oluşmalı");
  assert.equal(org!.plan, "unlimited");

  assert.equal(membershipsRepo.get("org_default", "usr_old")?.role, "owner");
  assert.equal(usersRepo.get("usr_old")?.isSuperadmin, 1);

  const ch = channelsRepo.getById("ch_old");
  assert.equal(ch?.orgId, "org_default");
  assert.deepEqual(ch?.timeSlots, []);

  assert.equal(postsRepo.get("org_default", "post_old")?.content, "merhaba");
  assert.equal(orgSettingsRepo.get("org_default").brandName, "Eski Marka");
});

test("aynı platform hesabı farklı çalışma alanlarına bağlanabilir", () => {
  const db = getDb();
  const now2 = new Date().toISOString();
  db.prepare("INSERT INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES ('org_b', 'B', 'b', 'free', ?, ?)").run(now2, now2);
  const r = channelsRepo.upsert({ orgId: "org_b", provider: "telegram", externalId: "42", name: "Aynı hesap", accessToken: "t" });
  assert.equal(r.created, true);
  assert.equal(channelsRepo.findAllByExternal("telegram", "42").length, 2);
});

test("mesaj benzersizliği artık konuşma bazında", () => {
  const db = getDb();
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO conversations (id, org_id, channel_id, external_id, participant_id, last_message_at, created_at) VALUES ('c2', 'org_b', 'ch_x', 'u1', 'u1', ?, ?)",
  ).run(ts, ts);
  // Aynı dış mesaj kimliği farklı konuşmalarda olabilir (aynı DM iki çalışma alanına düşer)
  db.prepare("INSERT INTO messages (id, conversation_id, direction, external_id, text, sent_by, created_at) VALUES ('m2', 'c2', 'in', 'ext1', 'x', 'customer', ?)").run(ts);
  // ...ama aynı konuşmada iki kez olamaz
  assert.throws(
    () => db.prepare("INSERT INTO messages (id, conversation_id, direction, external_id, text, sent_by, created_at) VALUES ('m3', 'c2', 'in', 'ext1', 'x', 'customer', ?)").run(ts),
    /UNIQUE/,
  );
});
