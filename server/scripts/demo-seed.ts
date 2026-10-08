/**
 * Panel tasarımını yerelde demo verisiyle görmek için tohumlama (docs/panel/05-YOL-HARITASI.md F1).
 * Yalnızca demo veri klasörüne yazar (server/scripts/demo-api.ts DATA_DIR=./data/demo verir); gerçek verine dokunmaz.
 * Veriler kurgusaldır ("Leblebi Kuruyemiş (demo)"), sabit tohumlu rastgele sayılarla her seferinde aynı çıkar.
 *
 * Demo giriş (yalnızca bu yerel demo veritabanında geçerli):
 *   E-posta: demo@reblebi.local
 *   Şifre:   ReblebiDemo2026!
 */
import { getDb } from "../src/core/db.js";
import { orgsRepo, usersRepo } from "../src/core/repos/orgs.js";
import { channelsRepo } from "../src/core/repos/channels.js";
import { postsRepo } from "../src/core/repos/posts.js";
import { analyticsRepo, postMetricsRepo } from "../src/core/repos/misc.js";
import { inboxRepo } from "../src/core/repos/inbox.js";
import { campaignsRepo } from "../src/core/repos/content.js";
import { bioRepo } from "../src/core/repos/bio.js";
import { insightsRepo } from "../src/core/repos/insights.js";
import { competitorsRepo } from "../src/core/repos/competitors.js";
import { adsRepo } from "../src/core/repos/ads.js";
import { libraryRepo } from "../src/core/repos/library.js";
import { hashtagsRepo } from "../src/core/repos/hashtags.js";
import { dashboardsRepo } from "../src/core/repos/dashboards.js";
import { autolistsRepo } from "../src/core/repos/autolists.js";
import { overviewTemplate } from "../src/api/routes/dashboards.js";
import { ensureDemoMentions } from "./demo-mentions.js";
import type { PostKind, ProviderId } from "../src/core/types.js";

export const DEMO_EMAIL = "demo@reblebi.local";
export const DEMO_PASSWORD = "ReblebiDemo2026!";

const DAYS = 120;
const DAY = 86_400_000;

/** Sabit tohumlu PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoChannel {
  provider: ProviderId;
  name: string;
  start: number;
  growth: number;
  perWeek: number;
  kinds: PostKind[];
  viewRate: number;
}

const CHANNELS: DemoChannel[] = [
  { provider: "instagram", name: "leblebikuruyemis", start: 8200, growth: 26, perWeek: 5, kinds: ["post", "reel", "reel", "story"], viewRate: 0.42 },
  { provider: "facebook", name: "Leblebi Kuruyemiş", start: 5100, growth: 6, perWeek: 3, kinds: ["post", "post", "video"], viewRate: 0.18 },
  { provider: "tiktok", name: "@leblebikuruyemis", start: 2400, growth: 34, perWeek: 4, kinds: ["video"], viewRate: 1.1 },
  { provider: "linkedin", name: "Leblebi Kuruyemiş A.Ş.", start: 1300, growth: 4, perWeek: 2, kinds: ["post"], viewRate: 0.35 },
  { provider: "x", name: "@leblebikuruyemis", start: 2100, growth: 3, perWeek: 3, kinds: ["post", "thread"], viewRate: 0.25 },
  { provider: "youtube", name: "Leblebi Kuruyemiş", start: 900, growth: 5, perWeek: 1, kinds: ["video"], viewRate: 0.9 },
];

const TOPICS = [
  "Çifte kavrulmuş leblebi yeniden stokta",
  "Hafta sonu kuruyemiş tabağı önerisi",
  "Atölyeden: kavurma sabah 6'da başlıyor",
  "Yeni sezon fındık geldi",
  "Kargo cuma günü çıkıyor",
  "Müşteri sorusu: tuzsuz seçenek var mı?",
  "Sahne arkası: paketleme masası",
  "Bu ayın kampanyası: ikinci paket yarı fiyat",
  "Tarif: leblebili granola",
  "Bayram hediye kutuları hazır",
];
const TAGS = ["#leblebi", "#kuruyemiş", "#yerelüretim", "#atıştırmalık", "#tarif", "#kampanya", "#fındık", "#sağlıklıatıştırmalık"];

/** Etkileşim akşam saatlerinde ve hafta sonu daha yüksek (ısı haritası anlamlı olsun) */
function timeBoost(hour: number, weekday: number): number {
  const evening = hour >= 18 && hour <= 21 ? 1.45 : hour >= 12 && hour <= 14 ? 1.15 : hour < 9 ? 0.7 : 1;
  const weekend = weekday === 0 || weekday === 6 ? 1.2 : 1;
  return evening * weekend;
}

export function seedDemo(): { created: boolean } {
  const existing = usersRepo.findByEmail(DEMO_EMAIL);
  if (existing) {
    // Eski tohumlamada yayınlanan gönderilerin takvim tarihi boş kalmıştı: yayın tarihine eşitle
    getDb().prepare("UPDATE posts SET publish_at = published_at WHERE status = 'published' AND publish_at IS NULL AND published_at IS NOT NULL").run();
    syncConversationTimes();
    for (const m of orgsRepo.listForUser(existing.id)) {
      ensureDemoCampaign(m.id);
      ensureDemoBio(m.id);
      ensureDemoInsights(m.id);
      ensureDemoCompetitors(m.id);
      ensureDemoComments(m.id);
      ensureDemoAds(m.id);
      ensureDemoAdsMulti(m.id);
      ensureDemoLibrary(m.id);
      ensureDemoYoutube(m.id);
      ensureDemoHashtags(m.id);
      ensureDemoCompetitorsMore(m.id);
      ensureDemoGmb(m.id);
      ensureDemoDashboards(m.id);
      ensureDemoAdStatuses(m.id);
      ensureDemoAutolists(m.id);
      ensureDemoWebsite(m.id);
      ensureDemoMentions(m.id);
    }
    return { created: false };
  }
  const r = rng(20261003);
  const db = getDb();
  const now = Date.now();
  const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

  const user = usersRepo.create({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo Kullanıcı", locale: "tr", verified: true });
  usersRepo.markVerified(user.id);
  const org = orgsRepo.create({ name: "Leblebi Kuruyemiş (demo)", plan: "agency", timezone: "Europe/Istanbul", locale: "tr", ownerId: user.id });

  for (const [ci, c] of CHANNELS.entries()) {
    const { channel } = channelsRepo.upsert({ orgId: org.id, provider: c.provider, externalId: `demo-${c.provider}`, name: c.name, username: c.name, accessToken: "demo-token" });

    // Takipçi: kanal 120 gün önce bağlandı; LinkedIn ve YouTube son 75 günde bağlandı (bağlantı öncesi boşluk görünür)
    const connectedDaysAgo = c.provider === "linkedin" || c.provider === "youtube" ? 75 : DAYS;
    let followers = c.start;
    for (let d = connectedDaysAgo; d >= 0; d--) {
      followers += Math.round(c.growth * (0.4 + r() * 1.2) - (r() < 0.08 ? c.growth * 2 : 0));
      analyticsRepo.upsert(channel.id, ymd(now - d * DAY), { followers, following: 180 + ci * 12, posts: 300 + (DAYS - d) });
    }

    // Yayınlanmış gönderiler
    for (let d = DAYS; d >= 0; d--) {
      if (r() > c.perWeek / 7) continue;
      const hour = [9, 10, 12, 13, 18, 19, 20, 21][Math.floor(r() * 8)];
      const at = new Date(now - d * DAY);
      at.setUTCHours(hour - 3, Math.floor(r() * 50), 0, 0); // İstanbul saati
      if (at.getTime() > now) continue;
      const kind = c.kinds[Math.floor(r() * c.kinds.length)];
      const topic = TOPICS[Math.floor(r() * TOPICS.length)];
      const tags = [TAGS[0], TAGS[1 + Math.floor(r() * (TAGS.length - 1))], r() < 0.4 ? TAGS[1 + Math.floor(r() * (TAGS.length - 1))] : ""].filter(Boolean);
      const content = `${topic}. ${[...new Set(tags)].join(" ")}`;
      const post = postsRepo.create({ orgId: org.id, kind, content, status: "published", publishAt: at.toISOString(), source: "panel", createdBy: user.id, targets: [{ channelId: channel.id }] });
      postsRepo.setStatus(post.id, "published", at.toISOString());
      const target = post.targets[0];
      postsRepo.updateTarget(target.id, { status: "published", publishedAt: at.toISOString(), externalId: `demo-${target.id}`, externalUrl: null });
      // Son 2 günün gönderilerinin bir kısmının metriği henüz çekilmemiş (gerçekte de olduğu gibi)
      if (d <= 1 && r() < 0.6) continue;
      const boost = timeBoost(hour, at.getUTCDay()) * (kind === "reel" || kind === "video" ? 1.6 : 1) * (0.6 + r() * 0.9);
      const views = Math.round(followers * c.viewRate * boost);
      const likes = Math.round(views * (0.03 + r() * 0.05));
      const comments = Math.round(likes * (0.04 + r() * 0.1));
      const shares = Math.round(likes * (0.02 + r() * 0.07));
      const metrics: Record<string, number> = { views, likes, comments, shares };
      if (c.provider === "instagram") metrics.saves = Math.round(likes * (0.05 + r() * 0.1));
      postMetricsRepo.set(target.id, metrics);
    }
  }

  // Planlanmış gönderiler (takvim boş görünmesin)
  const channels = channelsRepo.list(org.id);
  for (let i = 1; i <= 8; i++) {
    const at = new Date(now + i * 0.9 * DAY);
    at.setUTCHours(16, 0, 0, 0);
    const ch = channels[i % channels.length];
    postsRepo.create({ orgId: org.id, kind: "post", content: `${TOPICS[i % TOPICS.length]}. #leblebi`, status: "scheduled", publishAt: at.toISOString(), source: "panel", createdBy: user.id, targets: [{ channelId: ch.id }] });
  }

  // Gelen kutusu: son 60 gün, kural/AI yanıt oranı ~%60
  const ig = channels.find((c) => c.provider === "instagram")!;
  const questions = ["Tuzsuz leblebi var mı?", "Kargo ne zaman çıkar?", "Toptan satış yapıyor musunuz?", "Hediye kutusu kaç gramlık?", "Siparişim nerede?"];
  for (let i = 0; i < 48; i++) {
    const when = now - Math.floor(r() * 60) * DAY - Math.floor(r() * 20) * 3600_000;
    const res = inboxRepo.recordInbound({ orgId: org.id, channelId: ig.id, conversationExternalId: `demo-conv-${i}`, participantId: `demo-user-${i}`, participantName: `Müşteri ${i + 1}`, text: questions[i % questions.length], receivedAt: new Date(when).toISOString() });
    if (!res) continue;
    db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(new Date(when).toISOString(), res.message.id);
    if (r() < 0.6) {
      const out = inboxRepo.recordOutbound(res.conversation.id, "Merhaba! Hemen yardımcı olalım.", r() < 0.7 ? "rule" : "ai");
      db.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(new Date(when + 60_000).toISOString(), out.id);
    }
  }
  syncConversationTimes();
  ensureDemoCampaign(org.id);
  ensureDemoBio(org.id);
  ensureDemoInsights(org.id);
  ensureDemoCompetitors(org.id);
  ensureDemoComments(org.id);
  ensureDemoAds(org.id);
  ensureDemoAdsMulti(org.id);
  ensureDemoLibrary(org.id);
  ensureDemoYoutube(org.id);
  ensureDemoHashtags(org.id);
  ensureDemoCompetitorsMore(org.id);
  ensureDemoGmb(org.id);
  ensureDemoDashboards(org.id);
  ensureDemoAdStatuses(org.id);
  ensureDemoAutolists(org.id);
  ensureDemoWebsite(org.id);
  ensureDemoMentions(org.id);
  return { created: true };
}

/** Konuşmanın son mesaj zamanı, tarihi geriye çekilmiş demo mesajlarıyla aynı olsun */
function syncConversationTimes(): void {
  getDb()
    .prepare("UPDATE conversations SET last_message_at = COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = conversations.id), last_message_at)")
    .run();
}

/** Kampanya panosu boş görünmesin: son 30 günün "Yeni sezon fındık" gönderileri bir kampanyada toplanır */
function ensureDemoCampaign(orgId: string): void {
  if (campaignsRepo.list(orgId).length) return;
  const from = new Date(Date.now() - 30 * DAY).toISOString();
  const c = campaignsRepo.create(orgId, {
    name: "Yeni sezon fındık",
    goal: "Yeni sezon ürünlerini duyurmak",
    source: "panel",
    startsAt: from,
    endsAt: new Date(Date.now() + 14 * DAY).toISOString(),
  });
  getDb()
    .prepare("UPDATE posts SET campaign_id = ? WHERE org_id = ? AND campaign_id IS NULL AND (content LIKE ? OR content LIKE ?) AND COALESCE(publish_at, created_at) >= ?")
    .run(c.id, orgId, "Yeni sezon fındık%", "Bu ayın kampanyası%", from);
}

/** Link in bio: örnek sayfa + son 60 günün kaynak bazlı sayaçları (kurgusal) */
function ensureDemoBio(orgId: string): void {
  if (bioRepo.list(orgId).length) return;
  const page = bioRepo.create(orgId, {
    slug: "leblebikuruyemis",
    title: "Leblebi Kuruyemiş",
    bio: "Çorum'dan taze kavrulmuş leblebi ve kuruyemiş. Kargo her cuma.",
    links: [
      { id: "lnk_magaza", label: "Online mağaza", url: "https://example.com/magaza", enabled: true },
      { id: "lnk_kampanya", label: "Bu ayın kampanyası: ikinci paket yarı fiyat", url: "https://example.com/kampanya", enabled: true },
      { id: "lnk_toptan", label: "Toptan sipariş", url: "https://example.com/toptan", enabled: true },
      { id: "lnk_tarif", label: "Tarif: leblebili granola", url: "https://example.com/tarif", enabled: true },
    ],
    socials: [
      { network: "instagram", url: "https://www.instagram.com/leblebikuruyemis" },
      { network: "tiktok", url: "https://www.tiktok.com/@leblebikuruyemis" },
      { network: "x", url: "https://x.com/leblebikuruyemis" },
      { network: "website", url: "https://example.com" },
    ],
  });
  const r = rng(7);
  const sources: Array<[string, number]> = [["instagram", 0.55], ["tiktok", 0.22], ["direct", 0.1], ["x", 0.06], ["facebook", 0.04], ["other", 0.03]];
  const linkShare: Array<[string, number]> = [["lnk_magaza", 0.42], ["lnk_kampanya", 0.31], ["lnk_toptan", 0.09], ["lnk_tarif", 0.12], ["s0-instagram", 0.03], ["s1-tiktok", 0.03]];
  const ins = getDb().prepare(
    "INSERT INTO bio_events (page_id, link_id, day, source, count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page_id, link_id, day, source) DO UPDATE SET count = excluded.count",
  );
  for (let d = 60; d >= 0; d--) {
    const at = new Date(Date.now() - d * DAY);
    const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6 ? 1.3 : 1;
    const views = Math.round((40 + (60 - d) * 0.6) * weekend * (0.7 + r() * 0.6));
    for (const [src, share] of sources) {
      const v = Math.round(views * share * (0.8 + r() * 0.4));
      if (v > 0) ins.run(page.id, "", at.toISOString().slice(0, 10), src, v);
      const clicks = Math.round(v * (0.28 + r() * 0.12));
      for (const [lid, ls] of linkShare) {
        const c = Math.round(clicks * ls * (0.7 + r() * 0.6));
        if (c > 0) ins.run(page.id, lid, at.toISOString().slice(0, 10), src, c);
      }
    }
  }
}

/** Hesap insights + kitle: Instagram ve Facebook için kurgusal günlük değerler (bugün hariç) */
function ensureDemoInsights(orgId: string): void {
  const r = rng(11);
  for (const c of channelsRepo.list(orgId)) {
    if (c.provider !== "instagram" && c.provider !== "facebook") continue;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - DAYS * DAY).toISOString().slice(0, 10);
    if (insightsRepo.daysWithInsights(c.id, from, today).size) continue;
    const ig = c.provider === "instagram";
    for (let d = DAYS; d >= 1; d--) {
      const at = new Date(Date.now() - d * DAY);
      const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6 ? 1.25 : 1;
      const base = (ig ? 2400 : 900) * weekend * (0.7 + r() * 0.6) * (1 + (DAYS - d) / 300);
      insightsRepo.mergeDay(c.id, at.toISOString().slice(0, 10), {
        reach: Math.round(base),
        views: Math.round(base * (ig ? 2.6 : 1.8)),
        profileViews: Math.round(base * (ig ? 0.045 : 0.02)),
        ...(ig ? { websiteClicks: Math.round(base * 0.006) } : {}),
        follows: Math.round((ig ? 34 : 9) * (0.5 + r())),
        unfollows: Math.round((ig ? 8 : 3) * (0.4 + r())),
      });
    }
    insightsRepo.setAudience(
      c.id,
      ig
        ? {
            country: { TR: 7120, DE: 410, NL: 160, AZ: 120, GB: 90, US: 80 },
            city: { "İstanbul, Türkiye": 2350, "Ankara, Türkiye": 980, "Çorum, Türkiye": 760, "İzmir, Türkiye": 690, "Bursa, Türkiye": 340, "Berlin, Germany": 120 },
            age: { "18-24": 1420, "25-34": 3010, "35-44": 2050, "45-54": 960, "55-64": 380, "65+": 160 },
            gender: { F: 4880, M: 3020, U: 80 },
          }
        : { country: { TR: 4620, DE: 260, NL: 90 }, city: { "İstanbul, Türkiye": 1500, "Çorum, Türkiye": 810, "Ankara, Türkiye": 620 } },
    );
  }
}

/** Rakip takibi: kurgusal hesaplar (gerçek markalar değil) ve 120 günlük takipçi anlık görüntüleri */
function ensureDemoCompetitors(orgId: string): void {
  if (competitorsRepo.list(orgId).length) return;
  const r = rng(23);
  const accounts = [
    { username: "kavurucu_demo", name: "Kavurucu (demo)", start: 12400, growth: 22, likes: 260, comments: 14, perMonth: 18 },
    { username: "cerezci_ornek", name: "Çerezci Örnek (demo)", start: 5300, growth: 31, likes: 210, comments: 19, perMonth: 24 },
    { username: "findikevi_demo", name: "Fındık Evi (demo)", start: 21800, growth: 9, likes: 340, comments: 11, perMonth: 9 },
    { username: "atolye_kuruyemis_demo", name: "Atölye Kuruyemiş (demo)", start: 3100, growth: 14, likes: 95, comments: 7, perMonth: 14 },
  ];
  const captions = ["Yeni hasat geldi, stoklar sınırlı.", "Hafta sonu kampanyası: ikinci paket indirimli.", "Kavurma atölyesinden kısa video.", "Müşteri yorumu: en taze çerez burada.", "Bayram kutuları siparişe açıldı.", "Tarif: fıstıklı kurabiye."];
  for (const a of accounts) {
    const c = competitorsRepo.create(orgId, a.username);
    const recent = Array.from({ length: 12 }, (_, i) => ({
      id: `${a.username}-${i}`,
      caption: captions[(i + a.username.length) % captions.length],
      likes: Math.round(a.likes * (0.5 + r() * 1.1)),
      comments: Math.round(a.comments * (0.5 + r() * 1.1)),
      timestamp: new Date(Date.now() - Math.round((i * 30) / a.perMonth + r()) * DAY).toISOString(),
      type: r() < 0.4 ? "VIDEO" : "IMAGE",
      permalink: null,
    }));
    competitorsRepo.saveProfile(c.id, { name: a.name, avatarUrl: null, biography: "Kurgusal demo hesabı", recent });
    let followers = a.start;
    const avgLikes = recent.reduce((s, m) => s + m.likes, 0) / recent.length;
    const avgComments = recent.reduce((s, m) => s + m.comments, 0) / recent.length;
    for (let d = DAYS; d >= 0; d--) {
      followers += Math.round(a.growth * (0.3 + r() * 1.4));
      competitorsRepo.upsertSnapshot(c.id, new Date(Date.now() - d * DAY).toISOString().slice(0, 10), {
        followers,
        mediaCount: 400 + Math.round((DAYS - d) * (a.perMonth / 30)),
        metrics: {
          postsLast30: a.perMonth,
          avgLikes: Math.round(avgLikes * 10) / 10,
          avgComments: Math.round(avgComments * 10) / 10,
          engagementRate: Math.round(((avgLikes + avgComments) / followers) * 10000) / 100,
        },
      });
    }
  }
}

/** Rakip takibi (YouTube, Bluesky): kurgusal kanallar/hesaplar ve 120 günlük anlık görüntü */
function ensureDemoCompetitorsMore(orgId: string): void {
  const have = new Set(competitorsRepo.list(orgId).map((c) => c.provider));
  const r = rng(29);
  const sets: Array<{ provider: "youtube" | "bluesky" | "facebook"; accounts: Array<{ username: string; name: string; start: number; growth: number; likes: number; comments: number; views?: number; shares?: number; perMonth: number }>; captions: string[] }> = [
    {
      provider: "youtube",
      accounts: [
        { username: "kavurmaustasi_demo", name: "Kavurma Ustası (demo)", start: 18600, growth: 28, likes: 420, comments: 55, views: 9800, perMonth: 6 },
        { username: "ornekmutfak_demo", name: "Örnek Mutfak (demo)", start: 7200, growth: 15, likes: 190, comments: 31, views: 4100, perMonth: 9 },
        { username: "cerezatolyesi_demo", name: "Çerez Atölyesi (demo)", start: 2900, growth: 11, likes: 85, comments: 12, views: 1600, perMonth: 4 },
      ],
      captions: ["Fıstık nasıl kavrulur? Adım adım", "Atölyede bir gün", "5 dakikada granola", "Kuruyemiş saklama rehberi", "Bayram ikramlıkları", "Müşteri soruları yanıtlıyoruz"],
    },
    {
      provider: "facebook",
      accounts: [
        { username: "kavurucudemo", name: "Kavurucu (demo)", start: 9800, growth: 9, likes: 140, comments: 18, shares: 9, perMonth: 14 },
        { username: "findikevidemo", name: "Fındık Evi (demo)", start: 15400, growth: 5, likes: 95, comments: 8, shares: 4, perMonth: 8 },
      ],
      captions: ["Hafta sonu indirimi başladı.", "Yeni hasat fındık mağazada.", "Kavurma atölyesinden canlı yayın.", "Bayram paketleri hazır."],
    },
    {
      provider: "bluesky",
      accounts: [
        { username: "cerezci-ornek.bsky.social", name: "Çerezci Örnek (demo)", start: 1450, growth: 6, likes: 38, comments: 5, shares: 7, perMonth: 20 },
        { username: "kavurucu-demo.bsky.social", name: "Kavurucu (demo)", start: 820, growth: 4, likes: 22, comments: 3, shares: 4, perMonth: 14 },
      ],
      captions: ["Yeni hasat yola çıktı.", "Bugün atölyede fıstık günü.", "Hangi çeşidi denemek istersiniz?", "Kargo saatleri değişti.", "Tarif önerilerinizi bekliyoruz."],
    },
  ];
  for (const set of sets) {
    if (have.has(set.provider)) continue;
    for (const a of set.accounts) {
      const c = competitorsRepo.create(orgId, a.username, set.provider);
      const recent = Array.from({ length: 12 }, (_, i) => ({
        id: `${a.username}-${i}`,
        caption: set.captions[(i + a.username.length) % set.captions.length],
        likes: Math.round(a.likes * (0.5 + r() * 1.1)),
        comments: Math.round(a.comments * (0.5 + r() * 1.1)),
        ...(a.views ? { views: Math.round(a.views * (0.4 + r() * 1.4)) } : {}),
        ...(a.shares ? { shares: Math.round(a.shares * (0.4 + r() * 1.2)) } : {}),
        timestamp: new Date(Date.now() - Math.round((i * 30) / a.perMonth + r()) * DAY).toISOString(),
        type: set.provider === "youtube" ? "VIDEO" : set.provider === "facebook" ? "added_photos" : "POST",
        permalink: null,
      }));
      competitorsRepo.saveProfile(c.id, { name: a.name, avatarUrl: null, biography: "Kurgusal demo hesabı", recent });
      const mean = (k: "likes" | "comments" | "views") => recent.reduce((s, m) => s + ((m as Record<string, unknown>)[k] as number | undefined ?? 0), 0) / recent.length;
      let followers = a.start;
      for (let d = DAYS; d >= 0; d--) {
        followers += Math.round(a.growth * (0.3 + r() * 1.4));
        competitorsRepo.upsertSnapshot(c.id, new Date(Date.now() - d * DAY).toISOString().slice(0, 10), {
          followers,
          mediaCount: (set.provider === "youtube" ? 140 : 600) + Math.round((DAYS - d) * (a.perMonth / 30)),
          metrics: {
            postsLast30: a.perMonth,
            avgLikes: Math.round(mean("likes") * 10) / 10,
            avgComments: Math.round(mean("comments") * 10) / 10,
            ...(a.views ? { avgViews: Math.round(mean("views") * 10) / 10 } : {}),
            engagementRate: Math.round(((mean("likes") + mean("comments")) / followers) * 10000) / 100,
          },
        });
      }
    }
  }
}

/** Google İşletme Profili: kurgusal konum, günlük Haritalar/Arama metrikleri ve gelen kutusunda değerlendirmeler */
function ensureDemoGmb(orgId: string): void {
  let ch = channelsRepo.list(orgId).find((c) => c.provider === "gmb");
  if (!ch) {
    ch = channelsRepo.upsert({ orgId, provider: "gmb", externalId: "accounts/demo/locations/1", name: "Leblebi Kuruyemiş · Kadıköy (demo)", accessToken: "demo-token", metadata: { locationId: "accounts/demo/locations/1" } }).channel;
    let reviews = 112;
    for (let d = DAYS; d >= 0; d--) {
      if (d % 9 === 0) reviews++;
      analyticsRepo.upsert(ch.id, new Date(Date.now() - d * DAY).toISOString().slice(0, 10), { reviews, rating: 4.6 });
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - DAYS * DAY).toISOString().slice(0, 10);
  if (!insightsRepo.daysWithInsights(ch.id, from, today).size) {
    const r = rng(41);
    // Google Business verisi birkaç gün gecikmeli gelir: son 3 gün boş
    for (let d = DAYS; d >= 3; d--) {
      const at = new Date(Date.now() - d * DAY);
      const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6 ? 1.35 : 1;
      const base = 310 * weekend * (0.7 + r() * 0.6);
      insightsRepo.mergeDay(ch.id, at.toISOString().slice(0, 10), {
        views: Math.round(base),
        websiteClicks: Math.round(base * 0.04 * (0.6 + r() * 0.8)),
        calls: Math.round(base * 0.015 * (0.4 + r() * 1.2)),
        directions: Math.round(base * 0.03 * (0.5 + r())),
      });
    }
  }
  const db = getDb();
  if (db.prepare("SELECT 1 FROM conversations WHERE channel_id = ? AND external_id LIKE 'r:%' LIMIT 1").get(ch.id)) return;
  const items = [
    { id: "demo-r1", name: "Zeynep A.", stars: 5, text: "Fıstıklar çok taze, paketleme de özenliydi. Teşekkürler!", hoursAgo: 3 },
    { id: "demo-r2", name: "Can T.", stars: 3, text: "Ürün güzel ama Cumartesi öğleden sonra kasada uzun sıra vardı.", hoursAgo: 20 },
    { id: "demo-r3", name: "Elif S.", stars: 4, text: "Kavrulmuş leblebi harika, keşke tuzsuz seçeneği de olsa.", hoursAgo: 52 },
  ];
  for (const it of items) {
    const at = new Date(Date.now() - it.hoursAgo * 3600_000).toISOString();
    const rec = inboxRepo.recordInbound({
      orgId,
      channelId: ch.id,
      conversationExternalId: `r:${it.id}`,
      participantId: it.id,
      participantName: it.name,
      externalMessageId: it.id,
      text: `${"★".repeat(it.stars)}${"☆".repeat(5 - it.stars)} ${it.text}`,
      receivedAt: at,
      metadata: { kind: "review", reviewName: `accounts/demo/locations/1/reviews/${it.id}`, rating: it.stars },
    });
    if (rec) inboxRepo.flagAttention(rec.conversation.id, true);
  }
}

/** Web sitesi analitiği: kurgusal site (.example alan adı) ve 120 günlük günlük sayaçlar */
function ensureDemoWebsite(orgId: string): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM sites WHERE org_id = ?").get(orgId)) return;
  const id = "site_demo_" + orgId.slice(-6);
  db.prepare("INSERT INTO sites (id, org_id, domain, token, last_hit_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, orgId, "leblebi-kuruyemis.example", "demo-site-token-" + orgId.slice(-6), new Date(Date.now() - 20 * 60_000).toISOString(), new Date(Date.now() - DAYS * DAY).toISOString());
  const r = rng(53);
  const st = db.prepare("INSERT INTO site_daily (site_id, date, dim, key, views, entries) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, date, dim, key) DO UPDATE SET views = views + excluded.views, entries = entries + excluded.entries");
  const pick = <T,>(list: Array<[T, number]>): T => {
    const total = list.reduce((a, x) => a + x[1], 0);
    let x = r() * total;
    for (const [k, w] of list) if ((x -= w) <= 0) return k;
    return list[0][0];
  };
  const pages: Array<[string, number]> = [["/", 40], ["/urunler", 18], ["/urunler/cifte-kavrulmus-leblebi", 12], ["/urunler/findik", 9], ["/tarifler/leblebili-granola", 7], ["/iletisim", 4], ["/sepet", 6]];
  const refs: Array<[string, number]> = [["(doğrudan)", 30], ["google.com", 28], ["l.instagram.com", 16], ["l.facebook.com", 8], ["t.co", 3], ["linkedin.com", 2], ["bing.com", 3], ["youtube.com", 2]];
  const social: Record<string, string> = { "l.instagram.com": "Instagram", "l.facebook.com": "Facebook", "t.co": "X", "linkedin.com": "LinkedIn", "youtube.com": "YouTube" };
  // Tek işlemde yaz (çok sayıda küçük satır)
  db.exec("BEGIN");
  for (let d = DAYS; d >= 0; d--) {
    const date = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    const weekend = [0, 6].includes(new Date(Date.now() - d * DAY).getUTCDay()) ? 1.3 : 1;
    const visitors = Math.round(140 * weekend * (0.7 + r() * 0.6) * (1 + (DAYS - d) / 260));
    let views = 0;
    for (let v = 0; v < visitors; v++) {
      const n = 1 + Math.floor(r() * r() * 5);
      views += n;
      for (let k = 0; k < n; k++) st.run(id, date, "path", pick(pages), 1, k === 0 ? 1 : 0);
      const ref = pick(refs);
      st.run(id, date, "ref", ref, 1, 1);
      if (social[ref]) st.run(id, date, "social", social[ref], 1, 1);
      if (ref === "l.instagram.com" && r() < 0.6) {
        st.run(id, date, "utm", "instagram", 1, 1);
        st.run(id, date, "campaign", r() < 0.5 ? "yeni-sezon-findik" : "bio", 1, 1);
      }
      st.run(id, date, "device", pick([["mobile", 68], ["desktop", 27], ["tablet", 5]]), 0, 1);
      st.run(id, date, "browser", pick([["Chrome", 46], ["Safari", 38], ["Samsung Internet", 7], ["Edge", 5], ["Firefox", 4]]), 0, 1);
      st.run(id, date, "lang", pick([["tr", 88], ["en", 7], ["de", 5]]), 0, 1);
    }
    st.run(id, date, "", "", views, visitors);
  }
  db.exec("COMMIT");
}

/** Otomatik liste: haftada iki kez paylaşılan kurgusal kuruyemiş ipuçları (demoda zamanlayıcı kapalı, paylaşılmaz) */
function ensureDemoAutolists(orgId: string): void {
  if (autolistsRepo.list(orgId).length) return;
  const chans = channelsRepo.list(orgId).filter((c) => c.provider === "x" || c.provider === "linkedin" || c.provider === "facebook");
  const l = autolistsRepo.create(orgId, {
    name: "Kuruyemiş ipuçları",
    channelIds: chans.map((c) => c.id),
    slots: [
      { day: 1, time: "10:00" },
      { day: 3, time: "18:30" },
    ],
    repeat: true,
    createdBy: null,
  });
  const tips = [
    "Kuruyemişleri hava almayan kavanozda, serin ve karanlık yerde saklayın; tazeliği haftalarca korunur. #leblebi",
    "Leblebiyi yoğurda ya da salataya ekleyin: çıtır doku ve bitkisel protein. #yerelüretim",
    "Fındığı hafif kavurmak aromasını belirginleştirir: 160 °C fırında 8-10 dakika yeter.",
    "Sık sorulan: Siparişler aynı gün kargoda, Türkiye'nin her yerine 1-3 iş günü.",
    "Çifte kavrulmuş leblebi ile sarı leblebinin farkı: kavurma süresi ve nem oranı.",
  ];
  for (const content of tips) autolistsRepo.addItem(l.id, { kind: "post", content, mediaIds: [] });
  autolistsRepo.update(orgId, l.id, { enabled: true, position: 2 });
  const used = autolistsRepo.items(l.id).slice(0, 2);
  for (const it of used) autolistsRepo.markUsed(it.id, new Date(Date.now() - 3 * DAY).toISOString());
}

/** Reklam yönetimi: kampanya durumları (senkronda platformdan okunur; demoda sabit) */
function ensureDemoAdStatuses(orgId: string): void {
  const states: Record<string, Record<string, { status: "active" | "paused"; name: string }>> = {
    meta: {
      "demo-c1": { status: "active", name: "Yeni sezon fındık · Trafik" },
      "demo-c2": { status: "active", name: "Bayram kutuları · Satış" },
      "demo-c3": { status: "paused", name: "Marka bilinirliği · Reels" },
    },
    google: { "demo-g1": { status: "active", name: "Arama · Leblebi" }, "demo-g2": { status: "paused", name: "Performance Max · Bayram" } },
    tiktok: { "demo-t1": { status: "active", name: "Spark · Kavurma videoları" }, "demo-t2": { status: "active", name: "Trafik · Web sitesi" } },
  };
  for (const acc of adsRepo.list(orgId)) {
    if (acc.extra.campaigns) continue;
    const map = states[acc.provider];
    if (map) adsRepo.mergeExtra(acc.id, { campaigns: map });
  }
}

/** Studio: hazır özet panosu ve Instagram odaklı aylık pano */
function ensureDemoDashboards(orgId: string): void {
  if (dashboardsRepo.list(orgId).length) return;
  dashboardsRepo.create(orgId, { name: "Genel bakış", widgets: overviewTemplate() });
  dashboardsRepo.create(orgId, {
    name: "Instagram aylık",
    widgets: [
      { id: "i1", type: "kpi", size: "s", provider: "instagram", metric: "ins.reach" },
      { id: "i2", type: "kpi", size: "s", provider: "instagram", metric: "ins.profileViews" },
      { id: "i3", type: "kpi", size: "s", provider: "instagram", metric: "followersDelta" },
      { id: "i4", type: "kpi", size: "s", provider: "instagram", metric: "engagementRate" },
      { id: "i5", type: "trend", size: "m", provider: "instagram", metric: "ins.reach" },
      { id: "i6", type: "kinds", size: "m", provider: "instagram" },
      { id: "i7", type: "competitors", size: "m", provider: "instagram" },
      { id: "i8", type: "note", size: "m", title: "Bu ayın hedefi", text: "Reels sayısını haftada 3'e çıkar.\nRakiplerin ortalama etkileşim oranını geç." },
      { id: "i9", type: "ads", size: "l" },
    ],
  });
}

/** Gelen kutusunda gönderi yorumları: kurgusal Instagram ve Facebook yorum konuları */
function ensureDemoComments(orgId: string): void {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM conversations WHERE org_id = ? AND external_id LIKE 'c:%' LIMIT 1").get(orgId)) return;
  const chans = channelsRepo.list(orgId);
  const items: Array<{ provider: "instagram" | "facebook"; media: string; user: string; name: string; text: string; hoursAgo: number }> = [
    { provider: "instagram", media: "demo-media-1", user: "demo-c1", name: "@ayse.mutfakta", text: "Tuzsuz çeşidi de var mı? 😍", hoursAgo: 2 },
    { provider: "instagram", media: "demo-media-1", user: "demo-c2", name: "@kuruyemis_sever", text: "Kargo İzmir'e kaç günde geliyor?", hoursAgo: 5 },
    { provider: "instagram", media: "demo-media-2", user: "demo-c3", name: "@fitbesin", text: "Granola tarifine bayıldım, gramajları paylaşır mısınız?", hoursAgo: 26 },
    { provider: "facebook", media: "100000000000001_200000000000002", user: "demo-c4", name: "Mehmet Y.", text: "Toptan fiyat için kimle görüşmeliyim?", hoursAgo: 9 },
  ];
  for (const [i, it] of items.entries()) {
    const ch = chans.find((c) => c.provider === it.provider);
    if (!ch) continue;
    const at = new Date(Date.now() - it.hoursAgo * 3600_000).toISOString();
    const rec = inboxRepo.recordInbound({
      orgId,
      channelId: ch.id,
      conversationExternalId: `c:${it.media}:${it.user}`,
      participantId: it.user,
      participantName: it.name,
      externalMessageId: `demo-comment-${i}`,
      text: it.text,
      receivedAt: at,
      metadata: { kind: "comment", mediaId: it.media, commentId: `demo-comment-${i}`, parentId: null },
    });
    if (rec) inboxRepo.flagAttention(rec.conversation.id, true);
  }
}

/** Reklamlar: kurgusal Meta reklam hesabı, 3 kampanya ve 120 günlük metrik (jeton sahte, çekim yapılmaz) */
function ensureDemoAds(orgId: string): void {
  if (adsRepo.list(orgId).length) return;
  const acc = adsRepo.upsert(orgId, { externalId: "act_1000000000000", name: "Leblebi Kuruyemiş Reklam (demo)", currency: "TRY", token: "demo-token", tokenExpiresAt: null });
  const r = rng(31);
  const campaigns = [
    { id: "demo-c1", name: "Yeni sezon fındık · Trafik", daily: 180, cpm: 38, ctr: 1.6, from: 40 },
    { id: "demo-c2", name: "Bayram kutuları · Satış", daily: 260, cpm: 52, ctr: 1.1, from: 25 },
    { id: "demo-c3", name: "Marka bilinirliği · Reels", daily: 120, cpm: 22, ctr: 0.7, from: 90 },
  ];
  for (let d = DAYS; d >= 0; d--) {
    const date = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    const total: Record<string, number> = { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, purchases: 0 };
    for (const c of campaigns) {
      if (d > c.from) continue;
      const spend = Math.round(c.daily * (0.75 + r() * 0.5) * 100) / 100;
      const impressions = Math.round((spend / c.cpm) * 1000);
      const clicks = Math.round(impressions * (c.ctr / 100) * (0.8 + r() * 0.4));
      const m = { spend, impressions, reach: Math.round(impressions * 0.62), clicks, linkClicks: Math.round(clicks * 0.8), ...(c.id === "demo-c2" ? { purchases: Math.round(clicks * 0.03) } : {}) };
      adsRepo.upsertDay(acc.id, date, c.id, c.name, m);
      for (const [k, v] of Object.entries(m)) total[k] = (total[k] ?? 0) + v;
    }
    total.spend = Math.round(total.spend * 100) / 100;
    if (total.impressions) adsRepo.upsertDay(acc.id, date, "", null, total);
  }
  adsRepo.markSynced(acc.id, null);
}

/**
 * Reklamlar (çok platform): kurgusal Google Ads ve TikTok Ads hesapları; tüm demo reklam hesaplarına
 * reklam seti / reklam grubu, reklam ve (Google) anahtar kelime satırları. Jetonlar sahte, çekim yapılmaz.
 */
function ensureDemoAdsMulti(orgId: string): void {
  const r = rng(47);
  type Camp = { id: string; name: string; daily: number; cpm: number; ctr: number; conv: number; groups: Array<{ id: string; name: string; share: number; ads: string[]; keywords?: Array<[string, string]> }> };
  const plans: Array<{ provider: "meta" | "google" | "tiktok"; externalId: string; name: string; currency: string; reach: boolean; camps: Camp[] }> = [
    {
      provider: "meta",
      externalId: "act_1000000000000",
      name: "Leblebi Kuruyemiş Reklam (demo)",
      currency: "TRY",
      reach: true,
      camps: [
        { id: "demo-c1", name: "Yeni sezon fındık · Trafik", daily: 0, cpm: 38, ctr: 1.6, conv: 0, groups: [{ id: "demo-s1", name: "Kadın 25-44 · İstanbul", share: 0.6, ads: ["Reel: kavurma atölyesi", "Görsel: yeni hasat"] }, { id: "demo-s2", name: "Benzer kitle %1", share: 0.4, ads: ["Carousel: çeşitler"] }] },
        { id: "demo-c2", name: "Bayram kutuları · Satış", daily: 0, cpm: 52, ctr: 1.1, conv: 0, groups: [{ id: "demo-s3", name: "Yeniden hedefleme 30 gün", share: 0.7, ads: ["Katalog: bayram kutuları"] }, { id: "demo-s4", name: "İlgi: kuruyemiş", share: 0.3, ads: ["Video: kutu açılışı"] }] },
        { id: "demo-c3", name: "Marka bilinirliği · Reels", daily: 0, cpm: 22, ctr: 0.7, conv: 0, groups: [{ id: "demo-s5", name: "Geniş kitle TR", share: 1, ads: ["Reel: çifte kavrulmuş", "Reel: tarif"] }] },
      ],
    },
    {
      provider: "google",
      externalId: "1234567890",
      name: "Leblebi Kuruyemiş Google (demo)",
      currency: "TRY",
      reach: false,
      camps: [
        {
          id: "demo-g1",
          name: "Arama · Leblebi",
          daily: 210,
          cpm: 95,
          ctr: 6.5,
          conv: 0.06,
          groups: [
            { id: "demo-ag1", name: "Leblebi satın al", share: 0.65, ads: ["Duyarlı arama reklamı 1", "Duyarlı arama reklamı 2"], keywords: [["leblebi satın al", "PHRASE"], ["çifte kavrulmuş leblebi", "EXACT"], ["toptan leblebi", "PHRASE"]] },
            { id: "demo-ag2", name: "Kuruyemiş online", share: 0.35, ads: ["Duyarlı arama reklamı 3"], keywords: [["online kuruyemiş", "BROAD"], ["taze fındık sipariş", "PHRASE"]] },
          ],
        },
        { id: "demo-g2", name: "Performance Max · Bayram", daily: 160, cpm: 24, ctr: 1.2, conv: 0.03, groups: [{ id: "demo-ag3", name: "Öğe grubu: bayram kutuları", share: 1, ads: ["Öğe grubu reklamı"] }] },
      ],
    },
    {
      provider: "tiktok",
      externalId: "7000000000001",
      name: "Leblebi Kuruyemiş TikTok (demo)",
      currency: "TRY",
      reach: true,
      camps: [
        { id: "demo-t1", name: "Spark · Kavurma videoları", daily: 140, cpm: 18, ctr: 0.9, conv: 0.02, groups: [{ id: "demo-tg1", name: "18-34 · Türkiye", share: 1, ads: ["Spark: sabah 6 kavurma", "Spark: paketleme"] }] },
        { id: "demo-t2", name: "Trafik · Web sitesi", daily: 90, cpm: 21, ctr: 1.3, conv: 0.04, groups: [{ id: "demo-tg2", name: "İlgi: yemek", share: 1, ads: ["Video: indirim kodu"] }] },
      ],
    },
  ];
  for (const plan of plans) {
    const existing = adsRepo.list(orgId).find((a) => a.provider === plan.provider && a.externalId === plan.externalId);
    if (existing && getDb().prepare("SELECT 1 FROM ad_entity_insights WHERE ad_account_id = ? LIMIT 1").get(existing.id)) continue;
    const acc = existing ?? adsRepo.upsert(orgId, { provider: plan.provider, externalId: plan.externalId, name: plan.name, currency: plan.currency, token: "demo-token", tokenExpiresAt: null });
    const ownTotals = plan.provider !== "meta";
    if (!ownTotals) {
      // İlk demo Meta satırlarında yalnız "purchases" vardı; gerçek ayrıştırıcı gibi dönüşüme de yaz
      getDb()
        .prepare("UPDATE ad_insights SET metrics = json_set(metrics, '$.conversions', json_extract(metrics, '$.purchases')) WHERE ad_account_id = ? AND json_extract(metrics, '$.purchases') IS NOT NULL AND json_extract(metrics, '$.conversions') IS NULL")
        .run(acc.id);
    }
    for (let d = DAYS; d >= 0; d--) {
      const date = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
      const total: Record<string, number> = {};
      for (const c of plan.camps) {
        // Meta kampanya satırları ensureDemoAds'ten gelir: grupları o günün kampanya harcamasına göre böl
        const campRow = plan.provider === "meta" ? adsRepo.rows(acc.id, date, date).find((x) => x.campaignId === c.id)?.metrics : null;
        if (plan.provider === "meta" && !campRow) continue;
        const spend = campRow?.spend ?? Math.round(c.daily * (0.75 + r() * 0.5) * 100) / 100;
        const impressions = campRow?.impressions ?? Math.round((spend / c.cpm) * 1000);
        const clicks = campRow?.clicks ?? Math.round(impressions * (c.ctr / 100) * (0.8 + r() * 0.4));
        const conversions = campRow ? (campRow.purchases ?? 0) : Math.round(clicks * c.conv * (0.6 + r() * 0.8));
        const m = (share: number): Record<string, number> => {
          const sp = Math.round(spend * share * 100) / 100;
          const im = Math.round(impressions * share);
          const cl = Math.round(clicks * share);
          return { spend: sp, impressions: im, clicks: cl, ...(plan.reach ? { reach: Math.round(im * 0.6) } : {}), ...(conversions ? { conversions: Math.round(conversions * share) } : {}) };
        };
        if (ownTotals) {
          adsRepo.upsertDay(acc.id, date, c.id, c.name, m(1));
          for (const [k, v] of Object.entries(m(1))) total[k] = Math.round(((total[k] ?? 0) + v) * 100) / 100;
        }
        for (const g of c.groups) {
          adsRepo.upsertEntity(acc.id, { date, level: "group", id: g.id, name: g.name, parentId: c.id, parentName: c.name, metrics: m(g.share) });
          g.ads.forEach((name, i) => {
            const share = g.share * (g.ads.length === 1 ? 1 : i === 0 ? 0.62 : 0.38 / (g.ads.length - 1));
            adsRepo.upsertEntity(acc.id, { date, level: "ad", id: `${g.id}-ad${i}`, name, parentId: g.id, parentName: g.name, metrics: m(share) });
          });
          (g.keywords ?? []).forEach(([text, matchType], i, all) => {
            const share = g.share * (i === 0 ? 0.5 : 0.5 / (all.length - 1));
            adsRepo.upsertEntity(acc.id, { date, level: "keyword", id: `${g.id}~kw${i}`, name: text, parentId: g.id, parentName: g.name, extra: { matchType }, metrics: m(share) });
          });
        }
      }
      if (ownTotals && total.impressions) adsRepo.upsertDay(acc.id, date, "", null, total);
    }
    adsRepo.markSynced(acc.id, null);
  }
}

/** Kütüphane: örnek gönderi şablonları ve hashtag grupları */
function ensureDemoLibrary(orgId: string): void {
  if (libraryRepo.list(orgId).length) return;
  libraryRepo.create(orgId, { type: "hashtags", name: "Marka", content: "#leblebi #kuruyemiş #yerelüretim #çorum" });
  libraryRepo.create(orgId, { type: "hashtags", name: "Tarif", content: "#tarif #sağlıklıatıştırmalık #evyapımı #granola" });
  libraryRepo.create(orgId, { type: "hashtags", name: "Kampanya", content: "#kampanya #indirim #haftasonu" });
  libraryRepo.create(orgId, { type: "post", name: "Haftalık kargo duyurusu", content: "Siparişleriniz cuma günü kargoda! 📦 Perşembe 23.59'a kadar verilen siparişler bu hafta yola çıkıyor." });
  libraryRepo.create(orgId, { type: "post", name: "Yeni ürün tanıtımı", kind: "reel", content: "Yeni sezon geldi: [ürün adı]. Kavurma atölyemizden taze çıktı, stoklar sınırlı. Link profilde 👆" });
  libraryRepo.create(orgId, { type: "post", name: "Müşteri yorumu", content: "\"[yorum]\" — [müşteri adı]\n\nSizden gelen her yorum bizi çok mutlu ediyor, teşekkürler! 💛" });
}

/** YouTube Analytics: kurgusal günlük izlenme, izlenme süresi, abone dengesi (son 2 gün gecikmeli) ve izleyici kitlesi */
function ensureDemoYoutube(orgId: string): void {
  const yt = channelsRepo.list(orgId).find((c) => c.provider === "youtube");
  if (!yt) return;
  const today = new Date().toISOString().slice(0, 10);
  if (insightsRepo.daysWithInsights(yt.id, new Date(Date.now() - DAYS * DAY).toISOString().slice(0, 10), today).size) return;
  const r = rng(59);
  for (let d = 75; d >= 3; d--) {
    const at = new Date(Date.now() - d * DAY);
    const views = Math.round((420 + (75 - d) * 4) * (0.7 + r() * 0.6) * (at.getUTCDay() === 0 ? 1.3 : 1));
    insightsRepo.mergeDay(yt.id, at.toISOString().slice(0, 10), {
      views,
      watchMinutes: Math.round(views * (1.6 + r() * 0.8)),
      follows: Math.round(6 * (0.5 + r())),
      unfollows: Math.round(1.5 * r()),
    });
  }
  insightsRepo.setAudience(yt.id, {
    basis: "viewers",
    percent: true,
    country: { TR: 8200, DE: 610, AZ: 240, NL: 180, US: 120 },
    age: { "13-17": 3.1, "18-24": 21.4, "25-34": 38.2, "35-44": 22.5, "45-54": 9.6, "55-64": 3.9, "65-": 1.3 },
    gender: { F: 46.8, M: 52.1, U: 1.1 },
  });
}

/** Hashtag takibi: kurgusal günlük hacim ve popüler gönderiler (gerçek hesap/gönderi değil) */
function ensureDemoHashtags(orgId: string): void {
  if (hashtagsRepo.list(orgId).length) return;
  const r = rng(71);
  const tags: Array<[string, number, number]> = [
    ["leblebi", 140, 85],
    ["kuruyemiş", 200, 140],
    ["çerez", 180, 60],
    ["sağlıklıatıştırmalık", 90, 210],
  ];
  const captions = ["Akşam çayının yanına", "Ofis atıştırmalığı hazır", "Yeni sezon ürünleri", "Ev yapımı karışım tarifi", "Hafta sonu sofrası", "Spor sonrası enerji"];
  for (const [tag, base, likes] of tags) {
    const t = hashtagsRepo.create(orgId, tag, `demo-${tag}`);
    for (let d = 60; d >= 0; d--) {
      const at = new Date(Date.now() - d * DAY);
      const weekend = at.getUTCDay() === 0 || at.getUTCDay() === 6 ? 1.25 : 1;
      const recent = Math.min(200, Math.round(base * weekend * (0.75 + r() * 0.5)));
      hashtagsRepo.upsertSnapshot(t.id, at.toISOString().slice(0, 10), {
        recentPosts: recent,
        recentCapped: recent >= 200 ? 1 : 0,
        avgLikes: Math.round(likes * (0.8 + r() * 0.4) * 10) / 10,
        avgComments: Math.round(likes * 0.06 * (0.8 + r() * 0.4) * 10) / 10,
      });
    }
    hashtagsRepo.saveTop(
      t.id,
      Array.from({ length: 6 }, (_, i) => ({
        id: `demo-${tag}-${i}`,
        caption: `${captions[(i + tag.length) % captions.length]} #${tag}`,
        likes: Math.round(likes * (3 - i * 0.35) * (0.8 + r() * 0.4)),
        comments: Math.round(likes * 0.2 * (0.6 + r())),
        type: i % 3 === 0 ? "VIDEO" : "IMAGE",
        permalink: null,
        timestamp: new Date(Date.now() - (i + 1) * 9 * 3600_000).toISOString(),
      })),
    );
  }
}
