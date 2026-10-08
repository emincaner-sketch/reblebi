import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-tiktok-"));
process.env.DATA_DIR = dir;
process.env.TIKTOK_CLIENT_KEY = "ck";
process.env.TIKTOK_CLIENT_SECRET = "cs";

const { tiktokProvider, resolvePrivacy } = await import("../src/providers/tiktok.js");

const videoPath = path.join(dir, "v.mp4");
fs.writeFileSync(videoPath, Buffer.alloc(2048, 1));

const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let creatorOptions: string[] | null = ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"];
let auditStrict = false;
const inits: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  if (u.hostname === "upload.tiktok.test") return new Response("", { status: 201 });
  if (u.pathname.endsWith("/creator_info/query/")) return creatorOptions ? j({ data: { privacy_level_options: creatorOptions }, error: { code: "ok" } }) : j({ error: { code: "access_token_invalid" } }, 401);
  if (u.pathname.endsWith("/video/init/")) {
    const body = JSON.parse(String(init?.body));
    const pl = body.post_info.privacy_level as string;
    inits.push(pl);
    if (auditStrict && pl !== "SELF_ONLY") return j({ data: {}, error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } }, 403);
    return j({ data: { publish_id: "p1", upload_url: "https://upload.tiktok.test/u" }, error: { code: "ok" } });
  }
  if (u.pathname.endsWith("/status/fetch/")) return j({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["777"] }, error: { code: "ok" } });
  throw new Error("beklenmeyen: " + u);
}) as typeof fetch;

const channel = { id: "c", orgId: "o", provider: "tiktok", externalId: "oid", username: "leblebi", accessToken: "t", metadata: {} } as never;
const input = (privacyLevel?: string) => ({ kind: "video", text: "merhaba", media: [{ kind: "video", localPath: videoPath, publicUrl: "https://x/v.mp4", mime: "video/mp4" }], settings: privacyLevel ? { privacyLevel } : {} }) as never;

test("resolvePrivacy: hesapta kapalı seçenek en kısıtlıya düşer", () => {
  assert.equal(resolvePrivacy("PUBLIC_TO_EVERYONE", ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"]), "SELF_ONLY");
  assert.equal(resolvePrivacy("MUTUAL_FOLLOW_FRIENDS", ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"]), "MUTUAL_FOLLOW_FRIENDS");
  assert.equal(resolvePrivacy("PUBLIC_TO_EVERYONE", undefined), "PUBLIC_TO_EVERYONE");
  assert.equal(resolvePrivacy("PUBLIC_TO_EVERYONE", ["FOLLOWER_OF_CREATOR"]), "FOLLOWER_OF_CREATOR");
});

test("yayın önce creator_info'ya bakar ve izin verilmeyen gizliliği düşürür", async () => {
  inits.length = 0;
  const r = await tiktokProvider.publish(channel, input());
  assert.deepEqual(inits, ["SELF_ONLY"]);
  assert.equal(r.externalId, "777");
  assert.match(r.url ?? "", /@leblebi\/video\/777/);
});

test("creator_info alınamazsa istenen gizlilikle devam eder", async () => {
  creatorOptions = null;
  inits.length = 0;
  await tiktokProvider.publish(channel, input("PUBLIC_TO_EVERYONE"));
  assert.deepEqual(inits, ["PUBLIC_TO_EVERYONE"]);
});

test("denetimden geçmemiş uygulama: herkese açık reddedilir, 'Sadece ben' ile yeniden denenir", async () => {
  creatorOptions = ["PUBLIC_TO_EVERYONE", "SELF_ONLY"];
  auditStrict = true;
  inits.length = 0;
  const r = await tiktokProvider.publish(channel, input("PUBLIC_TO_EVERYONE"));
  assert.deepEqual(inits, ["PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
  assert.equal(r.externalId, "777");
});

test.after(() => {
  globalThis.fetch = realFetch;
});
