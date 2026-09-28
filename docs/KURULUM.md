# Kurulum rehberi

Bu belge platform başına geliştirici uygulaması açmayı anlatır. Sunucuya kurulum, alan adı, e-posta ve satışa açma adımları için: [YAYIN.md](YAYIN.md).

Sırayla git. Her platform bağımsızdır: sadece kullanacaklarını yapılandır, gerisini boş bırak. Boş bırakılanlar panelde ".env eksik" görünür ve bağlanamaz.

---

## 0. Ön koşul: herkese açık https adresi

Bu şart **atlanamaz**:

- OAuth sağlayıcıları (Meta, TikTok, LinkedIn…) `redirect_uri` olarak https ister.
- Meta webhook'ları (DM'lerin gelmesi) dışarıdan erişilebilir bir adrese POST atar.
- Instagram, TikTok ve Threads **medyayı senin sunucundan çeker**: `http://localhost` adresinden görsel çekemezler.

### Yerelde test: tünel

```bash
# Cloudflare (kayıt gerekmez)
npx cloudflared tunnel --url http://localhost:4100
```

Çıkan `https://xxx.trycloudflare.com` adresini `.env` içine yaz:

```
PUBLIC_URL=https://xxx.trycloudflare.com
```

> Tünel adresi her yeniden başlatmada değişir; değişince `.env`'i güncelle ve sunucuyu yeniden başlat. Kalıcı kullanım için ngrok'un ücretli sabit alan adı ya da bir VPS daha rahat.

### Sunucuda

Hazır Docker + Caddy kurulumu var: alan adını yaz, `docker compose up -d --build` de, https kendiliğinden gelir. Adım adım: [YAYIN.md](YAYIN.md).

### Diğer temel değişkenler

```bash
API_PORT=4100
APP_SECRET=<openssl rand -hex 32 çıktısı>   # token şifreleme anahtarı: DEĞİŞTİRİRSEN tüm kanalları yeniden bağlaman gerekir
TZ=Europe/Istanbul
ANTHROPIC_API_KEY=sk-ant-...                # AI içerik + AI DM yanıtı için (ya da bölüm 8'deki diğer sağlayıcılar)
BRAND_MEMORY_DIR=../sistemler/marka-hafizasi/hafiza   # varsa marka dosyaların
```

Tüm değişkenlerin açıklamalı listesi `.env.example` dosyasında.

---

## 1. Meta: Instagram + Facebook + WhatsApp

Tek uygulama üçünü de kapsar.

### 1.1 Uygulama

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → tür: **Business**.
2. **App Settings > Basic**: App ID ve App Secret'ı kopyala.

```
META_APP_ID=...
META_APP_SECRET=...
META_WEBHOOK_VERIFY_TOKEN=kendi-belirledigin-rastgele-metin
```

### 1.2 Ürünler ve izinler

**Facebook Login for Business** ve **Instagram** ürünlerini ekle. Gerekli izinler (uygulama canlıya çıkarken App Review'dan geçmeli; geliştirme modunda kendi hesabında izinsiz çalışır):

`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`, `instagram_manage_insights`

### 1.3 Redirect URI

**Facebook Login for Business > Settings > Valid OAuth Redirect URIs**:

```
https://<PUBLIC_URL>/api/oauth/meta/callback
```

### 1.4 Webhook (DM'lerin gelmesi için)

**Webhooks** ürünü → her biri için abone ol:

| Nesne | Alan |
|---|---|
| Instagram | `messages` |
| Page | `messages` |
| WhatsApp Business Account | `messages` |

- **Callback URL:** `https://<PUBLIC_URL>/webhooks/meta`
- **Verify Token:** `.env` içindeki `META_WEBHOOK_VERIFY_TOKEN`

Panel > Ayarlar > Sistem sekmesinde bu iki değer kopyalanabilir halde durur.

### 1.4b Veri silme ve yetki kaldırma (canlıya çıkış için şart)

Meta, App Review'dan önce bu adresleri ister:

| Ayar | Adres |
|---|---|
| App Settings > Basic > **Data Deletion Request URL** | `https://<PUBLIC_URL>/webhooks/meta/data-deletion` |
| Facebook Login for Business > Settings > **Deauthorize Callback URL** | `https://<PUBLIC_URL>/webhooks/meta/deauthorize` |
| App Settings > Basic > **Privacy Policy URL** | `https://<PUBLIC_URL>/privacy` |
| App Settings > Basic > **Terms of Service URL** | `https://<PUBLIC_URL>/terms` |

Veri silme isteği `signed_request` ile doğrulanır; kullanıcıya bir onay kodu ve durum sayfası (`/data-deletion`) döner.

### 1.5 Instagram hesabı

Instagram hesabın **Professional (Business/Creator)** olmalı ve bir Facebook Sayfası'na bağlı olmalı. Ayrıca Instagram uygulamasında **Ayarlar > Mesajlar > Mesajlara bağlı araçlara erişim izni** açık olmalı, yoksa DM webhook'u gelmez.

### 1.6 Bağlama

Panel > Kanallar > **Instagram + Facebook**. İzin ekranında sayfalarını seçmeyi unutma. Her sayfa bir Facebook kanalı, bağlı Instagram hesabı ayrı bir Instagram kanalı olur.

### 1.7 WhatsApp (ayrı)

1. Meta App'e **WhatsApp** ürününü ekle.
2. **API Setup** ekranından **Phone Number ID** ve **WhatsApp Business Account ID**'yi al.
3. Kalıcı token: **Business Settings > System Users** → kullanıcı oluştur → **Generate token** → `whatsapp_business_messaging` + `whatsapp_business_management` izinleri, süre: **Never**.
4. Panel > Kanallar > **WhatsApp Business** → bu üç değeri gir.

> WhatsApp'ta 24 saatlik pencere kuralı vardır: müşteri yazmadan sen serbest metin gönderemezsin (onaylı şablon gerekir). Bu araç mevcut konuşmalara yanıt vermek için tasarlandı.

---

## 2. Threads

Threads, Meta uygulaması içinde **ayrı bir App ID/Secret** kullanır.

1. Meta App'e **Threads API** ürününü ekle.
2. **Threads > Settings**'ten Threads App ID ve Secret'ı al.

```
THREADS_APP_ID=...
THREADS_APP_SECRET=...
```

3. Redirect URI: `https://<PUBLIC_URL>/api/oauth/threads/callback`
4. İzinler: `threads_basic`, `threads_content_publish`, `threads_manage_insights`, `threads_manage_replies`

---

## 3. X (Twitter)

1. [developer.x.com](https://developer.x.com) → Project + App oluştur.
2. **User authentication settings**: OAuth 2.0 açık, App type: **Web App / Automated App**.
3. Callback URI: `https://<PUBLIC_URL>/api/oauth/x/callback`
4. Kapsamlar: `tweet.read tweet.write users.read offline.access media.write` (+ DM için `dm.read dm.write`)

```
X_CLIENT_ID=...
X_CLIENT_SECRET=...
```

> **DM uyarısı:** DM okuma Free katmanda kapalıdır (Basic ve üzeri gerekir). Bu yüzden X kanallarında DM taraması varsayılan olarak **kapalıdır**; Kanallar sayfasındaki kanal kartından "DM tara" kutusuyla açarsın.

---

## 4. LinkedIn

1. [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → uygulama oluştur (bir Şirket Sayfası'na bağlanır).
2. **Products**: "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" ekle.
3. Redirect URL: `https://<PUBLIC_URL>/api/oauth/linkedin/callback`

```
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
```

**Şirket sayfası adına paylaşım** için LinkedIn'in **Community Management API** onayı gerekir. Onay aldıysan kapsamları genişlet:

```
LINKEDIN_SCOPES=openid profile w_member_social r_organization_social w_organization_social rw_organization_admin
```

---

## 5. TikTok

1. [developers.tiktok.com](https://developers.tiktok.com) → App oluştur, **Content Posting API** ekle.
2. Redirect URI: `https://<PUBLIC_URL>/api/oauth/tiktok/callback`
3. Kapsamlar: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.publish`, `video.upload`

```
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
```

> **Önemli:** Uygulaman TikTok denetiminden geçene kadar yalnızca **"Sadece ben" (SELF_ONLY)** gizlilikle paylaşım yapabilir; herkese açık paylaşım API hatası döner. Fotoğraf gönderileri için ayrıca alan adını (`PUBLIC_URL`) TikTok panelinde **URL Properties** altında doğrulamalısın.

---

## 6. YouTube

1. [console.cloud.google.com](https://console.cloud.google.com) → proje oluştur.
2. **YouTube Data API v3**'ü etkinleştir.
3. **OAuth consent screen**: External, test kullanıcısı olarak kendi Google hesabını ekle.
4. **Credentials > Create Credentials > OAuth client ID** → Web application.
5. Authorized redirect URI: `https://<PUBLIC_URL>/api/oauth/youtube/callback`

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

> Doğrulanmamış uygulamada yüklenen videolar **kilitli private** olur (herkese açık yapılamaz). Kanalını doğrulamak ve uygulamayı Google denetiminden geçirmek gerekir. Test için `privacyStatus: private` ile çalış.

---

## 7. Telegram

Env gerekmez.

1. Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot` → token al.
2. Botu kanalına/grubuna **yönetici** olarak ekle (mesaj gönderme yetkisiyle).
3. Panel > Kanallar > **Telegram** → bot token + kanal (`@kanaladi` ya da `-100...` id) gir.

Bota özel mesaj yazan kullanıcılar gelen kutusunda görünür.

---

## 8. AI sağlayıcısı

Paneldeki AI özellikleri (içerik üretimi, kampanya planı, AI DM yanıtı) için platform genelinde bir sağlayıcı seç:

```
AI_PROVIDER=anthropic        # anthropic | openai | xai | gemini | openrouter | custom
AI_MODEL=                    # boşsa sağlayıcının varsayılanı
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=  XAI_API_KEY=  GEMINI_API_KEY=  OPENROUTER_API_KEY=
# AI_CUSTOM_BASE_URL=  AI_CUSTOM_API_KEY=   (OpenAI uyumlu herhangi bir uç nokta)
```

| Sağlayıcı | Anahtar nereden | Varsayılan model |
|---|---|---|
| Anthropic (Claude) | console.anthropic.com | `claude-opus-5` |
| OpenAI | platform.openai.com | `gpt-5` |
| xAI (Grok) | console.x.ai | `grok-4` |
| Google Gemini | aistudio.google.com | `gemini-2.5-pro` |
| OpenRouter | openrouter.ai | `anthropic/claude-opus-5` |

Anahtar yoksa panel çalışır, sadece AI düğmeleri kapalıdır. Pro ve üstü plandaki müşteriler **Ayarlar > AI** sekmesinden kendi anahtarlarını girebilir; o zaman senin kotan harcanmaz. **Ayarlar > AI > Bağlantıyı test et** ile anahtarın çalıştığını doğrula.

**Marka hafızası:** `BRAND_MEMORY_DIR` bir klasörü gösterirse (`01-marka-kimlik.md`, `02-ses.md`, `03-kararlar.md`) içerikleri her AI üretiminin sistem promptuna eklenir. Dosyalar doldurulmamış şablon halindeyse atlanır. Alternatif olarak Panel > Ayarlar > Marka sekmesinden doldurabilirsin; ikisi birleştirilir.

---

## 9. MCP: Claude, ChatGPT, Gemini, Grok ile bağlanma

SosyalPilot uzak bir MCP sunucusudur: adres `https://<PUBLIC_URL>/mcp`. AI uygulamasına bu adresi eklemek yeterli; bağlanırken SosyalPilot giriş ve onay ekranı açılır (OAuth 2.1). Ayrıntılı, istemci başına rehber panelde **Ayarlar > API / MCP** ve herkese açık `/docs/mcp` sayfasında.

Claude Code (terminal):

```bash
claude mcp add --transport http sosyalpilot https://<PUBLIC_URL>/mcp
```

Tarayıcısız ortamlar için API anahtarı: Panel > Ayarlar > **API / MCP** → anahtar oluştur (`sp_...`, bir kere gösterilir), istemcide `Authorization: Bearer sp_...` başlığı olarak ver.

**Yerel geliştirme:** proje kökündeki `.mcp.json` stdio köprüsünü kullanır (`npm run mcp`); `.env`'e `SOSYALPILOT_API_KEY=sp_...` ekleyip Claude Code'u proje klasöründe açman yeterli. Köprü istekleri `http://localhost:4100/mcp` adresine iletir.

> Claude.ai, ChatGPT ve Gemini gibi bulut istemcileri `localhost`'a erişemez. Onlarla denemek için sunucuyu https bir adrese koy ya da tünel kullan (bölüm 0).

---

## 10. Doğrulama

| Kontrol | Nerede |
|---|---|
| PUBLIC_URL https mi | Ayarlar > Sistem (kırmızı uyarı yoksa tamam) |
| E-posta gidiyor mu | Çıkış yap > "Şifremi unuttum" (SMTP yoksa bağlantı sunucu günlüğüne yazılır) |
| AI anahtarı çalışıyor mu | Ayarlar > AI > Bağlantıyı test et |
| MCP bağlanıyor mu | Bir AI uygulamasına `/mcp` adresini ekle; Ayarlar > Bağlantılar'da görünmeli |
| Platform anahtarları tanımlı mı | Ayarlar > Sistem > Platform yapılandırması |
| Kanal token'ı geçerli mi | Kanallar > kanal kartındaki yenile simgesi |
| Webhook geliyor mu | Ayarlar > Sistem > Son webhook olayları |
| Kural çalışıyor mu | Gelen Kutusu > **Test mesajı** |
| Yayın çalışıyor mu | Composer > taslak oluştur > **Şimdi yayınla** (önce tek kanalla dene) |

---

## Sık karşılaşılan hatalar

| Hata | Sebep / çözüm |
|---|---|
| `Invalid OAuth access token (kod 190)` | Token süresi dolmuş ya da iptal edilmiş. Kanalı silip yeniden bağla. |
| `(#10) Application does not have permission for this action` | App Review'dan geçmemiş izin. Geliştirme modunda uygulamanın rol listesinde olan hesapla dene. |
| Instagram: `The image/video you are trying to upload is not accessible` | `PUBLIC_URL` https değil ya da dışarıdan erişilemiyor. Tüneli kontrol et. |
| TikTok: `privacy_level_option_mismatch` | Denetimden geçmemiş uygulama; gizliliği "Sadece ben" yap. |
| YouTube: yüklenen video private kalıyor | Google doğrulaması tamamlanmamış. |
| Webhook doğrulaması başarısız | `META_WEBHOOK_VERIFY_TOKEN` ile Meta panelindeki değer birebir aynı olmalı. |
| DM geliyor ama yanıt gitmiyor | Instagram'da "bağlı araçlara mesaj erişimi" kapalı olabilir; 24 saatlik yanıt penceresi dolmuş olabilir. |
