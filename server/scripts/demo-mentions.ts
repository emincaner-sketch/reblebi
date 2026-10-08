import { getDb } from "../src/core/db.js";
import { listeningRepo, type ListenQuery, type ListenSource, type MentionInput, type Sentiment } from "../src/core/repos/listening.js";
import { lexiconSentiment } from "../src/services/sentiment.js";

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Bahsetme izleme demosu: marka ve bir rakip için kurgusal bahsetmeler (siteler .example, hesaplar "-demo";
 * gerçek kişi, marka ya da gönderi yok). Demo sunucusu LISTEN_OFFLINE ile gerçek kaynaklara istek atmaz.
 */
export function ensureDemoMentions(orgId: string): void {
  if (listeningRepo.list(orgId).length) return;
  const r = rng(97);
  const brand = listeningRepo.create(
    orgId,
    { name: "Leblebi Kuruyemiş", terms: ["Leblebi Kuruyemiş", "leblebikuruyemis"], excludes: ["tarif videosu"], sources: ["news", "reddit", "bluesky", "youtube", "web"], lang: "tr", notify: true, aiSentiment: false },
    null,
  );
  const rival = listeningRepo.create(orgId, { name: "Kavurucu (rakip)", terms: ["Kavurucu Kuruyemiş"], excludes: [], sources: ["news", "reddit", "bluesky", "web"], lang: "tr", notify: false, aiSentiment: false }, null);

  const pos = [
    "Leblebi Kuruyemiş'in sarı leblebisi efsane, kargo da çok hızlıydı",
    "Çorum'dan gelen paket bugün ulaştı, ürünler taze ve lezzetli",
    "Ofiste herkes Leblebi Kuruyemiş fındık karışımına bayıldı",
    "Tavsiye ederim, fiyat performans süper; paketleme de özenli",
    "Hediye kutusu harika olmuş, teşekkürler Leblebi Kuruyemiş",
  ];
  const neg = [
    "Leblebi Kuruyemiş siparişim 5 gündür gelmedi, müşteri hizmetleri cevap vermiyor",
    "Paket ezik geldi, iade süreci çok yavaş",
    "Bu sefer leblebiler bayat çıktı, hayal kırıklığı",
  ];
  const neu = [
    "Leblebi Kuruyemiş yeni şubesini Kadıköy'de açtı",
    "Çorum'da leblebi üreticileri yeni sezona hazırlanıyor; Leblebi Kuruyemiş de listede",
    "Yerel üreticiler e-ticarette büyüyor: Leblebi Kuruyemiş örneği",
    "Leblebi Kuruyemiş hafta sonu kargo saatlerini güncelledi",
    "Kuruyemiş sektöründe ihracat rakamları açıklandı, Leblebi Kuruyemiş de katılımcılar arasında",
    "Leblebi Kuruyemiş ile Kavurucu Kuruyemiş karşılaştırması: hangisi daha çıtır?",
  ];
  const sites: Record<ListenSource, string[]> = {
    news: ["haber-ornek.example", "corum-gazetesi.example", "ekonomi-haber.example", "yerel-haber.example"],
    reddit: ["r/atistirmalik_demo", "r/turkyemek_demo", "r/eticaret_demo"],
    bluesky: ["bsky.app"],
    hn: ["news.ycombinator.com"],
    youtube: ["youtube.com"],
    web: ["lezzet-blogu.example", "eticaret-rehberi.example", "kahvalti-notlari.example"],
  };
  const authors: Partial<Record<ListenSource, string[]>> = {
    reddit: ["u/cerez_sever_demo", "u/kahvalti_demo", "u/atistirmalikci_demo", "u/ofis_demo"],
    bluesky: ["@ayse-demo.bsky.social", "@mehmet-demo.bsky.social", "@lezzet-demo.bsky.social", "@cay-saati-demo.bsky.social"],
    youtube: ["Lezzet Durağı (demo)", "Atıştırmalık İnceleme (demo)", "Ev Sofrası (demo)"],
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const make = (q: ListenQuery, n: number, rename?: (s: string) => string) => {
    const items: Array<MentionInput & { sentiment: Sentiment }> = [];
    for (let i = 0; i < n; i++) {
      const roll = r();
      const source: ListenSource = roll < 0.3 ? "news" : roll < 0.5 ? "reddit" : roll < 0.75 ? "bluesky" : roll < 0.85 ? "youtube" : "web";
      const pool = source === "news" ? (r() < 0.8 ? neu : pos) : r() < 0.45 ? pos : r() < 0.55 ? neg : neu;
      const text = rename ? rename(pick(pool)) : pick(pool);
      const daysAgo = Math.pow(r(), 1.4) * 58;
      const site = pick(sites[source]);
      const author = authors[source] ? pick(authors[source]!) : null;
      const title = source === "bluesky" ? null : text;
      const snippet =
        source === "news" || source === "web" ? `${text}. Ayrıntılar haberin devamında (demo içerik).` : source === "reddit" ? "Deneyimlerinizi merak ediyorum, siz ne düşünüyorsunuz? (demo)" : text;
      items.push({
        source,
        externalId: `demo-${q.id}-${i}`,
        url: source === "news" || source === "web" ? `https://${site}/demo-${i}` : `https://example.com/demo/${source}/${i}`,
        title,
        snippet,
        author,
        site,
        lang: "tr",
        publishedAt: new Date(Date.now() - daysAgo * DAY - r() * 3_600_000).toISOString(),
        reach: source === "reddit" ? Math.round(5 + r() * 120) : null,
        engagement: source === "bluesky" ? Math.round(r() * 40) : source === "reddit" ? Math.round(r() * 25) : null,
        sentiment: lexiconSentiment([title, snippet].filter(Boolean).join(" ")),
      });
    }
    listeningRepo.insertMany(q, items);
  };
  make(brand, 160);
  make(rival, 70, (s) => s.replace(/Leblebi Kuruyemiş/g, "Kavurucu Kuruyemiş").replace("Kavurucu Kuruyemiş ile Kavurucu Kuruyemiş", "Kavurucu Kuruyemiş ile Leblebi Kuruyemiş"));

  const db = getDb();
  // Son bir buçuk günün bahsetmeleri yeni, gerisi görülmüş; olumsuzlardan ikisi yıldızlı, bir alakasız gizli
  db.prepare("UPDATE mentions SET status = 'seen', found_at = published_at WHERE org_id = ?").run(orgId);
  db.prepare("UPDATE mentions SET status = 'new' WHERE org_id = ? AND query_id = ? AND published_at >= ?").run(orgId, brand.id, new Date(Date.now() - 1.5 * DAY).toISOString());
  db.prepare("UPDATE mentions SET starred = 1 WHERE id IN (SELECT id FROM mentions WHERE query_id = ? AND sentiment = 'negative' ORDER BY published_at DESC LIMIT 2)").run(brand.id);
  db.prepare("UPDATE mentions SET status = 'hidden' WHERE id IN (SELECT id FROM mentions WHERE query_id = ? AND source = 'web' ORDER BY published_at LIMIT 1)").run(brand.id);
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  listeningRepo.saveState(
    brand.id,
    { news: { lastRun: ago(12), error: null, added: 2 }, reddit: { lastRun: ago(14), error: null, added: 1 }, bluesky: { lastRun: ago(14), error: null, added: 3 }, youtube: { lastRun: ago(130), error: null, added: 0 }, web: { lastRun: ago(300), error: null, added: 1 } },
    ago(12),
  );
  listeningRepo.saveState(rival.id, { news: { lastRun: ago(40), error: null }, reddit: { lastRun: ago(40), error: null }, bluesky: { lastRun: ago(40), error: null }, web: { lastRun: ago(400), error: null } }, ago(40));
}
