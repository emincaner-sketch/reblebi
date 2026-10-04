# 05 · Yol haritası: Metricool seviyesine giden adımlar

> Büyüklük: **S** (≤1 gün) · **M** (2–4 gün) · **L** (1–2 hafta). Tahmindir; platform onay süreleri (Meta App Review, TikTok audit) dahil değildir.
> Bağımlılık sütunu, işe başlamadan önce gereken şeyi gösterir.

## F1 · İlk tur (2026-10-03)

| İş | Dosyalar |
|---|---|
| Analitik raporu uç noktası (dönem, karşılaştırma, günlük seriler, ağ dağılımı, içerik türü, hashtag, gün × saat, gönderi listesi) | `server/src/services/analytics-report.ts`, `server/src/api/routes/settings.ts` |
| Grafik kiti (bağımlılıksız SVG) | `web/src/panel/charts/*` |
| Yeni analitik sayfası (Özet + ağ görünümü, CSV, yazdır/PDF) | `web/src/pages/Analytics.tsx`, `web/src/panel/analytics/types.ts`, `web/src/panel/charts/charts.css` |
| Panel teması (açık varsayılan, koyu seçenek) ve yeni kabuk (üst çubuk + bağlamsal menü + mobil çekmece) | `web/src/styles.css` (token'lar), `web/src/components/Shell.tsx`, `web/src/panel/shell.css`, `web/src/main.tsx` |
| Dar ekran güvenlikleri (360px'te sayfa taşması yok; tablolar, sekmeler, takvim kendi içinde kayar) | `web/src/panel/shell.css` |
| Giriş / kayıt / şifre / davet / onay ekranları + şifre göster/gizle | `web/src/pages/public/AuthPages.tsx`, `web/src/panel/auth.css` |
| Rapor testleri | `server/test/analytics-report.test.ts` |
| Demo verisiyle yerel önizleme (ayrı veri klasörü, zamanlayıcı kapalı) | `server/scripts/demo-seed.ts`, `server/scripts/demo-api.ts`, `.claude/launch.json` (`demo-api`, `demo-web`) |

## F2–F4 · İkinci tur (2026-10-03)

| İş | Panelde | Dosyalar | Test |
|---|---|---|---|
| Takvimde "en iyi saatler" ısı katmanı | Planlama > Takvim > Hafta | `pages/Posts.tsx`, `GET /api/analytics/best-times` | `analytics-report.test.ts` |
| Düzenleyicide mobil / masaüstü önizleme, karakter sınırı uyarısı | Yeni gönderi | `pages/Composer.tsx`, `panel/shell.css` | |
| Kampanya panosu + analitikte kampanya süzgeci | Kampanya detayı, Analitik `?campaign=` | `panel/analytics/CampaignPerformance.tsx`, `analytics-report.ts` (`campaignId`) | `analytics-report.test.ts` |
| Silinen gönderiler: 30 gün çöp kutusu, geri al, kalıcı sil (kampanya silinirken de) | Planlama > Silinenler | `core/repos/trash.ts`, `services/posts.ts`, `pages/Trash.tsx`; migration 5 | `trash.test.ts` |
| Link in bio (SmartLinks): `/l/<adres>`, düğmeler, sosyal ikonlar, tıklanabilir gönderi ızgarası, tema, canlı önizleme; görüntülenme / tıklama / kaynak (çerezsiz, günlük toplam) | Planlama > Link in bio | `services/bio.ts`, `api/routes/bio.ts`, `pages/Bio.tsx`, `panel/bio/*`; migration 6 | `bio.test.ts` |
| Markalı rapor (logo, renk, bölümler, giriş notu, otomatik "öne çıkanlar") A4 yazdır/PDF; haftalık/aylık e-posta özeti | Analitik > Rapor | `pages/Report.tsx`, `panel/analytics/report.css`, `services/report-email.ts` | `report-email.test.ts` |
| Instagram/Facebook hesap insights: erişim, görüntülenme, profil ziyareti, web sitesi tıklaması, takip/takipten çıkma; kitle (ülke, şehir, yaş, cinsiyet); gönderide kaydetme, reel izlenme süresi, hikâye metrikleri | Analitik > (ağ) > Hesap insights | `providers/meta/{common,instagram,facebook}.ts`, `services/insights.ts`, `core/repos/insights.ts`, `panel/analytics/InsightsSection.tsx`, `panel/charts/BalanceChart.tsx`; migration 7 | `insights.test.ts` |
| Rakip takibi (Instagram Business Discovery, günlük anlık görüntü, kendi hesapla karşılaştırma, öne çıkan gönderiler) | Analitik > Rakipler | `services/competitors.ts`, `api/routes/competitors.ts`, `pages/Competitors.tsx`; migration 8 | `competitors.test.ts` |
| Google ile giriş / kayıt (PKCE, doğrulanmış e-posta; kayıt modu aynen uygulanır) | Giriş ve kayıt ekranı | `services/google-login.ts`, `api/routes/auth-google.ts`, `pages/public/AuthPages.tsx` | `google-login.test.ts` |
| Gelen kutusunda Instagram ve Facebook yorumları (ayrı konu, "Yorumlar" süzgeci, herkese açık yanıt; otomatik yanıt verilmez) | Gelen Kutusu | `providers/meta/webhook.ts`, `services/dm-engine.ts`, `pages/InboxPage.tsx` | `inbox-comments.test.ts` |
| Meta reklam metrikleri (salt okunur): harcama, gösterim, erişim, tıklama, CTR, CPC, CPM, satın alma / potansiyel müşteri / sohbet; kampanyalar | Analitik > Reklamlar | `services/ads.ts`, `api/routes/ads.ts`, `pages/Ads.tsx`; migration 9 | `ads.test.ts` |

Ortak: veritabanı değişiklikleri yalnızca **eklemeli** (yeni tablolar: `deleted_posts`, `bio_pages`, `bio_events`, `channel_audience`, `competitors`, `competitor_snapshots`, `ad_accounts`, `ad_insights`; mevcut tablolarda sütun silme/değiştirme yok). Günlük hesap insights mevcut `analytics_snapshots.metrics` JSON'una `ins_*` anahtarlarıyla yazılır. Rapor ayarları mevcut `org_settings` JSON'unda. Tüm yeni metinlerin İngilizcesi `web/src/lib/en.ts`'te.

Doğrulama (2026-10-03): sunucu testleri 90/90, iki tarafta tip denetimi temiz, web derlemesi + ön-render tamam, yeni ekranlarda 390px'te sayfa taşması yok, açık ve koyu temada kontrast ihlali yok.

## Üçüncü tur: Metricool ile fark kapatma (2026-10-04)

| İş | Panelde | Dosyalar | Test |
|---|---|---|---|
| Reklamlar çok platformlu: Meta + **Google Ads** (API v25, yönetici/MCC hesapları dahil) + **TikTok Ads** (Business API v1.3); Kampanyalar · Reklam setleri/grupları · Reklamlar · Anahtar kelimeler (Google); dönüşüm ve dönüşüm başı maliyet; sütun seçici + CSV | Analitik > Reklamlar | `services/ads-providers.ts`, `services/ads.ts`, `core/repos/ads.ts`, `pages/Ads.tsx`; migration 10 | `ads.test.ts` |
| Gönderi kütüphanesi: şablonlar (metin + medya + tür) ve hashtag grupları; düzenleyicide ekle / kaydet / şablonla başla | Planlama > Kütüphane, Yeni gönderi | `api/routes/library.ts`, `core/repos/library.ts`, `pages/Library.tsx`, `pages/Composer.tsx`; migration 11 | `library.test.ts` |
| Facebook ile giriş / kayıt (Google akışıyla ortak hesap mantığı) | Giriş, kayıt | `services/facebook-login.ts`, `services/google-login.ts` (`loginOrSignupVerified`), `api/routes/auth-google.ts` | `google-login.test.ts` |
| YouTube Analytics: izlenme, izlenme süresi, abone kazanımı/kaybı, izleyici kitlesi (ülke, yaş, cinsiyet yüzdesi) | Analitik > YouTube > Hesap insights | `providers/youtube.ts` (`yt-analytics.readonly`) | `insights.test.ts` |
| LinkedIn şirket sayfası insights: gösterim, tekil erişim, içerik tıklaması, sayfa ziyareti, yeni takipçi; **LinkedIn API sürümü 202506 → 202609** (202506 artık desteklenmiyor) | Analitik > LinkedIn | `providers/linkedin.ts` | `insights.test.ts` |
| Hashtag takibi (Instagram): son 24 saat hacmi, popüler gönderilerin ort. beğeni/yorumu, günlük seri, öne çıkan gönderiler | Analitik > Hashtag takibi | `services/hashtag-tracker.ts`, `api/routes/hashtags.ts`, `pages/Hashtags.tsx`; migration 12 | `hashtags.test.ts` |
| PowerPoint rapor (.pptx, PowerPoint'te düzenlenebilir grafikler, marka rengi + logo) | Analitik > Rapor > PowerPoint | `panel/analytics/pptx.ts` (pptxgenjs, tıklanınca yüklenir) | demoda üretilip içerik doğrulandı |
| Günlük dışa aktarma (kanal × gün, JSON/CSV) + Looker Studio bağlayıcısı | Analitik > Rapor > Dışa aktar | `services/export.ts`, `api/routes/export.ts`, `integrations/looker-studio/` | `export.test.ts` |

Doğrulama (2026-10-04): sunucu testleri 103/103, iki tarafta tip denetimi temiz, web derlemesi + ön-render tamam, yeni ekranlarda 390px'te sayfa taşması yok, açık ve koyu temada kontrast ihlali yok.

## Dördüncü tur: Metricool'un kalan özellikleri (2026-10-04)

| İş | Panelde | Dosyalar | Test |
|---|---|---|---|
| Yeni ağ analitiği: Bluesky (herkese açık API), Pinterest (hesap + günlük analitik), Twitch (takipçi, video izlenmesi), Google İşletme Profili (Haritalar/Arama görüntülenmesi, web tıklaması, arama, yol tarifi; OAuth ile konum bağlama) | Analitik > ağ sayfaları, Hesap insights | `providers/bluesky.ts`, `pinterest.ts`, `twitch.ts`, `gmb.ts` | `providers-more.test.ts` |
| Gelen kutusu: YouTube yorumları (10 dk yoklama) ve Google işletme değerlendirmeleri (30 dk yoklama, yıldız rozeti, Google'da yanıt) | Gelen kutusu > Yorumlar | `providers/youtube.ts`, `providers/gmb.ts`, `services/dm-engine.ts`, `pages/InboxPage.tsx` | `providers-more.test.ts` |
| Rakip takibi: YouTube ve Bluesky (ağ sekmeleri, abone/izlenme ortalamaları, öne çıkan videolar) | Analitik > Rakipler | `services/competitors.ts`, `providers/youtube.ts` (`youtubePublicChannel`), `pages/Competitors.tsx` | `competitors.test.ts` |
| Studio: sürükle-bırak özel panolar (11 kart türü, kart başına ağ/kanal, boyut, otomatik kaydetme) | Analitik > Studio | `api/routes/dashboards.ts`, `core/repos/dashboards.ts`, `pages/Studio.tsx`; migration 13 | `dashboards.test.ts` |
| Reklam yönetimi: kampanya duraklat/başlat (Meta, Google, TikTok), Meta gönderi öne çıkarma (duraklatılmış oluşturulur), Google Ads önerileri (uygula/yoksay) | Analitik > Reklamlar | `services/ads.ts`, `services/ads-providers.ts`, `panel/ads/AdsManage.tsx` | `ads-manage.test.ts` |
| Otomatik listeler (evergreen kuyruk, haftalık saatler, döngü, kütüphaneden içe aktarma) | Planlama > Otomatik listeler | `services/autolists.ts`, `core/repos/autolists.ts`, `api/routes/autolists.ts`, `pages/Autolists.tsx`; migration 14 | `autolists.test.ts` |
| CSV ile toplu gönderi (şablon, doğrulama, satır satır hata, kampanyada toplama, medya bağlantısı) | Planlama > Toplu yükleme | `lib/csv-import.ts`, `pages/BulkImport.tsx` (mevcut `POST /api/posts/bulk`) | ayrıştırıcı kontrolleri + demoda uçtan uca |
| Web sitesi analitiği (çerezsiz izleme kodu, sosyal ağ trafiği, UTM, sayfalar, kaynaklar, cihaz) | Analitik > Web sitesi | `services/site-analytics.ts`, `api/routes/website.ts`, `pages/Website.tsx`; migration 15 | `site-analytics.test.ts` |
| Yüklenebilir uygulama (PWA): servis çalışanı, çevrimdışı sayfası, kısayollar, "Uygulamayı yükle" | Hesap menüsü | `public/sw.js`, `public/offline.html`, `public/site.webmanifest`, `lib/pwa.ts` | derlemede doğrulandı |

Ayrıca: `ads.test.ts` bağlantı sonrası arka plan senkronu bitmeden gerçek `fetch`'i geri yüklüyordu (sahte jetonla Meta/Google/TikTok'a gerçek istek gidiyordu); düzeltildi, test çıktısında dış istek kalmadı.

Doğrulama (2026-10-04): sunucu testleri 125/125, iki tarafta tip denetimi temiz, web derlemesi + ön-render tamam, yeni ekranlarda 390px'te sayfa taşması yok (sekme çubukları kendi içinde kayar), açık ve koyu temada kontrast ihlali yok, i18n'de bu turdan eksik İngilizce metin yok.

## Beşinci tur: kalan farklar (2026-10-04)

| İş | Panelde | Dosyalar | Test |
|---|---|---|---|
| Twitch paylaşımı gerçek: sahte "başarılı" dönüş kaldırıldı; paylaşım kanal sohbetine mesaj olarak gider (Helix Send Chat Message, `user:write:chat`), reddedilen mesaj hata olur; bağlanırken jeton doğrulanır | Yeni gönderi > Twitch | `providers/twitch.ts` | `providers-more.test.ts` |
| Threads hesap insights: günlük görüntülenme, bağlantı tıklaması, takipçi kitlesi | Analitik > Threads | `providers/meta/threads.ts` | `providers-more.test.ts` |
| Rakip takibi: Facebook Sayfaları ve Twitch kanalları (Studio rakip kartı dahil) | Analitik > Rakipler | `services/competitors.ts`, `providers/meta/facebook.ts` (`facebookPagePublic`), `providers/twitch.ts` (`twitchPublicChannel`) | `competitors.test.ts` |
| Instagram ızgara planlayıcı (canlı akış + planlananlar, saat değiştirme) | Planlama > Instagram ızgarası | `pages/FeedGrid.tsx`, `api/routes/feed.ts` | `feed.test.ts` |
| Google Drive / Dropbox paylaşım bağlantısından medya | Medya, Toplu yükleme | `services/media.ts` | `media-links.test.ts` |

Doğrulama (2026-10-04): sunucu testleri 130/130 (test çıktısında dış istek yok), iki tarafta tip denetimi temiz, web derlemesi + ön-render tamam, yeni ekranlarda 390px'te taşma yok, iki temada kontrast ihlali yok.

## Altıncı tur: canlı kontrol ve kalan işler (2026-10-04)

Canlı kontrol (reblebi.com, yeni sürüm yayında): sağlık, yapılandırma, izleme kodu, manifest, servis çalışanı, robots, sitemap ve panel adresleri doğru; bilinmeyen adres 404. **Bulunan hata:** `/offline.html` 404 dönüyordu (sunucu `.html` dosyalarına doğrudan erişimi kapatıyor), bu yüzden servis çalışanı kurulamıyor ve "Uygulamayı yükle" çalışmıyordu. Düzeltildi; bir sonraki `railway up` ile canlıya geçer.

| İş | Panelde | Dosyalar | Test |
|---|---|---|---|
| `/offline.html` izni + servis çalışanı kurulumu tek dosya alınamazsa bozulmaz | — | `api/server.ts`, `public/sw.js` | yerelde üretim derlemesiyle doğrulandı |
| Sahte başarı temizliği: 12 sağlayıcıda "jeton mock/test ise başarılı say" dalları kaldırıldı; API'ye bağlı olmayan 5 ağ (Dribbble, Kick, Lemmy, Nostr, Warpcast) bağlantıda kapalı, paylaşım açık hata verir | Kanallar | `providers/*.ts` | `providers-more.test.ts` |
| Studio: PDF / Yazdır ve zamanlı e-posta (haftalık/aylık, alıcılar, test e-postası, marka renk/logo) | Analitik > Studio | `services/dashboard-email.ts`, `api/routes/dashboards.ts`; migration 16 | `dashboards.test.ts` |
| Anlık bildirim (Web Push, ek paket yok: VAPID + aes128gcm, RFC 8291 örnek vektörüyle doğrulandı); zil bildirimleri abone cihazlara; cihaz başına aç/kapat; iptal edilen abonelik silinir | Hesap menüsü | `services/webpush.ts`, `api/routes/push.ts`, `public/sw.js`, `lib/pwa.ts`; migration 17 | `webpush.test.ts` |

| Meta'da sıfırdan reklam: hedef (trafik/bilinirlik), Sayfa, Facebook/Instagram yerleşimi, kütüphaneden görsel, metin/başlık/bağlantı/düğme, bütçe, süre, ülke, yaş; canlı önizleme; her şey duraklatılmış | Analitik > Reklamlar > Yeni reklam | `services/ads-providers.ts` (`metaCreateAd`), `services/ads.ts` (`createMetaAd`), `panel/ads/CreateAdDialog.tsx` | `ads-manage.test.ts` |
| Platform onay başvuruları için hazır metinler (izin izin İngilizce açıklama + çekilecek video sahnesi) | — | `docs/BASVURULAR.md` | — |

Yayın (2026-10-04 16:38): commit `397cc8a` (`panel-metricool` dalı) `railway up` ile canlıya alındı; migration 16–17 uygulandı; canlıda servis çalışanı aktif, `/offline.html` önbellekte.

Doğrulama: sunucu testleri 136/136 (dış istek yok), tip denetimi temiz, web derlemesi + ön-render tamam.

## Yedinci tur: tüm site ekran görüntüsü ve tuş taraması (2026-10-04)

Headless Edge ile 12 herkese açık sayfa (canlı) ve 29 panel sayfası (yerel üretim derlemesi, demo verisi) masaüstü + mobilde çekildi; panelde 320 tuş tek tek tıklandı (yıkıcı onay pencereleri iptal edildi). Konsol hatası, kırık iç bağlantı ya da 5xx yok. Herkese açık SEO tam: başlık/açıklama uzunlukları, canonical, hreflang (tr/en/x-default), OG/Twitter görseli, JSON-LD, tek H1, alt metin, robots/sitemap, 301 yönlendirmeleri, Brotli, uzun önbellek.

| Bulgu | Düzeltme | Dosyalar |
|---|---|---|
| İngilizce tarayıcıda Türkçe 404 İngilizceye dönüyor, React hidrasyon hatası (#418) | Bilinmeyen adres Türkçe kalır; `/en/...` İngilizce | `seo/routes.ts` |
| "Kopyala" tuşları izin yoksa yakalanmamış hata | Ortak `copyText` (eski yönteme düşer, hata vermez), 9 yer | `lib/clipboard.ts` |
| Giriş/kayıt ve panel sekme başlıkları hep aynı | Sayfa başına `document.title` | `AuthPages.tsx`, `components/ui.tsx` |
| Mobil takvim yatay kayıyordu | Sıkışık ay ızgarası (durum noktaları) + seçili günün listesi | `pages/Posts.tsx`, `styles.css` |
| Panel listeleri ve tablolar mobilde sağdan taşıyor, işlem tuşları (Geri al, Onayla) görünmüyor | Izgara satırları; `table-stack` dar ekranda satırları alt alta dizer | `Dashboard.tsx`, `Posts.tsx`, `Trash.tsx`, `Team.tsx` |
| Otomasyon: sekme ikonları hizasız, boş durum tuşları sola kaymış ve ikonları dev | Ortak `Stat` kartları, kayan sekmeler, boş durum ikonu yalnızca kendi ikonu | `Automation.tsx`, `components/ui.tsx`, `styles.css` |
| Google Business analitiğinde anlamsız boş "Takipçi" bölümü | GMB'de topluluk bölümü yok, işletme insights'ı önde | `pages/Analytics.tsx` |
| Looker Studio açıklaması müşteriye "depodaki dosya"yı gösteriyordu | Bağlayıcı dosyaları panelden indirilir | `pages/Report.tsx`, `public/integrations/looker-studio/` |
| Panelde olmayan adres sessizce ana sayfaya atıyordu | "Sayfa bulunamadı" + Panele dön | `AppArea.tsx` |
| 27 eksik İngilizce çeviri (Shopify kurulumu, otomasyon) | Tamamlandı; eksik 0 | `lib/en.ts` |

Bilinçli bırakılanlar: haftalık takvim, saat × gün ısı haritası ve A4 rapor önizlemesi telefonda yatay kayar (içerik genişliği sabit). Demo ortamında Google Ads "Öneriler" sahte jetonla 400 verir (gerçek hesapta Google'dan çekilir).

## Canlıya alma: platform ayarları

Kod hazır; aşağıdakiler yapılmadan ilgili özellik canlıda veri getirmez (hata vermez, ekran açıklama gösterir).

**Google ile giriş**
- Google Cloud Console > OAuth istemcisi (zaten `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) > Yetkili yönlendirme URI'si: `https://reblebi.com/api/auth/google/callback` (`APP_URL` + `/api/auth/google/callback`).
- OAuth izin ekranında kapsamlar: `openid`, `email`, `profile`. İki değişken tanımlıysa düğme kendiliğinden görünür.

**Meta (Instagram / Facebook) insights, yorumlar, rakipler**
- Uygulama izinleri (bağlantıda zaten isteniyor): `instagram_manage_insights`, `read_insights`, `instagram_manage_comments`, `pages_manage_engagement`, `pages_read_engagement`. Canlı kullanıcılar için App Review'da onaylı olmalı.
- Webhooks: Instagram nesnesinde `comments`, Page nesnesinde `feed` alanlarına abone ol (DM için kullanılan geri çağrı adresi aynı: `/webhooks/meta`). Sayfaların uygulamaya abone olduğundan emin ol (`/{page-id}/subscribed_apps`).
- Rakip takibi, bağlı Instagram işletme hesabının jetonuyla Business Discovery kullanır; App Review'da bu kullanım da anlatılmalı.
- Kitle kırılımı Instagram'da en az 100 takipçi ister; ilk insights kanal bağlandıktan sonraki gün görünür.

**Meta reklam metrikleri**
- Uygulamaya `ads_read` izni ekle (App Review). Bu bağlantı ayrıdır; sayfa/Instagram izinlerini değiştirmez.
- Facebook Login ayarları > Geçerli OAuth yönlendirme URI'leri: `https://reblebi.com/api/ads/meta/callback`.

**Facebook ile giriş**
- Kanal bağlamada kullanılan Meta uygulaması (`META_APP_ID` / `META_APP_SECRET`); Facebook Login > Geçerli OAuth yönlendirme URI'leri: `https://reblebi.com/api/auth/facebook/callback`. Yalnızca `email` ve `public_profile` istenir.

**Google Ads**
- Google Ads API geliştirici jetonu al (Google Ads yönetici hesabı > API Merkezi) ve `GOOGLE_ADS_DEVELOPER_TOKEN` olarak tanımla. Yönetici (MCC) üzerinden erişiyorsan `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (tiresiz). Sürüm varsayılanı `v25` (Ağustos 2027'ye kadar destekli), `GOOGLE_ADS_API_VERSION` ile değiştirilebilir.
- Google Cloud OAuth istemcisine yönlendirme URI'si: `https://reblebi.com/api/ads/google/callback`; izin ekranına `https://www.googleapis.com/auth/adwords` kapsamını ekle.

**TikTok Ads**
- TikTok for Business geliştirici portalında uygulama aç (gönderi için kullanılan TikTok uygulamasından ayrı), "Reporting" iznini seç; `TIKTOK_ADS_APP_ID` ve `TIKTOK_ADS_SECRET` olarak tanımla. Yönlendirme adresi: `https://reblebi.com/api/ads/tiktok/callback`.

**YouTube Analytics**
- Google Cloud'da "YouTube Analytics API"yi etkinleştir; izin ekranına `yt-analytics.readonly` kapsamını ekle. Bu izinden önce bağlanmış YouTube kanalları bir kez yeniden bağlanmalı.

**LinkedIn**
- Varsayılan API sürümü artık `202609` (önceki `202506` desteklenmiyordu; `LINKEDIN_VERSION` tanımlı değilse paylaşım hata alıyor olabilirdi). Şirket sayfası insights için Community Management API erişimi (`r_organization_social` / `rw_organization_admin`) gerekir.

**Hashtag takibi**
- Meta uygulamasına "Instagram Public Content Access" özelliği (App Review) gerekir. Instagram bir hesabın 7 günde en fazla 30 farklı etiket sorgulamasına izin verir.

**Google İşletme Profili (4. tur)**
- Google Cloud'da "My Business Account Management API", "My Business Business Information API" ve "Business Profile Performance API"yi etkinleştir; Google'dan Business Profile API erişimi (başvuru formu) onaylanmış olmalı.
- OAuth istemcisine yönlendirme URI'si: `https://reblebi.com/api/oauth/gmb/callback`; izin ekranına `https://www.googleapis.com/auth/business.manage` kapsamını ekle. Google istemcisi tanımlı değilse kanal eski form akışıyla bağlanır.
- Değerlendirmeler 30 dakikada bir, performans verisi günlük çekilir (Google birkaç gün gecikmeli verir).

**YouTube yorumları ve rakipler (4. tur)**
- Mevcut kapsamlar yeterli (`youtube.force-ssl` yanıt için, `youtube.readonly` okuma için). Yorumlar 10 dakikada bir yoklanır (commentThreads = 1 kota birimi); rakip kanal başına günde 3 birim.

**Pinterest / Twitch / Bluesky (4. tur)**
- Pinterest ve Twitch kanalları jetonla bağlanır: Pinterest jetonunun `user_accounts:read` ve `pins:read` kapsamları olmalı (hesap analitiği için işletme hesabı). Twitch toplam takipçi sayısı ek kapsam istemez. Bluesky metrikleri herkese açık API'den gelir, ayar gerekmez. Google İşletme yönlendirme adresi Ayarlar'daki OAuth yönlendirme listesinde de görünür.

**Reklam yönetimi (4. tur)**
- Meta: reklam bağlantısı artık `ads_read,ads_management` ister; canlıda `ads_management` App Review'dan geçmeli. Daha önce bağlanmış Meta reklam hesapları duraklat/başlat ve öne çıkarma için bir kez yeniden bağlanmalı (metrikler bağlanmadan da çalışır). Öne çıkarmada kullanıcı sayfada reklamveren rolünde olmalı; Instagram gönderisi için IG hesabı sayfaya bağlı olmalı.
- Google Ads: yazma işlemleri (kampanya durumu, öneri uygula/yoksay) geliştirici jetonunun en az "Basic" erişimde olmasını ister; "Test" erişimi yalnızca test hesaplarında çalışır.
- TikTok Ads: uygulamada "Campaign Management" (kampanya yönetimi) izni de seçilmeli; mevcut bağlantılar yeniden yetkilendirilmeli.
- Kampanya başlatma ve öne çıkarma yalnızca yönetici rolüne açıktır; oluşturulan her şey duraklatılmış başlar.

**Web sitesi analitiği (4. tur)**
- Ayar gerekmez; izleme kodu `PUBLIC_URL` üzerinden `/api/public/t.js` ve `/api/public/collect` kullanır (CORS açık, CSRF denetimi bu uca uygulanmaz). Ülke kırılımı için önüne Cloudflare gibi ülke başlığı (`CF-IPCountry`) gönderen bir CDN gerekir; yoksa yalnızca tarayıcı dili görünür.

**Yüklenebilir uygulama (4. tur)**
- HTTPS'te çalışır (Railway/Caddy zaten HTTPS). Servis çalışanı yalnızca üretim derlemesinde kaydedilir; API ve medya istekleri önbelleğe alınmaz, sayfalar her zaman ağdan gelir.

**Twitch, Threads, Facebook rakipleri (5. tur)**
- Twitch kanalı `user:write:chat` izinli kullanıcı jetonuyla bağlanmalı; önceki bağlantılar (jetonu bu izni içermiyorsa) paylaşımda hata verir, yeniden bağlanmalı.
- Threads insights için `threads_manage_insights` zaten isteniyor; canlıda Meta incelemesi gerekir.
- Facebook rakip takibi Meta uygulamasında "Page Public Metadata Access" (takipçi) ve "Page Public Content Access" (gönderiler) özelliklerini ister.

**Anlık bildirim (6. tur)**
- Ayar gerekmez: VAPID anahtarı ilk kullanımda üretilip veritabanına yazılır. İstersen `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` ile sabitle (anahtar değişirse cihazların bildirimi yeniden açması gerekir). `SUPPORT_EMAIL` tanımlıysa VAPID iletişim adresi olarak kullanılır.
- HTTPS şart (canlıda var). iPhone/iPad'de yalnızca ana ekrana eklenmiş uygulama bildirim alır (iOS 16.4+).

**Studio e-postası (6. tur)**
- SMTP değişkenleri (mevcut `SMTP_*`) gerekir; yoksa içerik sunucu günlüğüne yazılır.

**Looker Studio**
- `integrations/looker-studio/README.md`'deki adımlar: panelden API anahtarı oluştur, bağlayıcıyı Google Apps Script'te dağıt, Looker Studio'da "Kendi bağlayıcın" ile ekle.

**E-posta özeti**
- SMTP değişkenleri (mevcut `SMTP_*`) tanımlı olmalı; yoksa içerik sunucu günlüğüne yazılır. Gönderim zamanı çalışma alanı saatiyle pazartesi / ayın ilk günü 09:00 sonrası.

**Link in bio**
- Sayfalar `https://reblebi.com/l/<adres>`; tıklama yönlendirmeleri `robots.txt`'te taranmaz (`/l/*/go/`).

## Kalanlar

| İş | Büyüklük | Not |
|---|---|---|
| Google Ads ve TikTok'ta sıfırdan reklam; Meta'da video reklam ve kayıtlı hedef kitle | L | Meta'da görselli bağlantı reklamı var |
| TikTok ve X hesap insights ve rakipleri | M | TikTok Business/Research API onayı; X ücretli API |
| Kick, Lemmy, Warpcast paylaşımı (gerçek API) | S–M | Şimdilik kapalı; Nostr imzalama kütüphanesi, Dribbble yükleme izni ister |
| Canva entegrasyonu, Drive/Dropbox seçici penceresi | M | Bugün paylaşım bağlantısı yapıştırılıyor |
| Sosyal dinleme (web/haber/Reddit bahsetmeleri) | L | Hootsuite/Sprout seviyesi; ayrı veri kaynağı gerekir |
| Mağaza uygulaması (iOS/Android) | L | PWA + anlık bildirim var |

## Demo nasıl açılır

Gerçek `data/` veritabanına dokunmaz; veri `data/demo/` altında ve kurgusaldır (rakip hesaplar, Meta/Google/TikTok reklam hesapları, hashtag ölçümleri, kütüphane, YouTube analitiği ve yorumlar dahil).

```bash
npx tsx server/scripts/demo-api.ts
```

Ayrı bir terminalde (Windows):

```bash
cmd /c "set VITE_API_URL=http://localhost:4510&& npm exec -w web -- vite --port 5530"
```

Sonra http://localhost:5530/login. Demo giriş bilgileri `server/scripts/demo-seed.ts` dosyasının başında.

## Ölçüt

Her fazın sonunda `02-OZELLIK-ESLESTIRME.md` güncellenir: "yok" → "kısmi/var" ve dosya yolu.
