# SosyalPilot

Çok platformlu sosyal medya otomasyonu: **tek panelden** gönderi ve hikaye paylaş, DM'leri otomatik yanıtla, her şeyi Claude ile üret ve MCP üzerinden ajanlara açtır.

9 platform: **Instagram, Facebook Sayfası, Threads, WhatsApp Business, X (Twitter), LinkedIn, TikTok, YouTube, Telegram.**

---

## Ne yapar

| Yetenek | Nasıl |
|---|---|
| **Gönderi paylaşımı** | Tek metin, çok kanal. Kanal başına metin ve platform ayarı özelleştirilebilir. Görsel, carousel, video. |
| **Hikaye (Story)** | Instagram ve Facebook Sayfası hikayeleri (görsel + video). |
| **Reels / kısa video** | Instagram Reels, Facebook Reels, TikTok, YouTube Shorts. |
| **Zincir (thread)** | X ve Threads için `---` ile ayrılmış çok parçalı gönderi; otomatik yanıt zinciri kurar. |
| **Zamanlama** | Takvim görünümü, dakika hassasiyetinde planlama, başarısız hedefler için üstel geri çekilmeli otomatik tekrar. |
| **DM otomasyonu** | Instagram DM, Messenger, WhatsApp, Telegram (webhook) + X (polling). Kural motoru: anahtar kelime, regex, ilk temas, her mesaj. |
| **AI yanıt** | Kural eşleşmezse ya da kural "AI" modundaysa Claude marka sesiyle yanıtlar; şikayet/karmaşık durumda insana devreder. |
| **AI içerik üretimi** | Konu ver, her platform için ayrı optimize metin + 3 alternatif kanca + görsel yönergesi üretir. Marka hafızasını okur. |
| **Analitik** | Kanal başına takipçi serisi, yayın başarı oranı, otomatik yanıt oranı. |
| **MCP sunucusu** | 25+ araç: Claude Code / Claude Desktop / Cursor doğrudan gönderi oluşturur, DM yanıtlar, kural yazar. |

---

## Hızlı başlangıç

```bash
cd "C:\Users\Mehmet Em\Desktop\Projeler\sosyalpilot"
npm install
```

`.env` dosyasını doldur (bkz. [docs/KURULUM.md](docs/KURULUM.md)), sonra:

```bash
npm run dev
```

- Panel: http://localhost:5173
- API: http://localhost:4100

İlk açılışta yönetici hesabını oluşturursun. Ardından **Kanallar** sayfasından hesapları bağla.

Üretim için:

```bash
npm run build
npm start
```

Tek port (4100) üzerinden hem panel hem API servis edilir.

---

## Mimari

```
sosyalpilot/
├── server/                   API + zamanlayıcı + DM motoru + MCP
│   └── src/
│       ├── core/             config, SQLite (node:sqlite), şifreleme, tipler, marka hafızası
│       │   └── repos/        channels, posts, inbox, misc (kullanıcı/medya/kural/ayar/analitik)
│       ├── providers/        her platform için adaptör (ortak Provider sözleşmesi)
│       │   └── meta/         facebook, instagram, threads, whatsapp, webhook ayrıştırıcı
│       ├── ai/               Claude ile içerik üretimi ve DM yanıt taslağı
│       ├── api/              Fastify rotaları + servisler (publisher, dm-engine, scheduler)
│       └── mcp/              MCP stdio sunucusu
├── web/                      React + Vite paneli (Türkçe)
│   └── src/pages/            Panel, Kanallar, Gönderiler, Composer, Gelen Kutusu, Otomasyon, Analitik, Ayarlar
├── data/                     SQLite veritabanı + yüklenen medya (git'e girmez)
└── docs/KURULUM.md           platform başına kurulum rehberi
```

**Tasarım kararları**

- **Kendi motoru.** Postiz gibi bir aracıya bağlı değil; her platformun resmî API'sine doğrudan konuşur. Token'lar AES-256-GCM ile şifreli saklanır.
- **Sıfır dış bağımlılık (veritabanı).** Node 22+ yerleşik `node:sqlite`. Docker, Postgres, Redis yok.
- **Hedef bazlı yayın.** Bir gönderi N hedefe açılır; biri patlarsa diğerleri etkilenmez, sadece o hedef tekrar denenir (`partial` durumu).
- **Provider sözleşmesi.** Yeni platform eklemek = `Provider` arayüzünü uygulayan tek dosya + kayıt satırı.

---

## Platform notları

| Platform | Gönderi | Hikaye | Reel | DM | Not |
|---|---|---|---|---|---|
| Instagram | ✓ | ✓ | ✓ | webhook | Medya **herkese açık URL**'den çekilir → `PUBLIC_URL` https olmalı |
| Facebook Sayfası | ✓ | ✓ | ✓ | webhook | Instagram ile aynı Meta OAuth akışı |
| Threads | ✓ | – | – | – | 500 karakter; zincir destekli |
| WhatsApp | – | – | – | webhook | Sadece mesajlaşma; Phone Number ID + kalıcı token |
| X (Twitter) | ✓ | – | ✓(video) | polling | DM okuma/yazma ücretli API katmanı ister; kanal kartından "DM tara" ile açılır |
| LinkedIn | ✓ | – | – | – | Şirket sayfası için Community Management onayı + `LINKEDIN_SCOPES` |
| TikTok | ✓ | – | ✓ | – | Denetimden geçmemiş uygulama yalnızca `SELF_ONLY` paylaşabilir |
| YouTube | – | – | ✓ | – | Video + başlık zorunlu; Shorts için dikey video |
| Telegram | ✓ | – | – | polling | Bot token; kanala yönetici olarak eklenmeli |

---

## MCP ile kullanım

Panel > Ayarlar > API/MCP'den anahtar oluştur, `.env`'e `SOSYALPILOT_API_KEY=sp_...` ekle. Proje kökündeki `.mcp.json` hazır; Claude Code'u bu klasörde açman yeterli.

Örnek istekler:

> "Instagram ve Telegram'a yarın 10:00 için yeni ürün duyurusu hazırla, metni sen yaz."
> "Gelen kutusunda dikkat bekleyen konuşmaları özetle."
> "Kargo sorularına otomatik yanıt veren bir kural ekle."

Araçlar: `list_channels`, `create_post`, `list_posts`, `publish_post_now`, `cancel_post`, `import_media`, `list_conversations`, `reply_conversation`, `draft_reply`, `set_conversation`, `inbox_summary`, `create_rule`, `generate_content`, `analytics_overview`, `dashboard`, `update_settings`, `system_info` ve diğerleri.

---

## Güvenlik

- Kanal token'ları `APP_SECRET`'tan türetilen anahtarla AES-256-GCM ile şifrelenir; panel ve MCP yanıtlarında asla yer almaz.
- Meta webhook'ları `X-Hub-Signature-256` ile doğrulanır.
- Oturum çerezi HMAC ile imzalanır; API anahtarları yalnızca SHA-256 özetiyle saklanır.
- OAuth `state` tek kullanımlıktır, 1 saat sonra silinir; X ve TikTok için PKCE kullanılır.
