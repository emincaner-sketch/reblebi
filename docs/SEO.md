# SEO.md — reblebi.com (Reblebi)

> **Durum (2026-10-03):** Marka kararı verildi: **Seçenek B, ürün adı Reblebi.** §5 teknik maddeleri uygulandı:
> ön-render (`web/scripts/prerender.ts`), sayfa başına meta (`web/src/seo/meta.ts`), JSON-LD (`web/src/seo/jsonld.ts`),
> robots/sitemap/llms.txt, gerçek 404, noindex, `/en` sürümü, kendi sunucumuzdan fontlar, önceden sıkıştırma.
> Rota tablosu tek yerde: `web/src/seo/routes.ts`. Sunucu tarafı: `server/src/api/server.ts` (SPA_PATHS listesi App.tsx ile aynı tutulmalı).
> Açık kalanlar için §6 içerik planı ve §7 site dışı işler geçerli.

> Bu dosya projenin SEO kaynağıdır. Kodlama asistanı (Claude Code / Cursor) her SEO işinde bu dosyayı referans alır.
> Analiz tarihi: 3 Ekim 2026 — canlı site üzerinde yapılan incelemeye dayanır.

---

## 1. Mevcut durum (tespit edilenler)

| Konu | Durum | Önem |
|---|---|---|
| Teknoloji | Vite + React SPA (`/assets/index-*.js`, `#root`). İçerik tamamen JavaScript ile çiziliyor | Kritik |
| Ham HTML | Sadece `<title>SosyalPilot</title>` ve viewport var. Botlar JS çalıştırmazsa sayfa **boş** görünüyor | Kritik |
| Google'da indeks | `site:reblebi.com` sonuç vermiyor → site henüz indekslenmemiş | Kritik |
| `meta description` | Yok | Yüksek |
| Open Graph / Twitter kartı | Yok (0 og etiketi) → WhatsApp/X/LinkedIn paylaşımında önizleme çıkmıyor | Yüksek |
| `robots.txt` | Yok — istek atınca ana sayfanın HTML'i dönüyor (SPA catch-all) | Kritik |
| `sitemap.xml` | Yok — yine HTML dönüyor | Kritik |
| 404 | Var olmayan her URL **200** koduyla ana sayfayı döndürüyor (soft-404) | Yüksek |
| Tüm sayfaların başlığı | `/`, `/privacy`, `/terms`, `/docs/mcp` hepsi aynı title: "SosyalPilot" | Yüksek |
| Canonical | Yok | Orta |
| hreflang | TR/EN dil düğmesi var ama ayrı URL yok (`/en`), hreflang yok → EN sayfa indekslenemez | Orta |
| Yapısal veri (JSON-LD) | Yok | Orta |
| Favicon | SVG data-URI var; `apple-touch-icon`, manifest yok | Düşük |
| Görsel | Sayfada hiç görsel yok (0 img) → ürün ekran görüntüsü yok, görsel arama trafiği yok | Orta |
| Başlık hiyerarşisi | H1 doğru ve tek. Ama "Ücretsiz / Pro / Ajans" H2 olarak kullanılmış (H3 olmalı) | Düşük |
| Marka – alan adı uyumsuzluğu | Alan adı **reblebi**, ürün adı **SosyalPilot**. Google ve kullanıcı için kafa karıştırıcı | Stratejik |
| İçerik derinliği | Ana sayfa ~300 kelime. SSS, blog, karşılaştırma, platform sayfası yok | Yüksek |
| Fiyat para birimi | Sadece $ — Türk kullanıcı için ₺ karşılığı / "KDV dahil mi" bilgisi yok | Dönüşüm |

**Özet:** Ürün güçlü (9 platform, birleşik gelen kutusu, MCP ile Claude/ChatGPT entegrasyonu — rakiplerde nadir), ama site Google'a şu an neredeyse görünmez. İlk iş: **ön-render (prerender) + teknik temel**.

---

## 2. Marka kararı (önce bunu netleştir)

- Seçenek A: Ürün adı SosyalPilot kalır → ileride `sosyalpilot.com / .com.tr / .app` alınıp 301 ile taşınır. Şimdilik title ve şemada her ikisini birleştir: `SosyalPilot (reblebi.com)`.
- Seçenek B: Marka "Reblebi" olur → arayüzdeki tüm "SosyalPilot" metinleri değişir.
- Hangisi seçilirse seçilsin: logo, title, `og:site_name`, JSON-LD `name`, footer © — **hepsi aynı ad** olmalı.

> Aşağıdaki örneklerde marka adı `Reblebi` olarak yazıldı. Karar verince tek yerden değiştir.

---

## 3. Anahtar kelime haritası

### Ana sayfa (`/`)
- **Birincil:** sosyal medya yönetim paneli, sosyal medya yönetim aracı
- **İkincil:** instagram gönderi planlama, sosyal medya planlama aracı, toplu paylaşım, sosyal medya otomasyonu

### Özellik sayfaları (oluşturulacak)
| URL | Hedef kelime |
|---|---|
| `/ozellikler/gonderi-planlama` | instagram gönderi zamanlama, reels planlama, sosyal medya takvimi |
| `/ozellikler/birlesik-gelen-kutusu` | instagram dm otomatik yanıt, whatsapp otomatik mesaj, tek panelden dm |
| `/ozellikler/ai-icerik` | yapay zeka ile sosyal medya içeriği, ai gönderi metni oluşturma |
| `/ozellikler/ai-asistan-mcp` | claude ile instagram yönetimi, chatgpt sosyal medya paylaşımı, mcp sosyal medya |
| `/ozellikler/ajans` | sosyal medya ajansı yönetim paneli, müşteri onay akışı |
| `/fiyatlar` | sosyal medya yönetim aracı fiyat, ücretsiz sosyal medya planlama |

### Platform sayfaları (`/platform/...`)
instagram, facebook, threads, tiktok, x-twitter, linkedin, youtube, whatsapp, telegram → her biri "**{platform} gönderi planlama**" + "**{platform} otomatik yanıt**".

### Karşılaştırma sayfaları (yüksek satın alma niyeti)
`/karsilastirma/buffer-alternatifi`, `/hootsuite-alternatifi`, `/metricool-alternatifi`, `/later-alternatifi` → "türkçe buffer alternatifi", "ucuz hootsuite alternatifi".

### Rekabet avantajı (az rakipli niş)
"Claude / ChatGPT / Gemini / Grok ile sosyal medya yönetimi (MCP)" — Türkçe içerikte neredeyse hiç rakip yok. **En hızlı sıralama buradan gelir.**

---

## 4. Sayfa bazlı meta (kopyala-yapıştır)

| Sayfa | Title (≤60 karakter) | Description (≤155 karakter) |
|---|---|---|
| `/` | Sosyal Medya Yönetim Paneli – AI ile Planla \| Reblebi | Instagram, TikTok, Facebook ve 6 platformu tek panelden planla, DM'leri otomatik yanıtla. Claude ve ChatGPT bağlantısı. 14 gün ücretsiz dene. |
| `/fiyatlar` | Fiyatlar – Ücretsiz, Pro ve Ajans Planları \| Reblebi | Ücretsiz planla başla, Pro $19/ay, Ajans $59/ay. Her yeni hesap 14 gün Pro ile açılır. Kredi kartı gerekmez. |
| `/docs/mcp` | Claude ve ChatGPT ile Sosyal Medya Yönetimi (MCP) \| Reblebi | AI asistanını Reblebi'ye bağla; içerik takvimi kursun, gönderileri planlasın, gelen kutunu özetlesin. Adım adım MCP kurulumu. |
| `/privacy` | Gizlilik Politikası \| Reblebi | Reblebi'nin kişisel verileri nasıl işlediği, sakladığı ve koruduğu. KVKK ve GDPR uyumu. |
| `/terms` | Kullanım Koşulları \| Reblebi | Reblebi hizmet kullanım koşulları. |
| `/data-deletion` | Veri Silme Talebi \| Reblebi | Hesabını ve bağlı sosyal medya verilerini nasıl sileceğin. |
| `/en` | Social Media Management Tool with AI \| Reblebi | Plan, publish and auto-reply across 9 platforms from one dashboard. Connect Claude or ChatGPT via MCP. 14-day free trial. |

**Noindex olacaklar:** `/login`, `/signup`, `/app/*` (panel), `/reset-password`, önizleme linkleri.

> "Kredi kartı gerekmez" ifadesini sadece doğruysa kullan.

---

## 5. Teknik uygulama

### 5.1 Ön-render (en kritik adım)
SPA'yı bozmadan, herkese açık sayfaları build sırasında statik HTML'e çevir:
- Seçenek 1 (önerilen): `vite-plugin-prerender` / `vite-ssg` / `@prerenderer/rollup-plugin` ile `/`, `/en`, `/fiyatlar`, `/docs/mcp`, `/privacy`, `/terms`, `/data-deletion` + yeni içerik sayfaları prerender edilir.
- Seçenek 2: Landing ve blog'u **Astro** ile ayrı statik site yap, paneli `app.` alt alan adında bırak. (Uzun vadede en temizi.)
- Her sayfanın meta etiketleri için `react-helmet-async` (veya `@unhead/react`).
- Doğrulama: `curl -s https://reblebi.com/ | grep -i "<h1"` → H1 ham HTML'de görünmeli.

### 5.2 `index.html` `<head>` şablonu
```html
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sosyal Medya Yönetim Paneli – AI ile Planla | Reblebi</title>
  <meta name="description" content="Instagram, TikTok, Facebook ve 6 platformu tek panelden planla, DM'leri otomatik yanıtla. Claude ve ChatGPT bağlantısı. 14 gün ücretsiz dene." />
  <link rel="canonical" href="https://reblebi.com/" />
  <link rel="alternate" hreflang="tr" href="https://reblebi.com/" />
  <link rel="alternate" hreflang="en" href="https://reblebi.com/en" />
  <link rel="alternate" hreflang="x-default" href="https://reblebi.com/" />
  <meta name="theme-color" content="#0f1117" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Reblebi" />
  <meta property="og:locale" content="tr_TR" />
  <meta property="og:url" content="https://reblebi.com/" />
  <meta property="og:title" content="Sosyal medyanı tek panelden, AI ile yönet" />
  <meta property="og:description" content="9 platform, tek panel. Planla, yayınla, DM'leri otomatik yanıtla." />
  <meta property="og:image" content="https://reblebi.com/og/og-home.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />

  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="preload" href="/fonts/Inter-var.woff2" as="font" type="font/woff2" crossorigin />
</head>
```

### 5.3 `public/robots.txt`
```
User-agent: *
Allow: /
Disallow: /app/
Disallow: /login
Disallow: /signup
Disallow: /reset-password
Disallow: /preview/

Sitemap: https://reblebi.com/sitemap.xml
```
> Sunucu/hosting ayarında `robots.txt`, `sitemap.xml`, `llms.txt` için SPA rewrite'ı **atlanmalı** (gerçek dosya servis edilmeli, `content-type: text/plain` / `application/xml`).

### 5.4 `public/sitemap.xml`
Build sırasında otomatik üret (`vite-plugin-sitemap`). Minimum içerik: `/`, `/en`, `/fiyatlar`, `/docs/mcp`, `/privacy`, `/terms`, `/data-deletion` + tüm özellik/platform/blog sayfaları, her biri `<lastmod>` ve hreflang `xhtml:link` ile.

### 5.5 Gerçek 404
Bilinmeyen URL'ler **404 durum koduyla** özel bir 404 sayfası döndürmeli (Vercel: `404.html`; Netlify: `_redirects` sonunda `/* /404.html 404`; Nginx: `try_files` + `error_page`). React Router'da `*` rotası `<meta name="robots" content="noindex">` eklemeli.

### 5.6 Yapısal veri (JSON-LD) — ana sayfa
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://reblebi.com/#org",
      "name": "Reblebi",
      "url": "https://reblebi.com/",
      "logo": "https://reblebi.com/logo-512.png",
      "sameAs": ["https://instagram.com/...", "https://x.com/...", "https://linkedin.com/company/..."]
    },
    {
      "@type": "SoftwareApplication",
      "name": "Reblebi",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "inLanguage": ["tr", "en"],
      "publisher": { "@id": "https://reblebi.com/#org" },
      "offers": [
        { "@type": "Offer", "name": "Ücretsiz", "price": "0",  "priceCurrency": "USD" },
        { "@type": "Offer", "name": "Pro",      "price": "19", "priceCurrency": "USD" },
        { "@type": "Offer", "name": "Ajans",    "price": "59", "priceCurrency": "USD" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        { "@type": "Question", "name": "Hangi platformları destekliyorsunuz?",
          "acceptedAnswer": { "@type": "Answer", "text": "Instagram, Facebook, Threads, WhatsApp, X, LinkedIn, TikTok, YouTube ve Telegram." } },
        { "@type": "Question", "name": "Şifremi vermem gerekiyor mu?",
          "acceptedAnswer": { "@type": "Answer", "text": "Hayır. Her platformun resmî OAuth akışıyla bağlanırsın; token'lar şifreli saklanır." } }
      ]
    }
  ]
}
</script>
```
> `aggregateRating` **ekleme** — gerçek, doğrulanabilir yorumlar olmadan eklemek Google cezası sebebidir.

### 5.7 `public/llms.txt` (AI arama motorları için)
```
# Reblebi
> Türkçe/İngilizce sosyal medya yönetim paneli. 9 platformda planlama, birleşik gelen kutusu, AI içerik üretimi ve Claude/ChatGPT/Gemini/Grok için MCP bağlantısı.

- [Özellikler](https://reblebi.com/#features)
- [Fiyatlar](https://reblebi.com/fiyatlar)
- [MCP / AI bağlantısı dokümanı](https://reblebi.com/docs/mcp)
```

### 5.8 Performans (Core Web Vitals hedefi)
- LCP < 2.5 sn, CLS < 0.1, INP < 200 ms (mobilde).
- Inter fontunu self-host et, `font-display: swap`, sadece kullanılan ağırlıklar.
- Landing'i panel kodundan ayır (route-based code splitting) — ziyaretçi panel JS'ini indirmesin.
- Görseller: AVIF/WebP, `width/height` belirt, ekran görüntülerinde `loading="lazy"` (hero hariç).

---

## 6. İçerik planı (ilk 90 gün)

**Ay 1 – Temel:** Teknik düzeltmeler + `/fiyatlar` ayrı sayfa + SSS bölümü (8–10 soru) + 6 özellik sayfası.
**Ay 2 – Platform & karşılaştırma:** 9 platform sayfası + 4 "alternatif" sayfası.
**Ay 3 – Blog (haftada 2 yazı), örnek başlıklar:**
1. Instagram'da Paylaşım Yapmak İçin En İyi Saatler (2026, Türkiye verisiyle)
2. Claude ile Instagram Gönderisi Nasıl Planlanır? (MCP rehberi)
3. Instagram DM Otomatik Yanıt Nasıl Kurulur?
4. Sosyal Medya İçerik Takvimi Şablonu (ücretsiz indir)
5. Küçük İşletmeler İçin Sosyal Medya Yönetimi Rehberi
6. Ajanslar için Müşteri Onay Akışı Nasıl Kurulur?
7. Threads mi X mi? Türk Markaları İçin Karşılaştırma
8. WhatsApp Business Otomatik Mesaj Örnekleri

Her yazı: tek net H1, 1.200+ kelime, SSS bloğu, ilgili özellik sayfasına iç link, sonunda "14 gün ücretsiz dene" CTA.

---

## 7. Site dışı (off-page)
- Google Search Console + Bing Webmaster'a ekle, sitemap gönder, URL denetimi ile ana sayfayı indekslet.
- Google Business Profile (uygunsa), Product Hunt lansmanı, Türk girişim listeleri (Webrazzi, Startups.watch), AI araç dizinleri (There's An AI For That, Futurepedia), MCP dizinleri.
- YouTube'da kısa kurulum videoları (sende zaten kanal var) → açıklamada site linki.

---

## 8. Kontrol listesi (bitti mi?)
- [ ] Ham HTML'de H1 ve metin görünüyor (prerender)
- [ ] Her sayfa benzersiz title + description
- [ ] robots.txt ve sitemap.xml gerçek dosya olarak dönüyor
- [ ] Bilinmeyen URL → 404 kodu
- [ ] canonical + hreflang (tr/en/x-default)
- [ ] OG görseli 1200×630, paylaşım önizlemesi test edildi (opengraph.xyz)
- [ ] JSON-LD Rich Results Test'ten geçti
- [ ] /login, /signup, /app noindex
- [ ] Lighthouse mobil SEO = 100, Performance ≥ 90
- [ ] Search Console'da sitemap gönderildi
- [ ] Marka adı her yerde tutarlı
