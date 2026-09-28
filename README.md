# SosyalPilot

Çok platformlu sosyal medya yönetim platformu (SaaS). Gönderi ve hikaye paylaşır, DM'leri otomatik yanıtlar. İçerik takvimini ister panelden ister **Claude, ChatGPT, Gemini veya Grok** ile konuşarak kurarsın: AI asistanı MCP ile doğrudan bağlanır, gönderileri boş saatlere yerleştirir, SosyalPilot da zamanı gelince paylaşır. Arada Zapier gibi bir araca gerek yoktur.

9 platform: **Instagram, Facebook Sayfası, Threads, WhatsApp Business, X (Twitter), LinkedIn, TikTok, YouTube, Telegram.**

---

## Ne yapar

| Yetenek | Ayrıntı |
|---|---|
| **Gönderi ve hikaye** | Tek metin, çok kanal; kanal başına metin özelleştirme. Görsel, carousel, video, Reels/Shorts, Instagram ve Facebook hikayesi, X ve Threads zinciri, ilk yorum. |
| **Takvim** | Ay, hafta ve liste görünümü. Sürükle-bırak ile yeniden zamanlama, kanal başına paylaşım saatleri, "sıradaki boş saate koy", tekrarlayan gönderiler. |
| **AI ile planlama** | Konu ver, AI haftalık/aylık kampanya planı çıkarsın; gönderiler boş saatlere dağıtılır. Platform başına uyarlanmış metin, kanca alternatifleri, görsel yönergesi. |
| **MCP (uzak)** | `https://alanadin.com/mcp` adresi Claude, ChatGPT, Gemini, Grok, Cursor ve Claude Code'a eklenir. OAuth 2.1 ile giriş ve onay; 33 araç, 2 hazır komut. |
| **Onay akışı** | Onay modu: kapalı, sadece AI'nın hazırladıkları, hepsi. Müşteriye giriş gerektirmeyen önizleme bağlantısı. |
| **DM otomasyonu** | Instagram DM, Messenger, WhatsApp, Telegram, X. Kural motoru (anahtar kelime, regex, ilk temas) ve marka sesiyle AI yanıtı; şikayette insana devir. |
| **Ekip ve müşteriler** | Çalışma alanları, roller (sahip, yönetici, editör, izleyici), davet, müşteri/marka grupları. |
| **SaaS altyapısı** | Kayıt, e-posta doğrulama, şifre sıfırlama, planlar ve kotalar (Free, Pro, Agency, Unlimited), deneme süresi, süper yönetici paneli. |
| **Seçilebilir AI** | Anthropic (Claude), OpenAI, xAI (Grok), Google Gemini, OpenRouter veya OpenAI uyumlu herhangi bir uç nokta. Müşteri kendi anahtarını da girebilir. |
| **Entegrasyon** | İmzalı giden webhook'lar, REST API, API anahtarları, e-posta bildirimleri. |
| **Dil** | Türkçe ve İngilizce arayüz, e-postalar ve hata mesajları. |

---

## Hızlı başlangıç (kendi bilgisayarında)

En kolayı: **`baslat.cmd`** dosyasına çift tıkla. Bağımlılıkları kurar, `.env` yoksa oluşturur, sunucuyu başlatır ve tarayıcıyı açar.

Elle çalıştırmak istersen her komutu **ayrı satıra** yaz:

```powershell
cd "C:\Users\Mehmet Em\Desktop\Projeler\sosyalpilot"
```
```powershell
npm install
```
```powershell
npm run dev
```

> **Windows PowerShell 5.1 uyarısı:** `&&` ile birleştirilmiş komutlar bu sürümde çalışmaz (`The token '&&' is not a valid statement separator`). Komutları ayrı satırlarda çalıştır ya da `;` kullan.

- Panel: http://localhost:5173
- API ve MCP: http://localhost:4100 (MCP adresi: http://localhost:4100/mcp)

İlk kaydolan hesap **süper yönetici** olur ve sınırsız plana sahip olur. Ardından **Kanallar** sayfasından hesapları bağla.

Üretim modunda (tek port 4100'den panel + API + MCP):

```powershell
.\baslat.ps1 -Uretim
```

### Durdurma

Çalıştığı terminalde **Ctrl+C**. Terminal kapandıysa ve port hâlâ meşgulse:

```powershell
Get-NetTCPConnection -LocalPort 4100,5173 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

---

## Sunucuya kurulum ve satışa açma

Docker + Caddy ile tek komutta HTTPS'li kurulum, platform onayları, yasal sayfalar ve satış öncesi kontrol listesi: **[docs/YAYIN.md](docs/YAYIN.md)**.

Platform başına uygulama açma ve izinler: **[docs/KURULUM.md](docs/KURULUM.md)**.

---

## AI asistanını bağlama (MCP)

Panelde **Ayarlar > API / MCP** ve herkese açık **/docs/mcp** sayfasında her istemci için adım adım rehber var. Kısaca:

| İstemci | Nasıl |
|---|---|
| Claude (web/masaüstü) | Ayarlar > Connectors > Add custom connector > `https://alanadin.com/mcp` |
| ChatGPT | Ayarlar > Apps & Connectors > Create > OAuth + sunucu adresi |
| Gemini CLI | `~/.gemini/settings.json` içine `{"mcpServers":{"sosyalpilot":{"httpUrl":"https://alanadin.com/mcp"}}}`, sonra `/mcp auth sosyalpilot` |
| Grok | Grok Build'de MCP sunucusu olarak ekle ya da xAI API'nin uzak MCP aracına `server_url` + API anahtarı ver |
| Claude Code | `claude mcp add --transport http sosyalpilot https://alanadin.com/mcp` |
| Cursor | `~/.cursor/mcp.json` içine `{"mcpServers":{"sosyalpilot":{"url":"https://alanadin.com/mcp"}}}` |
| Sadece stdio destekleyenler | `npx -y mcp-remote https://alanadin.com/mcp` |

Bağlanırken SosyalPilot giriş ve onay ekranı açılır. Kullanıcı hangi çalışma alanına erişim vereceğini seçer; şifre ya da anahtar paylaşmaz. Tarayıcı açamayan ortamlarda `Authorization: Bearer sp_...` başlığıyla API anahtarı kullanılır.

**Araçlar (33):** `get_workspace_context`, `list_channels`, `find_free_slots`, `validate_post`, `schedule_post`, `schedule_posts_batch`, `get_calendar`, `list_posts`, `get_post`, `update_post`, `reschedule_post`, `publish_now`, `cancel_post`, `duplicate_post`, `delete_post`, `list_campaigns`, `schedule_campaign`, `ai_plan_campaign`, `import_media`, `list_media`, `list_tags`, `generate_content`, `list_conversations`, `get_conversation`, `reply_conversation`, `draft_reply`, `set_conversation`, `list_rules`, `create_rule`, `update_rule`, `delete_rule`, `get_analytics`, `get_dashboard`.

**Hazır komutlar:** `weekly_plan` (haftalık içerik planı), `inbox_triage` (gelen kutusu önceliklendirme).

Asistanın tipik akışı: çalışma alanını okur (kanallar, saat dilimi, paylaşım saatleri, kotalar) → boş saatleri bulur → planı deneme modunda doğrular (karakter sınırı, zorunlu medya, geçmiş tarih) → onayınla tek seferde kampanya olarak kaydeder → SosyalPilot zamanı gelince paylaşır.

Örnek istekler:

> "Önümüzdeki iki hafta için Instagram ve LinkedIn'e haftada üç gönderilik bir plan hazırla, boş saatlere yerleştir."
> "Yarın 10:00'da Telegram kanalına şu duyuruyu paylaş: ..."
> "Gelen kutusunda dikkat bekleyen konuşmaları özetle ve yanıt taslakları hazırla."

---

## Mimari

```
sosyalpilot/
├── server/                   API + zamanlayıcı + DM motoru + uzak MCP + OAuth sunucusu
│   ├── src/
│   │   ├── core/             config, SQLite (node:sqlite) + migration'lar, planlar, i18n, şifreleme, repos/
│   │   ├── providers/        platform adaptörleri (ortak Provider sözleşmesi), meta/
│   │   ├── ai/               sağlayıcı katmanı (Anthropic, OpenAI uyumlu) + içerik/plan/yanıt üretimi
│   │   ├── services/         publisher, scheduler, slots, planner, dm-engine, access, limits, mailer, notify…
│   │   ├── api/              Fastify sunucusu ve rotalar (auth, org, channels, posts, campaigns, inbox, admin, mcp…)
│   │   └── mcp/              MCP araçları (tools.ts) + stdio köprüsü (main.ts)
│   └── test/                 birim, migration ve uçtan uca testler (npm test)
├── web/                      React 19 + Vite paneli (TR/EN)
│   └── src/pages/            panel sayfaları + public/ (satış, fiyat, giriş, onay, yasal, MCP rehberi)
├── deploy/Caddyfile          HTTPS ters vekil
├── Dockerfile, docker-compose.yml
└── docs/                     KURULUM.md (platformlar), YAYIN.md (sunucu + satış)
```

**Tasarım kararları**

- **Kendi motoru.** Postiz gibi bir aracıya bağlı değil; her platformun resmî API'siyle doğrudan konuşur. Token'lar AES-256-GCM ile şifreli saklanır.
- **Tek süreç, tek dosya veritabanı.** Node 22+ yerleşik `node:sqlite` (WAL). Postgres, Redis, kuyruk sunucusu yok; günlük otomatik yedek.
- **Çok kiracılı.** Her kayıt bir çalışma alanına bağlı; roller ve plan kotaları her istekte (panel, REST, MCP) aynı servis katmanında denetlenir.
- **Hedef bazlı yayın.** Bir gönderi N hedefe açılır; biri başarısız olursa yalnızca o hedef üstel geri çekilmeyle tekrar denenir.
- **AI'ya güvenli yetki.** MCP araçları kullanıcının rolüyle çalışır; onay modu açıksa AI'nın hazırladığı gönderiler insan onayı bekler.

---

## Geliştirme

```powershell
npm test -w server          # 46 test: birim, migration, uçtan uca (API + MCP + OAuth)
```
```powershell
npm run typecheck
```
```powershell
npm run i18n:check -w web   # arayüzdeki her metnin İngilizce karşılığı var mı
```

---

## Güvenlik

- Kanal token'ları `APP_SECRET`'tan türetilen anahtarla AES-256-GCM ile şifrelenir; panel ve MCP yanıtlarında yer almaz.
- Oturum çerezleri ve API anahtarları yalnızca SHA-256 özetiyle saklanır; çerezli isteklerde köken (CSRF) denetimi yapılır.
- MCP için OAuth 2.1: PKCE (S256), dinamik istemci kaydı, yenileme token'ı rotasyonu ve yeniden kullanım tespiti.
- Meta webhook'ları `X-Hub-Signature-256` ile, veri silme istekleri `signed_request` ile doğrulanır.
- Medya içe aktarmada SSRF koruması (özel ağ adreslerine istek atılmaz); istek hızı sınırlaması; güvenlik başlıkları (helmet).
- Üretimde varsayılan `APP_SECRET` ile sunucu başlamaz.
