# Platform onay başvuruları (canlıda veri gelmesi için)

Kod hazır; insights, yorumlar, reklam yönetimi, rakip ve hashtag takibi gibi özellikler **platformların uygulama incelemesi** onaylanmadan yalnızca uygulama sahibinin/test kullanıcılarının hesaplarında çalışır. Bu belge her başvuruda ne istendiğini ve **yapıştırılmaya hazır İngilizce açıklamaları** içerir (inceleyiciler İngilizce okur). İzin listeleri koddan alındı (`server/src/providers/*`, `services/*-login.ts`, `services/ads-providers.ts`).

> Sıra önerisi: **Meta** (en çok özellik ona bağlı) → **Google** (YouTube, İşletme Profili, Ads) → TikTok → LinkedIn → Pinterest → X. Meta ve Google incelemeleri genelde 1–4 hafta sürer; aynı gün başlat.

---

## 0. Önce hazırla (tüm başvurular ister)

| Ne | Durum / yapılacak |
|---|---|
| Gizlilik politikası | `https://reblebi.com/privacy` (EN: `/en/privacy`) var. Metinde hangi platform verisinin neden okunduğu, saklama süresi ve silme yolu yazmalı. |
| Kullanım koşulları | `https://reblebi.com/terms` |
| Veri silme | Sayfa `https://reblebi.com/data-deletion`; Meta geri çağrısı `https://reblebi.com/webhooks/meta/data-deletion`, yetki kaldırma `https://reblebi.com/webhooks/meta/deauthorize` (kodda hazır). |
| **İletişim bilgisi** | Canlıda `SUPPORT_EMAIL`, `COMPANY_NAME`, `COMPANY_ADDRESS` **boş** (`/api/public/config`). İnceleyiciler destek e-postası ve şirket bilgisi ister: Railway'de bu üç değişkeni tanımla. |
| Alan adı doğrulama | Google Search Console'da `reblebi.com` (DNS TXT). Meta Business Manager'da alan adı doğrulama. |
| İşletme doğrulaması | Meta "Business Verification" (vergi levhası/ticaret sicili). Gelişmiş erişim (Advanced Access) için şart. |
| İnceleyici hesabı | Canlıda inceleyiciye özel bir Reblebi hesabı aç (kendi bilgilerinle), içine test sayfası/Instagram hesabı bağla, birkaç gönderi planla. Bilgileri yalnızca başvuru formuna yaz. |
| Ekran kaydı | Her izin için 1–3 dk video: giriş → bağlantı → iznin kullanıldığı ekran. Aşağıda her izin için çekilecek sahne yazıyor. |

---

## 1. Meta (Facebook, Instagram, Threads, Reklamlar)

**Nerede:** developers.facebook.com → Uygulaman → App Review → Permissions and Features. Her izin için "Request advanced access", açıklama + video.

**Uygulama açıklaması (App Details > Description):**
```
Reblebi is a social media management tool for small businesses and agencies. Users connect their own Facebook Pages, Instagram professional accounts and Threads profiles to schedule and publish posts, reply to comments and direct messages from a unified inbox, and view analytics and ad performance for their own accounts. All actions are initiated by the logged-in user for assets they manage.
```

### 1.1 Sayfa ve Instagram yayınlama / gelen kutusu

| İzin | Kodda nerede | İnceleyiciye yazılacak açıklama | Videoda gösterilecek |
|---|---|---|---|
| `pages_show_list` | Kanal bağlama | `Used to list the Facebook Pages the user manages so they can choose which Page to connect to Reblebi.` | Kanallar > Facebook > izin ekranı > sayfa listesi |
| `pages_manage_posts` | Facebook paylaşımı | `Used to publish text, photo and video posts that the user composes and schedules in Reblebi to their own Facebook Page.` | Yeni gönderi > Facebook seç > Şimdi yayınla > gönderinin Sayfada görünmesi |
| `pages_read_engagement` | Gönderi metrikleri, yorumlar, öne çıkarma | `Used to read engagement (reactions, comments, shares) on the user's own Page posts to show post performance in Reblebi analytics and to list comments in the inbox.` | Analitik > Facebook > gönderi tablosu |
| `pages_manage_metadata` | Webhook aboneliği | `Used to subscribe the user's Page to webhooks (feed, messages) so new comments and messages appear in the Reblebi inbox in real time.` | Bağlantı sonrası gelen kutusuna yeni yorumun düşmesi |
| `pages_messaging` | Messenger gelen kutusu | `Used to receive and reply to Messenger conversations of the user's Page from the Reblebi inbox. Automated replies are only sent within Meta's 24-hour messaging window and only for rules the user creates.` | Gelen kutusu > Messenger konuşması > yanıt |
| `pages_manage_engagement` | Yorum yanıtlama | `Used to reply to comments on the user's own Page posts from the Reblebi inbox.` | Gelen kutusu > Yorumlar > yanıt > Sayfada görünmesi |
| `read_insights` | Facebook hesap insights | `Used to show the user's own Page insights (reach, views, follows/unfollows, audience by country/city) in Reblebi analytics and reports.` | Analitik > Facebook > Hesap insights |
| `instagram_basic` | IG profil, medya, ızgara, rakip | `Used to read the connected Instagram professional account's profile and media to show its feed grid preview, post list and analytics in Reblebi.` | Planlama > Instagram ızgarası |
| `instagram_content_publish` | IG paylaşımı | `Used to publish photos, carousels and reels that the user composes and schedules in Reblebi to their own Instagram professional account.` | Yeni gönderi > Instagram > yayınla |
| `instagram_manage_messages` | IG DM gelen kutusu | `Used to receive and reply to Instagram Direct messages of the user's account from the Reblebi inbox, within the 24-hour window.` | Gelen kutusu > IG DM > yanıt |
| `instagram_manage_comments` | IG yorumları | `Used to list comments on the user's own Instagram posts in the Reblebi inbox and reply to them.` | Gelen kutusu > Yorumlar > IG yorumu > yanıt |
| `instagram_manage_insights` | IG insights, kitle, Business Discovery | `Used to show the user's own Instagram account insights (reach, profile visits, follows, audience demographics) and to read public metrics of other business accounts the user chooses to benchmark (Business Discovery) in Reblebi's Competitors page.` | Analitik > Instagram > Hesap insights; Analitik > Rakipler > Instagram |
| `business_management` | İşletme varlıkları | `Used to list Pages and Instagram accounts the user manages through Business Manager so they can connect them.` | Bağlantıda Business Manager sayfalarının listelenmesi |

**Özellikler (Features):**

| Özellik | Neden | Açıklama |
|---|---|---|
| Instagram Public Content Access | Hashtag takibi (`ig_hashtag_search`, `top_media`) | `Used for the Hashtag Tracker: the user enters hashtags relevant to their business and Reblebi shows the volume and top public posts for those hashtags. Limited to 10 hashtags per workspace and Instagram's 30 unique hashtags per 7 days.` |
| Page Public Metadata Access | Facebook rakip takibi (takipçi) | `Used on the Competitors page: the user enters public Facebook Pages in their industry and Reblebi shows their public follower counts over time next to the user's own Page.` |
| Page Public Content Access | Facebook rakip gönderileri | `Used on the Competitors page to show the public posts and their engagement of the competitor Pages the user explicitly adds.` |

### 1.1b Instagram ile doğrudan giriş (Facebook Sayfası gerekmez)

Kanallar > Kanal bağla > **Instagram ile giriş** kutucuğu "Instagram API with Instagram Login" akışını kullanır: kullanıcı yalnızca Instagram hesabıyla izin verir, Facebook Sayfası bağlaması gerekmez. Meta incelemesinde bu akış genelde daha hızlı onaylanır; Meta'ya göre "Instagram ile giriş" kullanıcı için en sade yoldur.

- Meta uygulaması > Instagram > **API setup with Instagram login**: redirect URI `https://reblebi.com/api/oauth/instagram-login/callback`; **Instagram app ID / secret** panelde Kanallar > Kanal bağla > kutucuğa tıkla > rehberdeki alanlara girilir (`.env` gerekmez, `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` de olur).
- İstenen izinler: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, `instagram_business_manage_insights`.
- Webhook: aynı sayfada Callback URL `https://reblebi.com/webhooks/meta`, doğrulama jetonu Ayarlar > Sistem'de; `messages` ve `comments` alanlarına abone ol.
- Jeton 60 gün geçerlidir ve süresi dolmadan otomatik yenilenir.
- Bu yolda **yok**: hashtag takibi (`ig_hashtag_search` yalnızca Facebook girişinde), Facebook Sayfası yayını. Rakip takibi (Business Discovery), gönderi, hikâye, reel, yorum, DM ve insights çalışır.
- İnceleme ekran kaydı: Reblebi'de kanal bağla > gönderi planla > yorumu yanıtla > DM yanıtla > analitik sayfası.

### 1.2 Reklamlar (ayrı bağlantı)

| İzin | Açıklama | Video |
|---|---|---|
| `ads_read` | `Used to show spend, impressions, clicks, conversions and campaign/ad set/ad level results of ad accounts the user connects, in Reblebi's Ads analytics and reports.` | Analitik > Reklamlar > hesap bağla > tablo |
| `ads_management` | `Used only on explicit user action: pausing/resuming the user's campaigns, boosting one of the user's own published Page/Instagram posts, and creating a link ad from the user's own image. Everything Reblebi creates is created PAUSED; spend only starts when the user starts the campaign.` | Reklamlar > Duraklat/Başlat; Gönderiyi öne çıkar; Yeni reklam > "Duraklatılmış oluştur" > Ads Manager'da duraklatılmış görünmesi |

### 1.3 Giriş

`email`, `public_profile` (Facebook ile giriş) genelde standart erişimle yeterli; açıklama: `Used to sign the user in with Facebook and create their Reblebi account with their verified email.`

### 1.4 Threads (ayrı Threads uygulaması/use case)

| İzin | Açıklama |
|---|---|
| `threads_basic` | `Used to identify the connected Threads profile.` |
| `threads_content_publish` | `Used to publish posts and threads the user schedules in Reblebi to their own Threads profile.` |
| `threads_manage_insights` | `Used to show views, link clicks and follower demographics of the user's own Threads profile in Reblebi analytics.` |
| `threads_read_replies`, `threads_manage_replies` | `Used to read and reply to replies on the user's own Threads posts from the Reblebi inbox.` |

---

## 2. Google (giriş, YouTube, İşletme Profili, Google Ads)

**Nerede:** console.cloud.google.com → APIs & Services → OAuth consent screen → "Publish app" → Verification. Uygulama adı "Reblebi", ana sayfa `https://reblebi.com`, gizlilik `https://reblebi.com/privacy`, yetkili alan adı `reblebi.com`.

| Kapsam | Tür | Kodda | Açıklama (İngilizce) |
|---|---|---|---|
| `openid`, `email`, `profile` | Hassas değil | Google ile giriş | `Sign in with Google.` |
| `youtube.upload` | Hassas | YouTube paylaşımı | `Used to upload videos the user schedules in Reblebi to their own YouTube channel.` |
| `youtube.readonly` | Hassas | Kanal, video metrikleri, rakip kanal verisi | `Used to read the user's channel and video statistics for Reblebi analytics, and public statistics of channels the user adds as competitors.` |
| `youtube.force-ssl` | Hassas | Yorum okuma/yanıtlama | `Used to list comments on the user's own videos in the Reblebi inbox and post replies the user writes.` |
| `yt-analytics.readonly` | Hassas | İzlenme süresi, abone dengesi, kitle | `Used to show watch time, subscribers gained/lost and audience demographics of the user's own channel in Reblebi analytics.` |
| `business.manage` | Hassas | Google İşletme Profili | `Used to show the user's Business Profile performance (Maps/Search views, website clicks, calls, direction requests) and to list and reply to reviews from the Reblebi inbox.` |
| `adwords` | Hassas | Google Ads | `Used to show the user's Google Ads campaign/ad group/ad/keyword performance, and—only on explicit user action—to pause/resume campaigns and apply or dismiss Google Ads recommendations.` |

**Video:** tek bir video yeterli: Google ile giriş → her kapsamın istendiği bağlantı ekranı (YouTube, İşletme, Ads ayrı) → kapsamın kullanıldığı ekran. YouTube'a "liste dışı" yükle, bağlantısını forma yaz.

**Ek başvurular (OAuth doğrulamasından ayrı):**
- **Google Business Profile API erişimi:** "Business Profile APIs access request" formu (Google'ın "Basic setup" sayfasında). Proje numarası ve kullanım amacı: `Social media management tool; businesses connect their own locations to view performance and reply to reviews.`
- **Google Ads geliştirici jetonu "Basic access":** Google Ads API Center → başvuru. "Tool design document" ister: Reblebi'nin reklam raporlama + kullanıcı onaylı duraklat/başlat + öneri uygula akışını anlatan 1–2 sayfa PDF. Test erişimiyle yalnızca test hesapları çalışır.

---

## 3. TikTok

| Ürün | Ne gerekiyor |
|---|---|
| Content Posting API (`video.publish`, `video.upload`) | **Audit (denetim)** başvurusu. Denetlenmemiş uygulamada videolar yalnızca "sadece ben" (SELF_ONLY) gizlilikte yayınlanır. Formda: `Reblebi lets creators and businesses schedule and publish videos to their own TikTok account. Users choose privacy level and interaction settings before posting, as required by TikTok's UX guidelines.` Video: düzenleyicide TikTok gizlilik seçimi + yayın. |
| `user.info.basic/profile/stats`, `video.list` | Login Kit kapsamları; uygulama incelemesinde açıklama: `Used to show the connected account's follower count and video statistics in Reblebi analytics.` |
| TikTok for Business (Ads) | Ayrı uygulama; "Reporting" (+ kampanya durumu için "Campaign Management") izinleri, Business Center doğrulaması. |

---

## 4. LinkedIn

- Kişisel profilde paylaşım (`w_member_social`) "Share on LinkedIn" ürünüyle hemen çalışır.
- **Şirket sayfası** paylaşımı ve insights için **Community Management API** başvurusu gerekir (LinkedIn Developer Portal → Products). Onaydan sonra Railway'de `LINKEDIN_SCOPES` değişkenine organizasyon kapsamlarını ekle (ör. `openid profile w_member_social r_organization_social w_organization_social rw_organization_admin`). Kullanım açıklaması: `Social media management: page admins schedule posts to their company page and view page analytics (impressions, clicks, follower gains).`

---

## 5. Pinterest ve X

- **Pinterest:** "Trial access" düşük kota verir; **Standard access** başvurusu (developers.pinterest.com → Apps → Upgrade). Açıklama: `Users schedule Pins to their own boards and view their account analytics.`
- **X (Twitter):** Ücretsiz katman yazma kotası çok düşük, DM ve okuma yok. Gönderi + DM + metrik için en az **Basic** ücretli paket gerekir; başvuru değil abonelik.

---

## 6. Başvuru sonrası

1. Her onaydan sonra ilgili kullanıcıların kanalı **bir kez yeniden bağlaması** gerekir (yeni izinler eski jetonda yoktur): Meta reklam bağlantısı (`ads_management`), YouTube (`yt-analytics.readonly`), Twitch (`user:write:chat`).
2. Panelde ilgili ekranlar (Analitik > Hesap insights, Rakipler, Hashtag takibi, Reklamlar) açıklama yerine veri göstermeye başlar.
3. Ayrıntılı teknik ayarlar: `docs/panel/05-YOL-HARITASI.md` § Canlıya alma.
