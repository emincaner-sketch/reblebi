# Meta App Review hazırlığı — Reblebi (App ID 1821303905960281)

Durum (10 Eki 2026):
- Alan adı ydsmatik.com: DOĞRULANDI (Business Settings > Domains).
- İşletme doğrulaması (LUSGA LTD): "Pending submission". Kuruluş Belgesi yüklendi; telefon bölümü için şirket adı + telefon yazan belge eksik (fatura/VoIP sözleşmesi).
- İşletme doğrulaması bitmeden Advanced Access başvurusu gönderilemez. Aşağıdakiler başvuru anında kopyala-yapıştır içindir.

## 1. Başvuru sırası
1. İşletme doğrulaması → 2. Erişim doğrulaması (Tech Provider, ~5 gün) → 3. App Review.
2. Önce **Instagram (Instagram ile Giriş)**, sonra **Facebook Sayfaları**, sonra **Threads**. Her turda yalnızca o turun izinleri.
3. Reklam (ads_management/ads_read), WhatsApp ve diğer kullanım senaryoları bu turda İSTENMEYECEK. Panelde kalabilirler; sadece başvuruya eklenmeyecekler.

## 2. Genel alanlar (App settings > Basic)
- App name: Reblebi
- Category: Business and pages
- Privacy Policy URL: https://reblebi.com/en/privacy
- Terms of Service URL: https://reblebi.com/en/terms
- User data deletion: Callback URL https://reblebi.com/webhooks/meta/data-deletion  (status sayfası: https://reblebi.com/data-deletion)
- Deauthorize callback: https://reblebi.com/webhooks/meta/deauthorize
- App domains: reblebi.com
- Business email: (işletme e-postası)

## 3. İnceleyici için test talimatı (App verification)
Platform: Web — https://reblebi.com

```
1. Go to https://reblebi.com and click "Log in". Use the test account below (no 2FA):
   Email: <TEST_EMAIL>   Password: <TEST_PASSWORD>
2. Switch the interface to English with the EN button in the top bar.
3. Open "Channels" (Kanallar) and click "Connect channel" > Instagram.
   Log in with your Instagram professional test account and approve the permissions.
4. The connected Instagram account appears in the channel list with its username and avatar.
5. Click "New post", choose the Instagram channel, upload an image or video, write a caption and click "Publish now".
   The post is published to Instagram and its status becomes "Published".
6. Open "Inbox" to read and reply to Instagram DMs and comments of the connected account.
7. Open "Analytics" to see follower count, reach and engagement of the connected account.
8. To disconnect, open "Channels" and click the delete icon on the channel; all tokens and data for that channel are deleted.
```
Not: Test hesabını Reblebi'de inceleyici için ayrıca açacağız (2FA'sız, e-posta doğrulaması tamamlanmış).

## 4. İzin başına açıklamalar (İngilizce, kopyala-yapıştır)

### Tur 1 — Instagram API with Instagram Login
**instagram_business_basic**
Reblebi is a social media management panel. When a user connects their Instagram professional account, we use instagram_business_basic to read the account ID, username and profile picture so the account can be shown in the user's channel list and selected as a publishing target. This data is only shown to the user who connected the account.

**instagram_business_content_publish**
Users create a post in the Reblebi composer (image, carousel, reel or story), select their connected Instagram account and click "Publish now" or schedule a time. We use instagram_business_content_publish only to publish that content to the user's own Instagram account at the time the user chose. We never publish without an explicit user action.

**instagram_business_manage_comments**
The Reblebi Inbox shows comments on the user's own Instagram posts so the user can read, reply to, hide or delete them from one place. We use instagram_business_manage_comments only for comments on media owned by the connected account, and only when the user takes an action or enables an auto-reply rule they configured.

**instagram_business_manage_messages**
The Reblebi Inbox lets the user read and reply to Instagram Direct messages sent to their own professional account. Replies are written by the user (or by an auto-reply rule the user created and enabled) and sent within Meta's messaging window. We use instagram_business_manage_messages only for the connected account's conversations.

**instagram_business_manage_insights**
The Reblebi Analytics page shows the connected account's follower count, reach, impressions and engagement per post so the user can see which content performs best and choose posting times. We use instagram_business_manage_insights only to display these metrics to the account owner.

### Tur 2 — Facebook Pages (Facebook Login for Business)
**pages_show_list** — After Facebook Login, we list the Pages the user manages so they can choose which Pages to connect to Reblebi.
**pages_manage_posts** — Users publish or schedule posts to their own Facebook Page from the Reblebi composer; we post only after the user clicks Publish or at the time they scheduled.
**pages_read_engagement** — We read the Page's posts, reactions and comment counts to show post status and performance on the Reblebi Analytics and Calendar pages.
**pages_manage_metadata** — We subscribe the connected Page to webhooks so new comments and messages appear in the Reblebi Inbox in real time.
**pages_messaging** — The Reblebi Inbox lets the Page admin read and reply to Messenger conversations of their own Page, within the standard messaging window.
**pages_manage_engagement** — Page admins reply to, hide or delete comments on their own Page posts from the Reblebi Inbox.
**read_insights** — The Analytics page shows Page reach, impressions and engagement to the Page admin.
**business_management** — Required to list Pages and Instagram accounts that are owned through the user's Business portfolio, so the user can connect them.

### Tur 3 — Threads API
**threads_basic** — Read the connected Threads profile (ID, username, picture) to show it in the channel list.
**threads_content_publish** — Publish text, image, video posts and threads that the user created in the Reblebi composer, only after the user clicks Publish or at their scheduled time.
**threads_read_replies** — Show replies to the user's own Threads posts in the Reblebi Inbox.
**threads_manage_replies** — Let the user reply to and hide replies on their own Threads posts from the Inbox.
**threads_manage_insights** — Show views, likes, replies and reposts of the user's Threads posts on the Analytics page.

## 5. Video (screencast) kuralları — her izin için AYRI video
- Arayüz İngilizce (EN), adres çubuğunda reblebi.com görünsün.
- Akış: reblebi.com'a giriş → Kanallar → bağlan → Meta izin ekranı (izinler okunacak kadar beklet) → izin kullanıldığı özellik → sonuç (ör. Instagram'da yayınlanan gönderi).
- Ekrana kısa İngilizce not ekle: "This step uses instagram_business_content_publish".
- 1–3 dk, mp4. Şifre/anahtar görünmesin. Claude eklentisi/şeridi görünmesin.

### Tur 1 video listesi
1. instagram_business_basic: Bağla → izin ekranı → kanal listesinde kullanıcı adı + avatar.
2. instagram_business_content_publish: Yeni gönderi → Instagram → görsel + metin → Publish now → Instagram uygulamasında gönderi.
3. instagram_business_manage_comments: Instagram'da test yorumu → Reblebi Inbox'ta yorum → yanıt → Instagram'da yanıt görünür.
4. instagram_business_manage_messages: Başka hesaptan DM → Inbox'ta mesaj → yanıt → Instagram'da yanıt.
5. instagram_business_manage_insights: Analytics → takipçi, erişim, gönderi bazlı metrikler.

## 6. Başvurudan önce yapılacaklar
- [ ] İşletme doğrulamasını tamamla (telefon belgesi).
- [ ] Erişim doğrulaması (Tech Provider) başvurusu.
- [ ] Gizlilik politikasına Threads bölümü ekle (şu an Meta = Facebook/Instagram yazıyor).
- [ ] İnceleyici test hesabı (2FA'sız) ve Instagram profesyonel test hesabı hazırla.
- [ ] Her izin için en az bir başarılı API çağrısı yapılmış olmalı (bağlı hesaplarla zaten yapılıyor; başvurudan önce panelde kontrol et).
- [ ] Not: Facebook Login akışı (META_SCOPES) instagram_basic / instagram_content_publish gibi Facebook-Login Instagram izinlerini de istiyor. Instagram için "Instagram ile Giriş" seçildiği için bu izinler Facebook turunda istenmeyecek; ileride kod tarafında bu listeden çıkarılması gerekebilir.
