# Yayına alma ve satışa açma

Bu rehber SosyalPilot'u bir sunucuya kurup başka kullanıcılara (müşterilere) açman için gereken her adımı sırayla anlatır. Platform başına geliştirici uygulaması açma ayrıntıları [KURULUM.md](KURULUM.md)'de.

---

## 1. Gerekenler

| Ne | Öneri | Neden |
|---|---|---|
| Sunucu (VPS) | Ubuntu 24.04, 2 vCPU, 2–4 GB RAM, 40 GB disk (Hetzner, DigitalOcean, Contabo…) | Uygulama tek süreç + SQLite; küçük bir sunucu yüzlerce müşteriyi taşır |
| Alan adı | `panel.markan.com` gibi bir alt alan adı | OAuth, webhook ve MCP için https şart |
| E-posta (SMTP) | Resend, Brevo, Amazon SES, Zoho Mail | Doğrulama, şifre sıfırlama, davet ve bildirim e-postaları |
| AI anahtarı | Anthropic, OpenAI, xAI, Gemini ya da OpenRouter'dan en az biri | Panelde AI ile içerik ve plan üretimi (MCP ile bağlanan asistanlar için gerekmez) |

---

## 2. Sunucuya kurulum (Docker + otomatik HTTPS)

### 2.1 Alan adı

Alan adı panelinde bir **A kaydı** aç: `panel.markan.com → sunucunun IP adresi`. Sunucuda 80 ve 443 portları açık olmalı.

### 2.2 Docker

Sunucuya SSH ile bağlan:

```bash
curl -fsSL https://get.docker.com | sh
```

### 2.3 Projeyi sunucuya taşı

En temizi projeyi **özel (private)** bir GitHub deposuna gönderip sunucuda klonlamak:

```bash
git clone https://github.com/<kullanici>/sosyalpilot.git
cd sosyalpilot
```

Alternatif: bilgisayarından `scp -r` ile kopyala (`node_modules`, `data`, `.env` klasörlerini/dosyalarını kopyalama).

### 2.4 Ortam dosyası

```bash
cp .env.example .env
nano .env
```

En az şunları doldur:

```bash
DOMAIN=panel.markan.com
PUBLIC_URL=https://panel.markan.com
APP_URL=https://panel.markan.com
APP_SECRET=<openssl rand -hex 32 çıktısı>
SUPERADMIN_EMAILS=senin@epostan.com
SUPPORT_EMAIL=destek@markan.com
COMPANY_NAME=Şirket Unvanı
COMPANY_ADDRESS=Açık adres
SMTP_HOST=...   SMTP_USER=...   SMTP_PASS=...   MAIL_FROM=Markan <no-reply@markan.com>
ANTHROPIC_API_KEY=...   # ya da AI_PROVIDER + ilgili anahtar
```

> `APP_SECRET` kanal token'larını şifreler. Sonradan değiştirirsen bütün müşterilerin kanallarını yeniden bağlaması gerekir. Güvenli bir yerde sakla.

### 2.5 Başlat

```bash
docker compose up -d --build
```

Caddy sertifikayı birkaç saniye içinde alır. `https://panel.markan.com` açılmalı.

```bash
docker compose logs -f app      # uygulama günlüğü
docker compose ps               # durum (app "healthy" olmalı)
```

### 2.6 İlk giriş

`https://panel.markan.com/signup` adresinden kaydol. İlk hesap **süper yönetici** olur (sınırsız plan). Panelde **Süper admin** sayfası açılır: tüm çalışma alanları, kullanıcılar, planlar.

### 2.7 Güncelleme

```bash
git pull
docker compose up -d --build
```

Veritabanı değişiklikleri (migration) açılışta otomatik uygulanır.

### 2.8 Yedekler

Uygulama her gün veritabanının bir kopyasını `/data/backups` altına alır (`BACKUP_KEEP` kadar gün tutulur). Sunucu dışına almak için:

```bash
docker compose cp app:/data/backups ./yedekler
```

Bu klasörü düzenli olarak başka bir yere (bilgisayarın, S3, Backblaze) kopyala. Sunucu diski bozulursa tek kurtuluş budur.

---

## 3. Platform geliştirici panellerine girilecek adresler

`panel.markan.com` yerine kendi alan adını yaz. Panelde **Ayarlar > Sistem** bu adresleri kopyalanabilir halde gösterir.

| Platform | Ayar | Adres |
|---|---|---|
| Meta (Facebook + Instagram) | Valid OAuth Redirect URIs | `https://panel.markan.com/api/oauth/meta/callback` |
| Meta | Webhooks > Callback URL | `https://panel.markan.com/webhooks/meta` |
| Meta | App Settings > Basic > Data Deletion Request URL | `https://panel.markan.com/webhooks/meta/data-deletion` |
| Meta | Facebook Login > Deauthorize Callback URL | `https://panel.markan.com/webhooks/meta/deauthorize` |
| Meta | Privacy Policy URL / Terms of Service URL | `https://panel.markan.com/privacy` · `https://panel.markan.com/terms` |
| Threads | Redirect Callback URL | `https://panel.markan.com/api/oauth/threads/callback` |
| X | Callback URI | `https://panel.markan.com/api/oauth/x/callback` |
| LinkedIn | Authorized redirect URL | `https://panel.markan.com/api/oauth/linkedin/callback` |
| TikTok | Redirect URI | `https://panel.markan.com/api/oauth/tiktok/callback` |
| Google (YouTube) | Authorized redirect URI | `https://panel.markan.com/api/oauth/youtube/callback` |

Kullanıcıların veri silme talimatı için herkese açık sayfa: `https://panel.markan.com/data-deletion`.

---

## 4. Platform onayları (satış için şart)

Geliştirme modundaki bir uygulama yalnızca **senin ve uygulamaya rol olarak eklediğin** hesaplarla çalışır. Müşterilerin kendi hesaplarını bağlayabilmesi için her platformun inceleme sürecinden geçmen gerekir. Bu süreçler haftalar sürebilir; satışa başlamadan önce başlat.

| Platform | Gereken | Onay olmadan ne olur |
|---|---|---|
| **Meta** (Instagram, Facebook, Messenger) | İşletme doğrulaması (Business Verification) + App Review: kullandığın her izin için ekran kaydı ve açıklama, ardından uygulamayı **Live** moda al | Sadece uygulamada rolü olan hesaplar bağlanabilir |
| **Threads** | Threads izinleri için App Review | Sadece test kullanıcıları |
| **WhatsApp** | İşletme doğrulaması; müşteriler kendi numaralarını Phone Number ID + kalıcı token ile bağlar | Test numarası ile sınırlı |
| **TikTok** | Content Posting API denetimi (audit) | Paylaşımlar yalnızca "Sadece ben" gizliliğinde, günlük kullanıcı sınırı düşük |
| **YouTube** | Google OAuth doğrulaması (hassas kapsam: video yükleme) + gerekirse YouTube API kota artışı denetimi | 100 test kullanıcısı sınırı, yüklenen videolar gizli (private) kalır, günlük 10.000 kota birimi |
| **LinkedIn** | Kişisel profil için "Share on LinkedIn" yeterli; şirket sayfaları için Community Management API başvurusu | Sadece kişisel profile paylaşım |
| **X** | Ücretli API katmanı (Basic ve üstü) önerilir | Ücretsiz katmanda aylık gönderi sınırı çok düşük, DM okuma kapalı |
| **Telegram** | Onay gerekmez | – |

İnceleme başvurularında işine yarayacaklar:

- Gizlilik politikası ve kullanım şartları: `/privacy`, `/terms` (şirket bilgileri `.env`'den doldurulur)
- Veri silme: `/data-deletion` sayfası ve Meta'nın `signed_request` geri çağrısı hazır
- Ekran kaydında göster: kanal bağlama → gönderi oluşturma → zamanlama → yayınlanan gönderi → DM gelen kutusu

---

## 5. Yasal hazırlık

Uygulamadaki gizlilik ve kullanım şartları sayfaları genel bir şablondur. Satışa açmadan önce:

- **KVKK aydınlatma metni** ve gerekirse açık rıza metni hazırlat (müşterilerin sosyal medya verisi ve DM içerikleri işleniyor).
- Yurt dışı müşteri hedefliyorsan **GDPR** uyumu (veri işleme sözleşmesi, DPA).
- Ödeme almaya başladığında **mesafeli satış sözleşmesi** ve **ön bilgilendirme formu**.
- Metinleri bir hukukçuya kontrol ettir.

---

## 6. Planlar ve ödeme

Şu an ödeme sağlayıcısı bağlı değil; planlar elle atanır:

1. Müşteri kaydolur, `TRIAL_DAYS` gün boyunca `TRIAL_PLAN` planını dener.
2. Ödemeyi sen alırsın (havale, fatura, ödeme bağlantısı).
3. **Süper admin > Çalışma alanları** sayfasında müşteriyi bul, planı ve bitiş tarihini ayarla, ödeme referansını not et.
4. Plan süresi dolunca çalışma alanı otomatik olarak ücretsiz plana düşer.

Varsayılan planlar: **Free** (3 kanal, 30 gönderi/ay), **Pro** (19 $/ay, 10 kanal, 1000 gönderi/ay), **Agency** (59 $/ay, 50 kanal, 15 ekip üyesi), **Unlimited** (satış sayfasında görünmez, özel anlaşmalar için). Fiyat ve limitleri `PLANS_JSON` ile değiştirebilirsin (bkz. `.env.example`).

İleride otomatik ödeme için Stripe, Paddle, Lemon Squeezy ya da iyzico bağlanabilir; plan alanları (plan, bitiş tarihi, ödeme referansı) buna hazır.

---

## 7. Satış öncesi kontrol listesi

- [ ] Alan adı https ile açılıyor, **Ayarlar > Sistem**'de kırmızı uyarı yok
- [ ] `APP_SECRET` rastgele ve güvenli yerde yedekli
- [ ] SMTP çalışıyor: şifre sıfırlama e-postası geliyor
- [ ] `SUPPORT_EMAIL`, `COMPANY_NAME`, `COMPANY_ADDRESS` dolu; `/privacy` ve `/terms` sayfaları doğru görünüyor
- [ ] Her platform için redirect ve webhook adresleri girildi (bölüm 3)
- [ ] Meta işletme doğrulaması ve App Review başvuruları yapıldı
- [ ] TikTok ve Google denetim başvuruları yapıldı
- [ ] Her platformda kendi hesabınla bir gönderi uçtan uca yayınlandı
- [ ] Bir AI asistanı (Claude, ChatGPT, Gemini veya Grok) `https://panel.markan.com/mcp` adresiyle bağlandı ve plan kurdu
- [ ] Yedekler sunucu dışına kopyalanıyor
- [ ] `SIGNUP_MODE` istediğin gibi (açık kayıt, davetle ya da kapalı)

---

## 8. Müşterilere AI bağlantısını anlatmak

Herkese açık rehber sayfası: `https://panel.markan.com/docs/mcp`. Claude, ChatGPT, Gemini, Grok, Claude Code ve Cursor için adım adım talimat ve kopyalanabilir ayarlar içerir; satış sayfasından ve panelden bağlantı verilir.

Müşteri açısından akış:

1. AI uygulamasına `https://panel.markan.com/mcp` adresini ekler.
2. Açılan SosyalPilot ekranında giriş yapar, çalışma alanını seçer ve izin verir.
3. Sohbette "önümüzdeki hafta için 5 gönderilik plan kur" der; asistan gönderileri boş saatlere yerleştirir.
4. Onay modu açıksa gönderiler panelde onay bekler; değilse zamanı gelince yayınlanır.
5. Erişimi istediği an **Ayarlar > Bağlantılar**'dan kaldırabilir.
