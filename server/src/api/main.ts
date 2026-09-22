import { config, ensureDirs } from "../core/config.js";
import { getDb } from "../core/db.js";
import { createLogger } from "../core/logger.js";
import { buildServer } from "./server.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";

const log = createLogger("main");

async function main(): Promise<void> {
  ensureDirs();
  getDb();
  const app = await buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info("SosyalPilot API hazir", { port: config.port, publicUrl: config.publicUrl, data: config.dataDir });
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();

  const shutdown = async () => {
    stopScheduler();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  log.error("baslatma hatasi", { e: e instanceof Error ? e.stack : e });
  process.exit(1);
});
