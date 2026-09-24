import { AppError, notFound } from "../core/i18n.js";
import { channelsRepo } from "../core/repos/channels.js";
import { campaignsRepo } from "../core/repos/content.js";
import { postsRepo } from "../core/repos/posts.js";
import { orgsRepo } from "../core/repos/orgs.js";
import type { Ctx, PostKind, ProviderId } from "../core/types.js";
import { generatePlan, type GeneratedPlan } from "../ai/index.js";
import { getProvider } from "../providers/index.js";
import { requireRole } from "./access.js";
import { notify, orgT } from "./notify.js";
import { bulkCreatePosts, updatePost, type PostInput } from "./posts.js";
import { SlotAllocator } from "./slots.js";
import { addLocalDays, hhmmToMinutes, localDate, zonedToUtc } from "./time.js";

export interface PlannerInput {
  brief: string;
  goal?: string;
  tone?: string;
  channelIds: string[];
  days: number;
  postsPerWeek: number;
  kinds?: PostKind[];
  /** YYYY-MM-DD (çalışma alanı saat diliminde), boşsa yarın */
  startDate?: string;
  /** Oluşturulan gönderiler taslak mı kalsın (önerilen) yoksa doğrudan planlansın mı */
  mode?: "draft" | "schedule";
  /** Sadece önizleme: AI planını döndür, hiçbir şey kaydetme */
  previewOnly?: boolean;
}

export interface PlannerResult {
  plan: GeneratedPlan;
  campaignId: string | null;
  items: Array<{ index: number; title: string; publishAt: string | null; channels: string[]; postId?: string; errors: string[]; warnings: string[] }>;
}

function startDateLocal(orgTz: string, input?: string): { year: number; month: number; day: number } {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  const today = localDate(new Date(), orgTz);
  return addLocalDays(today.year, today.month, today.day, 1);
}

/** AI planını gönderi girdilerine dönüştür: platform -> kanal eşleme + saat yerleşimi */
export function planToPosts(ctx: Ctx, plan: GeneratedPlan, input: PlannerInput): Array<{ post: PostInput; title: string; channelNames: string[] }> {
  const org = orgsRepo.get(ctx.orgId);
  const tz = org?.timezone ?? "Europe/Istanbul";
  const start = startDateLocal(tz, input.startDate);
  const channels = input.channelIds.map((id) => channelsRepo.get(ctx.orgId, id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const allocator = new SlotAllocator(ctx.orgId);
  const out: Array<{ post: PostInput; title: string; channelNames: string[] }> = [];

  for (const item of plan.items) {
    const targetsChannels = channels.filter((c) => item.platforms.includes(c.provider) && getProvider(c.provider).capabilities[item.kind] !== false);
    if (!targetsChannels.length) continue;
    const day = addLocalDays(start.year, start.month, start.day, Math.max(0, item.dayOffset));
    const channelIds = targetsChannels.map((c) => c.id);
    let publishAt: string | null = null;
    const minutes = item.time ? hhmmToMinutes(item.time) : null;
    if (minutes !== null) {
      const at = zonedToUtc(day.year, day.month, day.day, minutes, tz);
      publishAt = at.toISOString();
      allocator.reserve(channelIds, at.getTime());
    } else {
      // O günün ilk boş paylaşım saati
      const dayStart = zonedToUtc(day.year, day.month, day.day, 0, tz);
      const slot = allocator.find({ channelIds, from: dayStart, days: 3, count: 1 })[0];
      publishAt = slot?.at ?? zonedToUtc(day.year, day.month, day.day, 600, tz).toISOString();
    }
    const textFor = (p: ProviderId) => item.texts.find((x) => x.platform === p);
    const mainText = item.texts[0]?.text ?? item.title;
    out.push({
      title: item.title,
      channelNames: targetsChannels.map((c) => c.name),
      post: {
        title: item.title,
        kind: item.kind,
        content: mainText,
        publishAt,
        draft: input.mode !== "schedule",
        targets: targetsChannels.map((c) => {
          const tx = textFor(c.provider);
          const settings: Record<string, unknown> = {};
          if (tx?.title && (c.provider === "youtube" || c.provider === "tiktok")) settings.title = tx.title;
          return { channelId: c.id, content: tx && tx.text !== mainText ? tx.text : null, settings };
        }),
        tags: [item.angle].filter(Boolean),
        firstComment: item.firstComment ?? null,
        notes: [item.visualDirection ? `🎬 ${item.visualDirection}` : "", item.hashtags.length ? `# ${item.hashtags.join(" ")}` : ""].filter(Boolean).join("\n") || null,
        applySignature: true,
      },
    });
  }
  return out;
}

export async function runPlanner(ctx: Ctx, input: PlannerInput): Promise<PlannerResult> {
  requireRole(ctx, "editor");
  if (!input.channelIds.length) throw new AppError(400, "post.need_channel");
  const channels = input.channelIds.map((id) => channelsRepo.get(ctx.orgId, id));
  if (channels.some((c) => !c)) throw notFound("channel");
  const org = orgsRepo.get(ctx.orgId);
  const tz = org?.timezone ?? "Europe/Istanbul";
  const start = startDateLocal(tz, input.startDate);
  const startIso = `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;

  const plan = await generatePlan(ctx.orgId, {
    brief: input.brief,
    goal: input.goal,
    tone: input.tone,
    days: Math.max(1, Math.min(input.days, 60)),
    postsPerWeek: Math.max(1, Math.min(input.postsPerWeek, 21)),
    platforms: [...new Set(channels.map((c) => c!.provider))],
    kinds: input.kinds,
    startDate: startIso,
  });

  const posts = planToPosts(ctx, plan, { ...input, startDate: startIso });
  if (input.previewOnly) {
    return {
      plan,
      campaignId: null,
      items: posts.map((p, index) => ({ index, title: p.title, publishAt: p.post.publishAt ?? null, channels: p.channelNames, errors: [], warnings: [] })),
    };
  }

  const bulk = await bulkCreatePosts(ctx, posts.map((p) => p.post), {
    atomic: false,
    campaign: { name: plan.name, goal: input.goal ?? null, brief: `${input.brief}\n\n${plan.strategy}` },
  });
  if (bulk.campaignId) {
    notify(ctx.orgId, {
      kind: "success",
      title: orgT(ctx.orgId, "notif.plan_created", { name: plan.name, count: bulk.created }),
      link: `/app/campaigns/${bulk.campaignId}`,
    });
  }
  return {
    plan,
    campaignId: bulk.campaignId,
    items: posts.map((p, index) => ({
      index,
      title: p.title,
      publishAt: bulk.items[index]?.publishAt ?? null,
      channels: p.channelNames,
      postId: bulk.items[index]?.postId,
      errors: bulk.items[index]?.errors ?? [],
      warnings: bulk.items[index]?.warnings ?? [],
    })),
  };
}

/** Kampanyadaki tarihli taslakların hepsini planla (eksik medyası olanlar raporlanır) */
export async function scheduleCampaign(ctx: Ctx, campaignId: string): Promise<{ scheduled: number; failed: Array<{ postId: string; title: string | null; error: string }> }> {
  requireRole(ctx, "editor");
  if (!campaignsRepo.get(ctx.orgId, campaignId)) throw notFound("campaign");
  const drafts = postsRepo.list(ctx.orgId, { campaignId, status: ["draft"], limit: 500, order: "asc" });
  let scheduled = 0;
  const failed: Array<{ postId: string; title: string | null; error: string }> = [];
  for (const p of drafts) {
    try {
      const future = p.publishAt && new Date(p.publishAt).getTime() > Date.now();
      await updatePost(ctx, p.id, { draft: false, publishAt: future ? p.publishAt : "next_slot" });
      scheduled++;
    } catch (e) {
      failed.push({ postId: p.id, title: p.title, error: e instanceof AppError ? e.localized(ctx.locale) : e instanceof Error ? e.message : String(e) });
    }
  }
  campaignsRepo.update(ctx.orgId, campaignId, { status: "active" });
  return { scheduled, failed };
}
