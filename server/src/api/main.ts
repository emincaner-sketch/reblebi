import { assertProductionSafety, config, ensureDirs, isDev } from "../core/config.js";
import { getDb } from "../core/db.js";
import { createLogger } from "../core/logger.js";
import { buildServer } from "./server.js";
import { startScheduler, stopScheduler } from "../services/scheduler.js";

const log = createLogger("main");

async function main(): Promise<void> {
  ensureDirs();
  getDb();
  const warnings = assertProductionSafety();
  for (const w of warnings) log.warn(w);
  if (!isDev() && warnings.some((w) => w.startsWith("APP_SECRET"))) {
    log.error("Üretimde güvensiz APP_SECRET ile başlatılamaz. .env içinde en az 32 karakterlik rastgele bir değer ver.");
    process.exit(1);
  }
  const app = await buildServer();
  await app.listen({ port: config.port, host: process.env.HOST || "0.0.0.0" });
  log.info(`${config.appName} hazır`, { port: config.port, publicUrl: config.publicUrl, appUrl: config.appUrl, mcp: `${config.publicUrl}/mcp` });
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();

  const shutdown = async (signal: string) => {
    log.info("kapanıyor", { signal });
    stopScheduler();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (e) => log.error("yakalanmamış hata", { e: e instanceof Error ? e.stack : e }));
}

main().catch((e) => {
  log.error("başlatma hatası", { e: e instanceof Error ? e.stack : e });
  process.exit(1);
});
