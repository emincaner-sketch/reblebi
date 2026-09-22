type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmt(level: Level, scope: string, msg: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const extra = data === undefined ? "" : " " + safeJson(data);
  return ts + " [" + level.toUpperCase() + "] [" + scope + "] " + msg + extra;
}

export function createLogger(scope: string) {
  const log = (level: Level, msg: string, data?: unknown) => {
    if (order[level] < order[minLevel]) return;
    const line = fmt(level, scope, msg, data);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m: string, d?: unknown) => log("debug", m, d),
    info: (m: string, d?: unknown) => log("info", m, d),
    warn: (m: string, d?: unknown) => log("warn", m, d),
    error: (m: string, d?: unknown) => log("error", m, d),
  };
}

export type Logger = ReturnType<typeof createLogger>;
