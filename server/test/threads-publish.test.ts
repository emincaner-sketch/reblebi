import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-threads-"));
process.env.DATA_DIR = dir;

const { threadsProvider } = await import("../src/providers/meta/threads.js");
const { waitForContainer } = await import("../src/providers/meta/common.js");

const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const statusQueries: Array<{ host: string; fields: string | null }> = [];
let containerStatus: Record<string, string> = { status: "FINISHED" };

// Gerçek Threads API'si gibi davranır: konteynerde olmayan status_code alanı istenirse kod 100 döner
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(input));
  const method = init?.method ?? "GET";
  if (u.hostname === "graph.threads.net") {
    if (method === "POST" && u.pathname.endsWith("/threads")) return j({ id: "cont-1" });
    if (method === "POST" && u.pathname.endsWith("/threads_publish")) return j({ id: "th-post-9" });
    if (u.pathname.endsWith("/cont-1")) {
      const fields = u.searchParams.get("fields");
      statusQueries.push({ host: u.hostname, fields });
      if (fields?.split(",").includes("status_code")) {
        return j({ error: { message: "Tried accessing nonexisting field (status_code)", type: "THApiException", code: 100 } }, 400);
      }
      return j({ id: "cont-1", ...containerStatus });
    }
    if (u.pathname.endsWith("/th-post-9")) return j({ permalink: "https://www.threads.net/@ydsmatik/post/abc" });
  }
  if (u.hostname === "graph.facebook.com" && u.pathname.endsWith("/ig-cont")) {
    statusQueries.push({ host: u.hostname, fields: u.searchParams.get("fields") });
    return j({ status_code: "FINISHED", status: "Finished: Media has been uploaded and it is complete." });
  }
  return j({ error: { message: `beklenmeyen istek ${method} ${u}` } }, 500);
}) as typeof fetch;

const channel = { externalId: "th-1", accessToken: "thtok", metadata: {} } as never;

test("Threads: konteyner durumu status alanıyla sorgulanır, gönderi yayınlanır", async () => {
  statusQueries.length = 0;
  containerStatus = { status: "FINISHED" };
  const r = await threadsProvider.publish(channel, { kind: "post", text: "merhaba", media: [], settings: {} } as never);
  assert.equal(r.externalId, "th-post-9");
  assert.equal(r.url, "https://www.threads.net/@ydsmatik/post/abc");
  assert.deepEqual(statusQueries, [{ host: "graph.threads.net", fields: "status,error_message" }]);
});

test("Threads: ERROR durumunda error_message kullanıcıya gösterilir", async () => {
  containerStatus = { status: "ERROR", error_message: "Görsel indirilemedi" };
  await assert.rejects(
    threadsProvider.publish(channel, { kind: "post", text: "merhaba", media: [], settings: {} } as never),
    /Medya işleme başarısız: Görsel indirilemedi/,
  );
});

test("Instagram: konteyner durumu hâlâ status_code alanıyla sorgulanır", async () => {
  statusQueries.length = 0;
  await waitForContainer("https://graph.facebook.com/v21.0/ig-cont", "igtok");
  assert.deepEqual(statusQueries, [{ host: "graph.facebook.com", fields: "status_code,status" }]);
});
