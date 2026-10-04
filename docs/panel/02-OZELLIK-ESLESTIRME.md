# 02 · Özellik eşleştirmesi: Metricool ↔ Reblebi

> Durum: **var** (Reblebi'de çalışıyor) · **kısmi** (temel hali var) · **yok** · **bu çalışma** (2026-10-03'te eklendi) · **3. tur** (2026-10-04, Metricool ile fark kapatma) · **4. tur** (2026-10-04, Metricool'un kalan özellikleri) · **5. tur** (2026-10-04, kalan farklar) · **2. tur** (2026-10-03 ikinci turda eklendi; platform izni gerekenler canlıda Meta/Google ayarı ister, bkz. `05-YOL-HARITASI.md` § Canlıya alma).

> Reblebi sütunu koddan doğrulandı; dosya yolları `web/src/` ve `server/src/` altındadır.

## Analitik

| Özellik | Metricool | Reblebi | Durum | Not |
|---|---|---|---|---|
| Marka özeti (tüm ağlar tek sayfada) | Summary | `pages/Analytics.tsx` → yeni Özet raporu | **bu çalışma** | KPI + karşılaştırma + günlük grafikler + ağ dağılımı |
| Ağ bazında analitik | Ağ sayfaları | Ağ filtresi (sol menü) | **bu çalışma** | Aynı rapor, tek ağa süzülür |
| Tarih aralığı | Main period | 7 / 30 / 90 gün + özel aralık | **bu çalışma** | Eski sayfada yalnız 7/30/90 vardı |
| Karşılaştırma dönemi | Comparison period | Önceki eşit dönem | **bu çalışma** | KPI'larda fark ve yüzde |
| Takipçi gelişimi | Community | Saatlik anlık görüntülerden günlük seri (`services/analytics.ts`) | **var → grafik bu çalışma** | Kanal bağlandığı günden itibaren |
| Gösterim / erişim | Impressions, Reach | Instagram/Facebook günlük hesap insights (`services/insights.ts`, `providers/meta/*`); **Threads** (görüntülenme, bağlantı tıklaması, takipçi kitlesi); YouTube Analytics (izlenme, izlenme süresi, abone dengesi, izleyici kitlesi); LinkedIn şirket sayfası (gösterim, erişim, tıklama, sayfa ziyareti, yeni takipçi); **Pinterest** (gösterim, kaydetme, pin/bağlantı tıklaması); **Google İşletme Profili** (Haritalar+Arama görüntülenmesi, web sitesi tıklaması, telefon araması, yol tarifi) | **2.–5. tur** | Tamamlanmış günler; TikTok ve X hesap insights yok (platform API'si vermiyor / ücretli) |
| Bluesky, Twitch, Pinterest, Google İşletme hesap metrikleri | Ağ sayfaları | Takipçi/gönderi (Bluesky herkese açık API, jetonsuz), Twitch takipçi + video izlenmesi, Pinterest takipçi/aylık görüntülenme, Google İşletme değerlendirme sayısı ve puanı (`providers/bluesky.ts`, `twitch.ts`, `pinterest.ts`, `gmb.ts`) | **4. tur** | Bluesky gönderi metrikleri (beğeni, yanıt, yeniden paylaşım) de çekilir |
| Görüntülenme | Views | Gönderi metriği `views` (destekleyen ağlarda) | **var** | |
| Etkileşim (beğeni, yorum, paylaşım) | Interactions | Gönderi metrikleri (`post_metrics`) | **var → grafik bu çalışma** | |
| Kaydetme | Saved | Instagram gönderi metriği `saves` | **2. tur** | Biçime göre metrik seçimi (akış / reel / hikâye) |
| Etkileşim oranı | Engagement | Etkileşim / görüntülenme (görüntülenme varsa) | **bu çalışma** | Erişim gelince erişime göre (F2) |
| Gönderi listesi (sırala, ara, sütun, CSV) | List of posts | Eski sayfada yalnız ilk 10 | **bu çalışma** | En fazla 500 gönderi, istemcide sayfalama |
| Hashtag performansı (kendi gönderilerin) | List of hashtags | Gönderi metninden hesaplanır | **bu çalışma** | |
| İçerik türü dağılımı | Types | `post`, `reel`, `story`, `video`, `thread` | **bu çalışma** | |
| En iyi saatler | Best times (kitle çevrimiçi %) | Gün × saat ısı haritası (kendi gönderilerinin etkileşimi) | **bu çalışma** | Kaynak farklı: kitle değil, geçmiş performans; ekranda yazıyor |
| Hikâye metrikleri | Stories | Hikâye için erişim, görüntülenme, yanıt, paylaşım | **kısmi, 2. tur** | Hikâyeler 24 saat sonra API'den düşer; ayrı hikâye sekmesi yok |
| Reels metrikleri (izlenme süresi) | Reels | Reel için ortalama izlenme süresi (`avgWatchMs`) + erişim/kaydetme | **kısmi, 2. tur** | Panelde ayrı Reels görünümü yok |
| Takipçi dengesi (kazanılan / kaybedilen) | Balance of followers | Yeni takip / takibi bırakan, ayrışan sütun grafiği (`panel/charts/BalanceChart.tsx`) | **2. tur** | Instagram `follows_and_unfollows`, Facebook günlük takip/bırakma |
| Demografi (ülke, şehir) | Demographics | Ülke, şehir, yaş, cinsiyet (`channel_audience`, haftalık) | **2. tur** | Instagram en az 100 takipçide verir; Facebook ülke/şehir |
| Sayfa ziyareti / profil aktivitesi | Page visits, Profile activity | Profil ziyareti, web sitesi tıklaması | **2. tur** | |
| Platform metrik değişikliği notu | Var | Yok | **bu çalışma** | "API vermiyor" ve "bağlandığı günden itibaren" notları |
| Reklam metrikleri (Meta, Google, TikTok) | Ads, Ad accounts | Analitik > Reklamlar (`pages/Ads.tsx`, `services/ads.ts`, `services/ads-providers.ts`): Meta Marketing API, Google Ads API v25 (MCC dahil), TikTok Business API v1.3; Kampanyalar · Reklam setleri/grupları · Reklamlar · Anahtar kelimeler (Google); harcama, gösterim, erişim, tıklama, CTR, CPC, CPM, dönüşüm, dönüşüm başı maliyet; sütun seçici + CSV | **3. tur** | Yönetim için bkz. Diğer > Reklam yönetimi |
| Rakip takibi | Competitors | Analitik > Rakipler (`pages/Competitors.tsx`, `services/competitors.ts`): **Instagram** (Business Discovery), **Facebook Sayfaları** (Graph, herkese açık Sayfa verisi), **YouTube** (Data API), **Twitch** (Helix: takipçi, video izlenmesi), **Bluesky** (herkese açık); ağ sekmeleri, günlük anlık görüntü, kendi hesapla karşılaştırma, öne çıkan gönderi/videolar | **2.–5. tur** | Ağ başına en fazla 20 rakip; TikTok ve X rakipleri yok (TikTok Research API kapalı, X ücretli); Facebook gönderileri "Page Public Content Access" ister |
| Hashtag tracker (genel izleme) | Ücretli | Analitik > Hashtag takibi (`services/hashtag-tracker.ts`, `pages/Hashtags.tsx`): Instagram hashtag araması, son 24 saat hacmi, popüler gönderilerin etkileşimi, günlük seri | **3. tur** | Yalnızca Instagram (X ücretli API); Instagram 7 günde 30 farklı etiket sınırı, çalışma alanı başına 10 |
| Rapor (PDF/PPT, logo) | Reports | Markalı rapor (logo, renk, bölümler, giriş notu, öne çıkanlar) A4 yazdır/PDF, **PowerPoint (.pptx, düzenlenebilir grafikler)**, haftalık/aylık e-posta özeti (`pages/Report.tsx`, `panel/analytics/pptx.ts`, `services/report-email.ts`) | **2.–3. tur** | PDF ve PPTX tarayıcıda üretilir |
| Özel pano / Studio | Studio | Analitik > Studio (`pages/Studio.tsx`, `api/routes/dashboards.ts`): birden çok pano, 11 kart türü (tek ölçü, günlük grafik, ağlara göre, en iyi gönderiler, içerik türleri, hashtag, en iyi saatler, kitle, reklamlar, rakipler, not), kart başına ağ/kanal kapsamı, ¼-½-tam genişlik; sürükle-bırak + klavye (ok tuşları) + dokunmatik için taşı düğmeleri; otomatik kaydetme; panolar ekiple paylaşılır; **PDF / Yazdır** ve **zamanlı e-posta** (haftalık/aylık, alıcılar, test e-postası; `services/dashboard-email.ts`) | **4.–6. tur** | Migration 13, 16; çalışma alanı başına 20 pano, pano başına 30 kart |
| Looker Studio | Var | Looker Studio topluluk bağlayıcısı (`integrations/looker-studio/`, API anahtarıyla) + günlük dışa aktarma `GET /api/export/daily` (JSON/CSV) | **3. tur** | Bağlayıcı kullanıcının Google hesabında Apps Script ile dağıtılır; herkese açık listeleme Google incelemesi ister |
| Web sitesi analitiği | Web tracking | Analitik > Web sitesi (`pages/Website.tsx`, `services/site-analytics.ts`): tek satırlık izleme kodu (`/api/public/t.js`), ziyaretçi, sayfa görüntüleme, sayfa/ziyaretçi, sosyal ağlardan gelen ziyaret, en çok görüntülenen sayfalar, trafik kaynakları, UTM kaynak/kampanya, cihaz, tarayıcı, dil (CDN başlığı varsa ülke); SPA gezinmesini de sayar | **4. tur** | Çerezsiz: günlük değişen anahtarla hash, 2 gün sonra silinir; bot ve başka alan adından gelen sayımlar reddedilir. Migration 15 |
| DM otomasyon performansı | Yok | Otomatik yanıt oranı (`inbox.stats`) | **Reblebi farkı** | Özet raporda KPI |

## Planlama ve yayın

| Özellik | Metricool | Reblebi | Durum |
|---|---|---|---|
| Takvim (hafta/ay) ve liste | Calendar, List | `pages/Posts.tsx` (Ay, Hafta, Liste) | **var** |
| Gönderi düzenleyici, ağ başına metin | Create post | `pages/Composer.tsx` | **var** |
| Ağ başına karakter sayacı | Var | Var (`len/max`, aşımda uyarı) | **var** |
| Canlı önizleme | Mobil/masaüstü | Kanal başına önizleme, mobil/masaüstü çerçeve, karakter sınırı uyarısı | **2. tur** |
| İlk yorum | Var | Yorum işleri (`commentJobs`) | **var** |
| AI ile metin | Var | Marka sesi + AI üretim | **var** |
| En iyi saat önerisi | Best times katmanı | Haftalık takvimde ısı katmanı + en iyi 5 saat (`GET /api/analytics/best-times`) | **2. tur** |
| Taslaklar / kütüphane | Posts library | Planlama > Kütüphane: gönderi şablonları (metin + medya + tür) ve hashtag grupları; düzenleyicide tek tıkla ekle, "Kütüphaneye kaydet" (`pages/Library.tsx`, `api/routes/library.ts`) | **3. tur** |
| Evergreen kuyruk | Autolists | Planlama > Otomatik listeler (`pages/Autolists.tsx`, `services/autolists.ts`): içerik kuyruğu, kanal seçimi, haftalık gün/saat, liste bitince başa dönme, sıradaki paylaşımlar önizlemesi, kütüphaneden içe aktarma, sıralama; zamanlayıcı dakikada bir bakar | **4. tur** | Uygun olmayan öğe kuyruğu kilitlemez (atlanır, sebep görünür); onay modu "tümü" iken listeyi yalnızca yönetici açar; kaçırılan saat 15 dk'dan eskiyse telafi edilmez. Migration 14 |
| Toplu yükleme | Bulk upload (CSV) | Planlama > Toplu yükleme (`pages/BulkImport.tsx`, `lib/csv-import.ts`): şablon indir, sürükle-bırak CSV (virgül/noktalı virgül, çok satırlı metin, TR/EN başlıklar), kanal adı ya da ağ, tarih/saat (çalışma alanı saati), tür, ilk yorum, medya bağlantısı, taslak; önce doğrulama (satır satır hata), sonra içe aktarma, isteğe bağlı kampanyada toplama | **4. tur** | Mevcut `POST /api/posts/bulk` (dryRun) kullanılır; en fazla 500 satır |
| Instagram ızgara planlayıcı | Feed preview / Grid | Planlama > Instagram ızgarası (`pages/FeedGrid.tsx`, `api/routes/feed.ts`): planlanan gönderiler canlı profil akışının üstünde (3:4), sürükle-bırak ya da düğmeyle iki planlı gönderinin saatini değiştirme | **5. tur** | Canlı akış okunamazsa panelden yayınlananlar gösterilir |
| Google Drive / Dropbox'tan medya | Drive, Dropbox | Medya > URL'den al ve CSV medya sütunu paylaşım bağlantısını doğrudan indirmeye çevirir (`services/media.ts` `directDownloadUrl`) | **5. tur** | Drive dosyası "bağlantıya sahip herkes" ile paylaşılmalı; seçici (picker) penceresi yok |
| Akışlar | Flows | Çok adımlı iş akışları (`pages/Automation.tsx`, `services/workflow-engine.ts`) | **var** |
| Silinen gönderiler | Deleted posts | Planlama > Silinenler: 30 gün çöp kutusu, geri al, kalıcı sil (`pages/Trash.tsx`, `core/repos/trash.ts`) | **2. tur** |
| Kampanyalar | Campaign dashboards | Kampanyalar + AI planlayıcı + kampanya performans kartı, analitikte kampanya süzgeci | **2. tur** |
| Onay akışı | Review requests | Onay akışı + müşteri önizleme linki + yorumlar | **var** |

## Gelen kutusu

| Özellik | Metricool | Reblebi | Durum |
|---|---|---|---|
| Birleşik DM | Var | Instagram DM, Messenger, WhatsApp, Telegram, X | **var** (WhatsApp ve Telegram Reblebi farkı) |
| Yorumları gelen kutusunda yanıtlama | Var | Instagram, Facebook ve **YouTube** yorumları ayrı konu, "Yorumlar" süzgeci, herkese açık yanıt (`providers/meta/webhook.ts`, `providers/youtube.ts`, `services/dm-engine.ts`) | **2.–4. tur** (YouTube 10 dk'da bir yoklanır; yorumlara otomatik yanıt verilmez) |
| İşletme değerlendirmeleri (Google) | Reviews | Google İşletme Profili değerlendirmeleri gelen kutusunda (yıldız rozeti), yanıt Google'da herkese açık yayınlanır (`providers/gmb.ts`) | **4. tur** (30 dk'da bir yoklama; konum OAuth ile bağlanır) |
| Çözülmemiş / okunmamış / tümü | Var | Durum ve dikkat filtresi | **var** |
| Kurallı otomatik yanıt + AI yanıt | Yok | Var | **Reblebi farkı** |

## Diğer

| Özellik | Metricool | Reblebi | Durum |
|---|---|---|---|
| Çoklu marka | Add brand | Çalışma alanları | **var** |
| Ekip ve roller | User management | Sahip / yönetici / editör / izleyici | **var** |
| AI asistan bağlantısı (MCP) | Metricool MCP | MCP, tüm planlarda | **var** |
| Webhook / API | API (Advanced) | API anahtarları + giden webhook'lar | **var** |
| Link in bio | SmartLinks | `/l/<adres>` sunucuda çizilen sayfa, düğmeler, sosyal ikonlar, tıklanabilir gönderi ızgarası, tema; görüntülenme/tıklama/kaynak istatistiği (`pages/Bio.tsx`, `services/bio.ts`) | **2. tur** |
| Reklam yönetimi | Meta/Google/TikTok Ads | Metrikler + yönetici rolüyle: kampanya **duraklat / başlat** (üç platform), **Meta gönderi öne çıkarma** (Facebook/Instagram gönderisi; kampanya, reklam seti, reklam DURAKLATILMIŞ oluşturulur, bütçe/süre/ülke/yaş), **Google Ads önerileri** (uygula / yoksay, haftalık tıklama-maliyet etkisi) (`panel/ads/AdsManage.tsx`) | **4. tur** | Sıfırdan reklam kreatifi oluşturma yok; yazma izni yoksa "yeniden bağla" uyarısı |
| Mobil uygulama | iOS/Android | Yüklenebilir web uygulaması (PWA): manifest kısayolları, servis çalışanı, çevrimdışı sayfası, "Uygulamayı yükle"; **anlık bildirim (Web Push)**: paneldeki zil bildirimleri telefona/masaüstüne düşer, cihaz başına aç/kapat (`public/sw.js`, `lib/pwa.ts`, `services/webpush.ts`) | **kısmi, 4.–6. tur** | Mağaza uygulaması yok; iOS'ta bildirim için uygulama ana ekrana eklenmeli (iOS 16.4+) |
| Sosyal giriş | Google, Facebook | Google ve Facebook ile giriş/kayıt (doğrulanmış e-posta; sunucuda istemci tanımlıysa düğme görünür) (`services/google-login.ts`, `services/facebook-login.ts`) | **2.–3. tur** |
| Dil | Çok dilli | TR / EN | **var** |

## Bu çalışmada eklenenler (özet)

1. `GET /api/analytics/report`: mevcut tablolardan (anlık görüntüler, gönderi hedefleri, gönderi metrikleri, gelen kutusu) dönem + karşılaştırma raporu. Şema değişikliği yok.
2. Yeni analitik sayfası: Özet + ağ filtresi, dönem ve karşılaştırma, metrik kartları, günlük grafikler, ağ dağılımı, içerik türü, hashtag tablosu, gün × saat ısı haritası, gönderi tablosu (arama, sıralama, sütun, CSV), yazdır/PDF.
3. Panel teması ve kabuk: koyu üst çubuk + bağlamsal sol menü, ayarlar sağ üst menüde, açık tema varsayılan, koyu tema seçilebilir.
4. Giriş / kayıt / şifre / davet / onay ekranları: bölünmüş düzen, doğrulanmış değer önerileri.
