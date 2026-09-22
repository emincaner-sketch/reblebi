#!/usr/bin/env node
/**
 * SosyalPilot MCP sunucusu (stdio).
 * Claude Code / Claude Desktop / Cursor gibi ajanlar bu araçlarla paneli yönetir.
 *
 * Ortam değişkenleri:
 *   SOSYALPILOT_API_URL  (varsayılan http://localhost:4100)
 *   SOSYALPILOT_API_KEY  (Panel > Ayarlar > API anahtarları)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.SOSYALPILOT_API_URL || "http://localhost:4100").replace(/\/$/, "");
const API_KEY = process.env.SOSYALPILOT_API_KEY || "";

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* metin */
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error ?? text;
    throw new Error(`API ${res.status}: ${err}`);
  }
  return data as T;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
}

const server = new McpServer({ name: "sosyalpilot", version: "1.0.0" });

const PROVIDERS = ["instagram", "facebook", "threads", "whatsapp", "x", "linkedin", "tiktok", "youtube", "telegram"] as const;
const KINDS = ["post", "story", "reel", "video", "thread"] as const;

/* ---------------- Kanallar ---------------- */

server.registerTool(
  "list_channels",
  { title: "Kanalları listele", description: "Bağlı sosyal medya kanallarını (id, platform, ad, durum) döndürür. Gönderi oluşturmadan önce kanal id'lerini buradan al." },
  async () => {
    try {
      return ok(await api("GET", "/api/channels"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_providers",
  { title: "Platform yetenekleri", description: "Her platformun desteklediği gönderi türleri, karakter sınırı, DM desteği ve platforma özel ayar alanları." },
  async () => {
    try {
      return ok(await api("GET", "/api/providers"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "check_channel",
  { title: "Kanal sağlık kontrolü", description: "Kanal token'ının geçerli olup olmadığını platform API'sine sorarak doğrular.", inputSchema: { channelId: z.string() } },
  async ({ channelId }) => {
    try {
      return ok(await api("POST", `/api/channels/${channelId}/check`));
    } catch (e) {
      return fail(e);
    }
  },
);

/* ---------------- Gönderiler ---------------- */

server.registerTool(
  "create_post",
  {
    title: "Gönderi / hikaye oluştur",
    description:
      "Bir ya da birden çok kanala gönderi, hikaye, reel, video ya da zincir oluşturur. publishAt: 'now' hemen yayınlar, ISO tarih planlar, boş bırakılırsa taslak kalır. mediaUrls verilirse dosyalar önce içe aktarılır. Instagram/TikTok/YouTube için medya zorunlu. Kanal-özel metin için perChannel kullan.",
    inputSchema: {
      kind: z.enum(KINDS).default("post"),
      content: z.string().describe("Ana metin (zincirlerde parçaları --- ile ayır)"),
      channelIds: z.array(z.string()).min(1),
      publishAt: z.string().optional().describe("'now' | ISO 8601 tarih | boş = taslak"),
      title: z.string().optional(),
      mediaUrls: z.array(z.url()).optional().describe("Herkese açık görsel/video URL'leri; içe aktarılır"),
      mediaIds: z.array(z.string()).optional().describe("Daha önce yüklenmiş medya id'leri"),
      settings: z.record(z.string(), z.unknown()).optional().describe("Tüm hedeflere uygulanacak platform ayarları (ör. {privacyLevel:'SELF_ONLY', title:'...'})"),
      perChannel: z.array(z.object({ channelId: z.string(), content: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() })).optional(),
    },
  },
  async (args) => {
    try {
      const mediaIds = [...(args.mediaIds ?? [])];
      for (const url of args.mediaUrls ?? []) {
        const m = await api<{ id: string }>("POST", "/api/media/import", { url });
        mediaIds.push(m.id);
      }
      const targets = args.channelIds.map((channelId) => {
        const override = args.perChannel?.find((p) => p.channelId === channelId);
        return { channelId, content: override?.content ?? null, settings: { ...(args.settings ?? {}), ...(override?.settings ?? {}) } };
      });
      const post = await api("POST", "/api/posts", {
        kind: args.kind,
        content: args.content,
        title: args.title ?? null,
        mediaIds,
        publishAt: args.publishAt ?? null,
        targets,
      });
      return ok(post);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_posts",
  {
    title: "Gönderileri listele",
    description: "Gönderileri durum ve tarih aralığına göre listeler. status: draft,scheduled,publishing,published,partial,failed (virgülle birden çok).",
    inputSchema: { status: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().optional() },
  },
  async (args) => {
    try {
      const q = new URLSearchParams();
      if (args.status) q.set("status", args.status);
      if (args.from) q.set("from", args.from);
      if (args.to) q.set("to", args.to);
      if (args.limit) q.set("limit", String(args.limit));
      return ok(await api("GET", `/api/posts?${q.toString()}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool("get_post", { title: "Gönderi detayı", description: "Bir gönderinin hedef kanal sonuçlarıyla birlikte detayını döndürür.", inputSchema: { postId: z.string() } }, async ({ postId }) => {
  try {
    return ok(await api("GET", `/api/posts/${postId}`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool(
  "update_post",
  {
    title: "Gönderiyi güncelle",
    description: "Taslak ya da planlı gönderinin metnini, tarihini veya türünü değiştirir.",
    inputSchema: { postId: z.string(), content: z.string().optional(), publishAt: z.string().nullable().optional(), kind: z.enum(KINDS).optional(), title: z.string().nullable().optional() },
  },
  async ({ postId, ...rest }) => {
    try {
      return ok(await api("PUT", `/api/posts/${postId}`, rest));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool("publish_post_now", { title: "Hemen yayınla", description: "Taslak/planlı/başarısız gönderiyi hemen yayınlar (başarısız hedefleri tekrar dener).", inputSchema: { postId: z.string() } }, async ({ postId }) => {
  try {
    return ok(await api("POST", `/api/posts/${postId}/publish`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("cancel_post", { title: "Planı iptal et", description: "Planlanmış gönderiyi taslağa çevirir.", inputSchema: { postId: z.string() } }, async ({ postId }) => {
  try {
    return ok(await api("POST", `/api/posts/${postId}/cancel`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("delete_post", { title: "Gönderiyi sil", description: "Gönderiyi paneldeki kayıtlardan siler (platformdaki yayını geri almaz).", inputSchema: { postId: z.string() } }, async ({ postId }) => {
  try {
    return ok(await api("DELETE", `/api/posts/${postId}`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("import_media", { title: "Medya içe aktar", description: "Herkese açık bir URL'deki görsel/videoyu medya kütüphanesine alır ve id döndürür.", inputSchema: { url: z.url(), name: z.string().optional() } }, async (args) => {
  try {
    return ok(await api("POST", "/api/media/import", args));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("list_media", { title: "Medya kütüphanesi", description: "Yüklenmiş medya dosyalarını listeler." }, async () => {
  try {
    return ok(await api("GET", "/api/media"));
  } catch (e) {
    return fail(e);
  }
});

/* ---------------- Gelen kutusu ---------------- */

server.registerTool(
  "list_conversations",
  {
    title: "DM konuşmalarını listele",
    description: "Gelen kutusundaki konuşmalar (platform, kişi, son mesaj, okunmamış sayısı, mod). attention=true sadece insan dikkat isteyenleri getirir.",
    inputSchema: { channelId: z.string().optional(), attention: z.boolean().optional(), status: z.enum(["open", "closed"]).optional(), limit: z.number().optional() },
  },
  async (args) => {
    try {
      const q = new URLSearchParams();
      if (args.channelId) q.set("channelId", args.channelId);
      if (args.attention) q.set("attention", "true");
      if (args.status) q.set("status", args.status);
      if (args.limit) q.set("limit", String(args.limit));
      return ok(await api("GET", `/api/inbox/conversations?${q.toString()}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool("get_conversation", { title: "Konuşma detayı", description: "Bir konuşmanın tüm mesajlarını döndürür.", inputSchema: { conversationId: z.string() } }, async ({ conversationId }) => {
  try {
    return ok(await api("GET", `/api/inbox/conversations/${conversationId}`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool(
  "reply_conversation",
  { title: "DM yanıtla", description: "Konuşmaya platform üzerinden mesaj gönderir.", inputSchema: { conversationId: z.string(), text: z.string().min(1) } },
  async ({ conversationId, text }) => {
    try {
      return ok(await api("POST", `/api/inbox/conversations/${conversationId}/reply`, { text }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "draft_reply",
  { title: "AI yanıt taslağı", description: "Marka sesiyle bir yanıt taslağı üretir (göndermez). intent ve handoff önerisi de döner.", inputSchema: { conversationId: z.string(), instructions: z.string().optional() } },
  async ({ conversationId, instructions }) => {
    try {
      return ok(await api("POST", `/api/inbox/conversations/${conversationId}/ai-draft`, { instructions }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "set_conversation",
  {
    title: "Konuşma modu / durumu",
    description: "mode: auto (kurallar+AI yanıtlar) | manual (insan devraldı). status: open | closed. read: okundu işaretle.",
    inputSchema: { conversationId: z.string(), mode: z.enum(["auto", "manual"]).optional(), status: z.enum(["open", "closed"]).optional(), read: z.boolean().optional() },
  },
  async ({ conversationId, ...rest }) => {
    try {
      return ok(await api("PATCH", `/api/inbox/conversations/${conversationId}`, rest));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool("inbox_summary", { title: "Gelen kutusu özeti", description: "Açık konuşmaları AI ile özetler: acil, satış fırsatı, şikayet." }, async () => {
  try {
    return ok(await api("POST", "/api/inbox/summary"));
  } catch (e) {
    return fail(e);
  }
});

/* ---------------- Oto-yanıt kuralları ---------------- */

const RuleShape = {
  name: z.string(),
  enabled: z.number().optional(),
  channelId: z.string().nullable().optional(),
  provider: z.enum(PROVIDERS).nullable().optional(),
  matchType: z.enum(["any", "first_contact", "keyword", "regex"]).optional(),
  pattern: z.string().nullable().optional().describe("keyword: virgülle kelimeler; regex: desen"),
  replyMode: z.enum(["template", "ai"]).optional(),
  replyText: z.string().nullable().optional().describe("Şablon; {{name}} değişkeni kullanılabilir"),
  aiInstructions: z.string().nullable().optional(),
  priority: z.number().optional().describe("Küçük sayı önce çalışır"),
  cooldownMinutes: z.number().optional(),
  onlyBusinessHours: z.number().optional(),
  handoffToHuman: z.number().optional(),
};

server.registerTool("list_rules", { title: "Oto-yanıt kuralları", description: "Tanımlı DM oto-yanıt kurallarını listeler." }, async () => {
  try {
    return ok(await api("GET", "/api/rules"));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("create_rule", { title: "Kural oluştur", description: "Yeni DM oto-yanıt kuralı ekler.", inputSchema: RuleShape }, async (args) => {
  try {
    return ok(await api("POST", "/api/rules", args));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("update_rule", { title: "Kuralı güncelle", description: "Var olan kuralı günceller.", inputSchema: { ruleId: z.string(), ...Object.fromEntries(Object.entries(RuleShape).map(([k, v]) => [k, v.optional()])) } }, async ({ ruleId, ...rest }) => {
  try {
    return ok(await api("PUT", `/api/rules/${ruleId}`, rest));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("delete_rule", { title: "Kuralı sil", description: "Kuralı kaldırır.", inputSchema: { ruleId: z.string() } }, async ({ ruleId }) => {
  try {
    return ok(await api("DELETE", `/api/rules/${ruleId}`));
  } catch (e) {
    return fail(e);
  }
});

/* ---------------- AI içerik ---------------- */

server.registerTool(
  "generate_content",
  {
    title: "AI içerik üret",
    description: "Marka hafızasıyla platforma özel gönderi/hikaye/reel metinleri ve 3 alternatif kanca üretir. Sonucu create_post ile yayınlayabilirsin.",
    inputSchema: {
      topic: z.string(),
      kind: z.enum(KINDS).default("post"),
      platforms: z.array(z.enum(PROVIDERS)).min(1),
      tone: z.string().optional(),
      goal: z.string().optional(),
      language: z.string().optional(),
      extraInstructions: z.string().optional(),
    },
  },
  async (args) => {
    try {
      return ok(await api("POST", "/api/ai/generate", args));
    } catch (e) {
      return fail(e);
    }
  },
);

/* ---------------- Analitik / ayarlar / sistem ---------------- */

server.registerTool("analytics_overview", { title: "Analitik özeti", description: "Kanal başına takipçi serileri, gönderi başarı oranları ve DM istatistikleri.", inputSchema: { days: z.number().optional() } }, async ({ days }) => {
  try {
    return ok(await api("GET", `/api/analytics/overview?days=${days ?? 30}`));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("dashboard", { title: "Panel özeti", description: "Kanal, gönderi ve gelen kutusu sayıları, yaklaşan gönderiler ve son aktivite." }, async () => {
  try {
    return ok(await api("GET", "/api/dashboard"));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool("get_settings", { title: "Ayarları getir", description: "Marka, çalışma saatleri ve AI yedek yanıt ayarları." }, async () => {
  try {
    return ok(await api("GET", "/api/settings"));
  } catch (e) {
    return fail(e);
  }
});

server.registerTool(
  "update_settings",
  {
    title: "Ayarları güncelle",
    description: "Marka bilgileri, çalışma saatleri, AI yedek yanıt gibi ayarları değiştirir.",
    inputSchema: {
      brandName: z.string().optional(),
      brandVoice: z.string().optional(),
      brandAudience: z.string().optional(),
      brandOffers: z.string().optional(),
      brandBannedWords: z.string().optional(),
      brandExamples: z.string().optional(),
      aiAutoReplyFallback: z.boolean().optional(),
      aiReplyInstructions: z.string().optional(),
      businessHoursEnabled: z.boolean().optional(),
      businessHoursStart: z.string().optional(),
      businessHoursEnd: z.string().optional(),
      businessDays: z.array(z.number()).optional(),
      outsideHoursMessage: z.string().optional(),
      handoffKeywords: z.string().optional(),
      replyDelaySeconds: z.number().optional(),
      welcomeMessage: z.string().optional(),
    },
  },
  async (args) => {
    try {
      return ok(await api("PUT", "/api/settings", args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool("system_info", { title: "Sistem bilgisi", description: "Public URL, webhook adresleri, yapılandırılmış platformlar, AI durumu." }, async () => {
  try {
    return ok(await api("GET", "/api/system"));
  } catch (e) {
    return fail(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
