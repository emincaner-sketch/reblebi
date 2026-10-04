# BRAND_DECISIONS.md: reblebi.com giriş sayfası

> Brief: `website-yeniden-tasarim-promptu_v9.md` · Kip: onaylı · Onay: 2026-10-03 ("kur", varsayılan cevaplarla)
> Kapsam: ana sayfa (`/`, `/en`), fiyat sayfası (`/fiyatlar`, `/en/pricing`), 404 ve (kullanıcı geri bildirimiyle) MCP rehberi, Gizlilik, Koşullar, Veri silme. Panel, giriş/kayıt, OAuth onay ekranı, API, DB şeması ve env değişkenleri değişmedi.
> İçerik sayfaları `PublicPages.tsx`'e dokunmadan taşındı: yalnızca kabukları (`landing/PublicShell.tsx`) yeni kabuğu kullanıyor.

## 0. Araştırma kaynağı

- reblebi.com canlıda repo'nun eski **SosyalPilot** derlemesini sunuyor: HTML'de boş `<div id="root">`, `<title>SosyalPilot`; `robots.txt` ve `sitemap.xml` bile aynı HTML kabuğunu döndürüyor. Sayfalar HTML'den **okunamadı**; tarayıcıda JS çalıştırılarak okundu: `/`, `/fiyatlar`, `/docs/mcp`, `/privacy`. `/terms`, `/data-deletion`, `/en` ayrıca okunmadı (repo kaynağı kullanıldı).
- Canlı `/api/public/config`: `signupMode: open`, `trialDays: 14`, `trialPlan: pro`, `supportEmail: ""`, `companyName: ""`, planlar repodaki `server/src/core/plans.ts` ile aynı.
- Kategori: Sosyal Köprü (sosyalkopru.com), Plexorin (plexorin.com/tr), Dijital Panelim (dijitalpanelim.com) ana sayfaları.

## 1. Marka bir cümlede

Reblebi, dokuz platformda bir kez yazıp planlatan, gelen mesajları tek kutuda toplayan ve AI asistanının paneli MCP ile yönetmesine izin veren Türkçe/İngilizce bir sosyal medya yönetim paneli.

## 2. Adın birebir yazımı

**Reblebi.** Ekler: Reblebi'ye, Reblebi'nin, Reblebi'yi. "SosyalPilot" sayfada geçmez. İşaret `src/components/Logo.tsx` (yuvarlak "r" + leblebi tanesi), yeniden çizilmedi; kelime metin olarak kalır.

## 3. Asıl kitle

Türkiye'de sosyal medyasını kendisi yöneten küçük işletme / e-ticaret sahibi, içerik üreticisi ve birden fazla müşteri yöneten küçük ajans. Karar veren: işletme sahibi ya da ajans kurucusu.

- Şüphe: "Şifremi verir miyim?", "Benim platformum var mı?", "Deneme bitince ücret kesilir mi?", "AI kafasına göre paylaşır mı?"
- İkna eden kanıt: resmî API ve OAuth, gerçek platform ikonları, kartsız deneme ve sonrasında Ücretsiz plana geçiş, onay modu.
- Terk ettiren: kart istemek, uzun kayıt. Kayıt zaten kartsız ve 4 alan (ad, e-posta, şifre, çalışma alanı).

## 4. Dönüşüm

- **Birincil:** `/signup` ile hesap açmak. Etiket veriden: `trialDays > 0` → "14 gün ücretsiz dene", değilse "Ücretsiz başla"; kayıt kapalıysa "Giriş yap" (`/login`); oturum açıksa "Panele git" (`/app`).
- **İkincil:** sayfa içi "Nasıl işliyor?" (imza bölümü), `/docs/mcp` rehberi, `/fiyatlar#compare`.
- Lead formu yok (bkz. §13).

## 5. Korunan gerçekler ve kaynakları

| Gerçek | Kaynak |
|---|---|
| 9 platform: Instagram, Facebook, Threads, WhatsApp, X, LinkedIn, TikTok, YouTube, Telegram | https://reblebi.com/ · `src/config/site.ts` (`CORE_PLATFORMS`) |
| Planla, yayınla, DM'leri otomatik yanıtla, performansı izle | https://reblebi.com/ |
| Birleşik gelen kutusu: Instagram DM, Messenger, WhatsApp, Telegram, X; kuralla oto-yanıt | https://reblebi.com/ · `server/src/services/dm-engine.ts` |
| AI içerik ve 2 haftalık takvim | https://reblebi.com/ |
| MCP: Claude, ChatGPT, Gemini, Grok, Cursor; tüm planlarda | https://reblebi.com/docs/mcp · `/api/public/config` (`features.mcp`) |
| MCP araç adları `find_free_slots`, `schedule_posts_batch`; deneme modu; onay modu | https://reblebi.com/docs/mcp · `server/src/mcp/tools.ts` |
| Ekip rolleri, onay akışı, müşteri önizleme linki | https://reblebi.com/ · `src/lib/i18n.tsx` (roller) |
| Resmî OAuth, şifre istenmez, token'lar AES-256-GCM | https://reblebi.com/ · https://reblebi.com/privacy · `server/src/core/crypto.ts` |
| Veri satılmaz, reklamda kullanılmaz; kanal kaldırılınca token ve konuşmalar silinir | https://reblebi.com/privacy |
| Fiyatlar (USD): Ücretsiz $0, Pro $19/ay ($190/yıl), Ajans $59/ay ($590/yıl) ve limitler | https://reblebi.com/ · `/api/public/config` · `server/src/core/plans.ts` |
| Her yeni hesap 14 gün Pro ile başlar | https://reblebi.com/ |
| Kredi kartı gerekmez; deneme sonunda Ücretsiz plan, veri silinmez | `src/landing/faq-data.ts` (repo; canlıda görünmüyor) |
| Platform karakter sınırları: X 280, Threads 500, Instagram 2.200, LinkedIn 3.000 | `server/src/providers/*` (`maxTextLength`), düzenleyicideki sayaç `src/pages/Composer.tsx` |
| "Sonraki boş saat" ile planlama | `src/pages/Composer.tsx` |

Fiyat, deneme süresi ve kayıt modu sayfaya elle yazılmaz; `usePublicConfig()` (ön-render'da `PUBLIC_SNAPSHOT`) üzerinden okunur.

## 6. Terk edilen mevcut site zaafları

- H1 kategori klişesi: "Sosyal medyanı tek panelden, AI ile yönet" (Sosyal Köprü: "Tüm Sosyal Medyanı Tek Panelden Yönet").
- Mor→camgöbeği gradient metin, koyu SaaS zemini, parlayan gölgeler.
- Altı eşit ikon kartı (bento): en güçlü fark (MCP) ve ürünün akışı aynı ağırlıkta kayboluyor.
- Ürün anlatılıyor, gösterilmiyor; "nasıl çalışır" üç numaralı kart.
- Plan önerisi iki yerde dağınık ("Kimler için" sekmeleri ve fiyat kartları).
- Canlıda: eski ad, JS olmadan boş sayfa, bozuk robots/sitemap, kanıtsız "Popüler" rozeti, harf kutusu platform simgeleri.

## 7. Benzememesi gereken klişeler

1. "Tüm sosyal medyanı tek panelden yönet" başlığı.
2. Koyu zemin + mor-mavi gradient + glow + cam efekti.
3. Kanıtsız sayaçlar ("5500+ mutlu müşteri"), yıldızlı yorum kartları, logo duvarı.
4. Üç kez tekrarlanan ikon kartı ızgarası.
5. Uçuşan 3D sosyal ikonlar, emoji yağmuru, sağ altta AI sohbet balonu.

## 8. Görsel yön: 5 sıfat

Sıcak · berrak · derli toplu · ölçülü muzip · güven veren.

## 9. Renk sistemi

| Token | Hex | Kullanım | Neden |
|---|---|---|---|
| `--color-canvas` | `#F6F2EA` | sayfa zemini | Leblebi/kâğıt sıcaklığında nötr; kategorinin koyu-mor zemininden ayrışır |
| `--color-ink` | `#1A1726` | metin | Morla akraba koyu mürekkep, saf siyah değil; zeminde ≈16:1 |
| `--color-primary` | `#5B49F2` | birincil CTA, bağlantı, odak halkası | Logo gradyanının koyu ucu; zeminde ≈5.1:1, beyaz yazıyla ≈5.7:1 (AA) |
| `--color-accent` | `#D9A441` | leblebi tanesi: ilerleme noktası, seçili öğe işareti | Logodaki tanenin sıcak karşılığı; metin olarak yalnızca koyu yüzeyde (≈8:1), açık zeminde yalnız dekor |
| `--color-surface-dark` | `#13111C` | imza bölümü, son çağrı | Panel varsayılan olarak koyu: koyu yüzey "panelin içindesin" demek |

Türetilen: `--color-muted #5E5970` (zeminde ≈6:1), `--color-subtle #E3DCCF` (çizgi), `--color-surface #FFFDF8` (kart), `--color-on-dark #F4F1EA`, `--color-on-dark-muted #B5AFC6` (koyu yüzeyde ≈8.8:1), `--color-dark-raised #201C2E`, `--color-ok #276B43` (yalnız ikon + metinle; açık yeşil rozette ≈5.4:1).
Platform renkleri yalnızca platform ikonlarında (Simple Icons). Logo dışında gradient yok. Sayfa genelinde koyu tema yok; koyu yüzey yalnız ürünü temsil ettiği yerde.

## 10. Tipografi

- **Display:** Bricolage Grotesque (variable `wght` 200–800, OFL). Kişilikli ama "araç" ciddiyetinde bir grotesk; yumuşak uçları logodaki yuvarlak "r" ile akraba, kategorinin nötr geometrik başlıklarından ayrışır. `public/fonts/bricolage-latin.woff2` (41 KB) + `bricolage-latin-ext.woff2` (19 KB, ğ Ğ İ ş Ş), fontsource 5.3.0'dan, `font-display: swap`, yalnızca yeni kabuklu sayfalarda önceden yüklenir.
- **Text:** Inter (mevcut, kendi sunucumuzda, TR alt kümesi ve preload hazır), yeni indirme yok.
- **Mono:** JetBrains Mono (zaten yüklü), yalnızca MCP araç adlarında.
- Gövde mobilde 17px, form 16px; satır ≤65ch; başlıklarda `text-wrap: balance` ve `overflow-wrap: break-word`.

## 11. Hareket fikri: scroll neyi ilerletiyor

**Scroll bir gönderiyi taslaktan yanıta taşır.** Logodaki leblebi tanesi ilerleyen işaretçidir.

0. Dokuz sekme, dokuz giriş (sorun) → 1. Bir kez yaz (hero'daki kart) → 2. Her kanala kendi sürümü (gerçek karakter sınırları) → 3. Boş saate yerleşir (haftalık takvim) → 4. Yanıtlar tek kutuda (gelen kutusu; plan notu veriden).

- Pin: mobil 180svh, tablet 200svh, masaüstü 220vh (≤300). Adım yalnızca scroll konumunun fonksiyonu → geri scroll'da ters.
- Yatay mobil (yükseklik <560px), `prefers-reduced-motion`, JS yok: pin yok; beş adım son halleriyle sıralı liste (sunucu HTML'inde).
- Hero girişi yalnız CSS; başlık ve CTA ilk karede görünür; kart girişi + kanal ışıkları ≤1.2 sn.
- Diğer bölümler: tek seferlik 12px yükselme; ekrandaki öğe hiç gizlenmez.

## 12. İnteraktif araç

**Plan bulucu** (3 adım: kimsin → kaç kanal → ekip kaç kişi). Fiyat kartlarında 3 plan × 14 satır var; ziyaretçinin asıl sorusu "bana hangisi?". Öneri yalnız gerçek limitlerden (`channels`, `members`, `features.inbox`, `features.customers`) hesaplanır; uydurma tasarruf yok. Sonuç ilgili kartı vurgular. Saf React state + CSS. `/signup` plan parametresi almadığı için seçim forma taşınıyormuş gibi gösterilmez.

## 13. Section haritası

| # | Bölüm | Durum | Düzen |
|---|---|---|---|
| 1 | Navigasyon | kuruldu | Masaüstü: logo · Nasıl işliyor · AI asistan · Fiyatlar · SSS · TR/EN · Giriş · CTA. Mobil: logo + menü (focus trap, Escape) + alt yapışkan CTA |
| 2 | Hero | kuruldu | Üst satır, H1, tek cümle, iki CTA, not, taslak kartı |
| 3 | Sorun | ayrı bölüm yok | İmzanın 0. adımı |
| 4–5, 7 | Teklif + Nasıl işler = **İmza** (`#how`) | kuruldu | Koyu yüzey, sticky sahne + 5 adım |
| 8 | AI asistan (`#ai`) | kuruldu | Açık zemin, sohbet dökümü (temsilî, gerçek araç adları) + 3 madde |
| 8 | Panelde ayrıca (`#features`) | kuruldu | Kartsız tanım listesi, plan etiketi veriden |
| 6 | Kanıt / Güven | kuruldu | Dar şerit: 9 platform ikonu + 4 doğrulanabilir madde |
| 9 | Plan bulucu + Fiyatlar (`#pricing`) | kuruldu | Sayfadaki tek kart ızgarası, aylık/yıllık |
| 10 | SSS (`#faq`) | kuruldu | `<details>`; metin `homeFaq`, JSON-LD FAQPage aynı kaynaktan |
| 11 | Son çağrı | kuruldu | Koyu yüzey, 3 başlangıç adımı + CTA |
| 12 | Mekân / ekip | kurulmadı | Sitede ekip veya mekân bilgisi yok |
| 13 | Sosyal | kurulmadı | Doğrulanmış hesap yok |
| — | Yorumlar, kullanım sayıları | kurulmadı | Veri yok |
| — | Lead formu + `POST /api/lead` | kurulmadı | Dönüşüm mevcut kayıt akışı; API ve DB korunuyor; alternatif iletişim kanalı yok (brief §06: o durumda form yayına alınmaz) |
| — | 404 | kuruldu | Yeni kabuk, marka dilinde |
| — | `/fiyatlar` | kuruldu | Yeni kabuk, plan bulucu, kartlar, karşılaştırma tablosu, fiyat SSS'i |
| — | MCP rehberi, Gizlilik, Koşullar, Veri silme | yeni kabuğa taşındı | Metin ve yapı aynı (`PublicPages.tsx` değişmedi); menü, footer ve açık tema ana sayfayla ortak |

## 14. Bilinmeyenler ve yer tutucular

Hepsi `src/site/data/site-content.ts` → `placeholders` içinde `placeholder: true` + `note` ile durur; hiçbiri ekrana gerçek bilgi gibi basılmaz.

| Anahtar | Durum |
|---|---|
| `supportEmail` | `SUPPORT_EMAIL` boş; footer'da "İletişim" yalnızca doluysa çıkar |
| `company` | `COMPANY_NAME` / `COMPANY_ADDRESS` boş; footer'da © Reblebi |
| `social` | Sitede hesap yok. Aramada instagram.com/reblebi, instagram.com/reblebi_, youtube.com/@Reblebi çıktı; sahiplik doğrulanmadı. Sosyal bölüm ve JSON-LD `sameAs` yok |
| `productScreenshot` | Gerçek panel ekran görüntüsü / tanıtım videosu yok; görseller kodla çizilmiş, "temsilî" etiketli arayüz. Ürün görseli AI ile üretilmez |
| `testimonials` | Kullanıcı yorumu, müşteri logosu, kullanım sayısı yok |
| `kvkk` | KVKK aydınlatma metni yok; yazılmadı, sayfa açılmadı |
| `localCurrency` | ₺ fiyat yok (ödeme USD) |
| `lighthouse` | Skorlar ölçülmedi |
| `deploy` | Canlı site eski derleme; yeni sayfa ancak deploy sonrası görünür |

## Stack farkı (brief §32 ↔ bu repo)

| Brief | Bu repo | Karar ve gerekçe |
|---|---|---|
| Next.js App Router | Vite 6 + React 19 + React Router 7, derleme anında SSR ön-render (`scripts/prerender.ts`) | Korundu. Panel ve auth aynı uygulamada; framework değişimi korunacakları bozar. Ön-render "ana metin server HTML'de" şartını karşılıyor |
| Tailwind | Yok; düz CSS + custom properties | Eklenmedi. Preflight panelin global stillerini bozar; `package.json` ve `vite.config.ts` paylaşımlı. Token'lar brief'teki adlarla `src/site/site.css` içinde (`--color-canvas`, `--color-ink`, `--color-primary`, `--color-accent`, `--color-focus`, `--font-display`, `--font-text`, `--radius-card`, `--spacing-section`, `--ease-brand`, `--dur-fast`, `--dur-base`) |
| GSAP + ScrollTrigger | Yok | Eklenmedi: `package.json` panelle paylaşımlı. Bağımlılıksız ilerleme motoru (`src/site/motion/useJourney.ts`): IntersectionObserver ile bölüm yaklaşınca passive scroll + rAF, `--p` ve `data-step`; pin `position: sticky`; kırılımlar `matchMedia`. İzin verilirse GSAP'e geçiş tek dosya |
| RHF + Zod + `/api/lead` | Form yok | Kurulmadı (§13) |
| `next/font` | `@font-face` + `unicode-range` + preload | Aynı yöntem; preload `seo/meta.ts` üzerinden yalnız yeni kabuklu sayfalarda |
| `next/image` | — | Raster görsel yok; ürün görselleri HTML/CSS, logo SVG |
| `metadata`, `sitemap.ts`, `robots.ts` | `seo/meta.ts`, `prerender.ts` (sitemap.xml), `public/robots.txt` | Korundu; ana sayfa metinleri, `theme-color` ve font preload güncellendi |
| `opengraph-image.tsx` (next/og) | `scripts/brand-assets.mjs` (satori + resvg, next/og'un motoru) | OG bölümü yeni görsel dille yeniden yazıldı; `public/og/og-home.png`, `og-en.png` yeniden üretildi |
| `not-found.tsx` | `src/landing/NotFoundPage.tsx` → `dist/404.html` (HTTP 404) | Yeni kabukla yeniden yazıldı |
| `app/`, `components/`, `data/`, `types/` | `src/site/` | İzole klasör; panel `src/components/` ile karışmaz |

## Kurulum notu

- Paket yöneticisi: **npm** (workspaces: `server`, `web`). Geliştirme: `npm run dev` (API :4500 + web :5500). Üretim: `npm run build` → `npm start`. `web/dist` yeniden derlenince sunucu yeniden başlatılmalı (statik yollar açılışta kaydedilir).
- Sürümler (değiştirilmedi): Vite 6.4, React 19, React Router 7, TypeScript 5.8, lucide-react 0.475. Tailwind, GSAP, Zod (web), React Hook Form **eklenmedi**.
- Yeni bağımlılık: **yok**. Yeni varlıklar: `public/fonts/bricolage-latin.woff2`, `bricolage-latin-ext.woff2`, `LICENSE-Bricolage.txt` (fontsource 5.3.0, OFL).
- Env: yeni değişken yok, `.env.example` değişmedi. `SUPPORT_EMAIL` doldurulursa footer'da "İletişim", `COMPANY_NAME` doldurulursa © satırında şirket adı çıkar.
- Kalıcı kayıt: form ve `/api/lead` yok; ziyaretçi verisi toplanmıyor. Dönüşüm mevcut `/signup` akışı.
- OG görselleri: `npm i --no-save satori @resvg/resvg-js @fontsource/inter @fontsource/bricolage-grotesque && node web/scripts/brand-assets.mjs` (bu çalışmada geçici klasörde üretildi; ikonlar birebir aynı çıktı, yalnızca `public/og/*.png` değişti).
- Dosya haritası: yeni sayfa `src/site/` (sayfalar `pages/`, bölümler `components/sections/`, menü/footer/yapışkan CTA `components/navigation/`, içerik `data/site-content.ts`, tipler `types/content.ts`, hareket `motion/`, stil `site.css`). `src/landing/LandingPage.tsx`, `PricingPage.tsx`, `NotFoundPage.tsx` yalnızca yeni sayfaları dışa aktarır (App.tsx değişmedi).
- Silinenler (yalnızca eski ana sayfa ve eski fiyat sayfası kullanıyordu): `src/landing/Hero.tsx`, `FeatureBento.tsx`, `McpShowcase.tsx`, `Sections.tsx`, `Pricing.tsx`, `Faq.tsx`. `PublicShell.tsx` artık `SiteShell`'i sarar. `landing.css` yalnızca içerik sayfalarının kurallarına ve giriş ekranının kullandığı `.rb-logo` kurallarına indirildi (eski nav/hero/bento/fiyat/footer kuralları silindi, CSS paketi 111 KB → 83 KB). `util.tsx` yalnızca `usePage` ve `useHydrated`'ı içerir. Bu dosyalar commit'li değildi.
- Yayın: reblebi.com şu an eski SosyalPilot derlemesini sunuyor; değişiklikler Railway deploy'u sonrası görünür.

## Denetim (2026-10-03)

| # | Madde | Durum | Nasıl doğrulandı |
|---|---|---|---|
| 1 | `build` ve tip kontrolü | geçti | `npm run build -w web` (snapshot + `tsc --noEmit` + vite + SSR + ön-render) ve kök `npm run typecheck` (server + web) hatasız; uzunluk/H1 uyarısı yok. `lint` betiği yok |
| 2 | 360 / 390 px yatay taşma | geçti | Headless Edge (CDP) 360×640, 360×740, 390×844, 768×1024, 1440×900: `scrollWidth = clientWidth`, taşan öğe 0 (TR, EN, fiyatlar, 404) |
| 3 | Hydration, `window`/`document` | geçti | Ön-render (renderToString) hatasız; `dist` önizlemede konsol hatası 0; tarayıcı API'leri yalnızca effect içinde |
| 4 | Form durumları, dürüst başarı | geçti (form yok) | Lead formu kurulmadı (§13); "kaydedildi/mail gitti" iddiası yok. Plan bulucu: e-ticaret → Pro, ajans → Ajans, sınır aşımı mesajı test edildi |
| 5 | Kırık görsel, gri kutu, CLS | geçti | Raster görsel yok; sahneler `aspect-ratio` ile; CLS 0 (PerformanceObserver, `dist`, 390 px) |
| 6 | Tab, `focus-visible`, Escape | geçti | Menü: odak kapat düğmesinde, Tab/Shift+Tab döngüsü menüde kalıyor, Escape kapatıp odağı menü düğmesine döndürüyor, `aria-expanded` doğru, kaydırma kilidi kalkıyor |
| 7 | Reduced motion, hero ilk kare | geçti | `prefers-reduced-motion: reduce` emülasyonunda canlı mod kapalı, 5 adım son halleriyle liste; hero girişi yalnız CSS; LCP öğesi H1 |
| 8 | Fiyat, yorum, müşteri, yasal metin | geçti | Fiyat ve limitler `/api/public/config`'ten; yorum/müşteri/sayı yok; yasal metinlere dokunulmadı |
| 9 | Boş dosya yok, ana metin server HTML'de | geçti | `dist/index.html` H1, beş adım metni, SSS ve JSON-LD içeriyor; elenen bölümler için dosya yok |
| 10 | Lighthouse | ölçülmedi | Çalıştırılmadı. Yerel ölçüm (kısıtlamasız, Lighthouse değil): LCP ≈ 1.0 sn, CLS 0 |
| 11 | Görsel kontrol | yapıldı, 3 tur | 360/390/768/1440 tam sayfa dilimleri + canlı imza adımları. Düzeltilenler: imza grid taşması, yapışkan CTA'nın sahneyi örtmesi, 360'ta sahne kesilmesi, masaüstü H1'in 4 satıra kırılması, EN "1 people", TR "planında" eki, yeşil rozet kontrastı (4.2 → 5.4), 404 rakam kontrastı, OG görselinde noktanın satır atlaması |
| + | Metin kontrastı (WCAG AA) | geçti | Tarayıcıda hesaplanan renk/zemin taraması: ana sayfa, fiyatlar, 404, MCP rehberi, Gizlilik, Koşullar, Veri silme'de 0 ihlal (dekoratif sahneler dahil) |
| + | İçerik sayfaları yeni kabukta | geçti | `/docs/mcp`, `/privacy`, `/en/terms`, `/data-deletion` 390 ve 1440 px'te: taşma 0, konsol hatası 0, `theme-color` açık; `/login` değişmedi (koyu, `.s-root` yok) |
