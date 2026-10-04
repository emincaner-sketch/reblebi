# DESIGN.md — reblebi.com Giriş (Landing) Sayfası

> **Durum (2026-10-03):** Uygulandı: `web/src/landing/` (her bölüm ayrı bileşen, token'lar `landing.css` başında).
> Bilinçli sapmalar: `--text-subtle` metin için #7D8597 (kart zemininde AA 4.5:1; #6B7386 yalnızca ikon/çizgide),
> Pro rozeti "En popüler" yerine "Önerilen" (veri yok), "Demoyu izle" yerine "Nasıl çalışır?" (video yok),
> yorumlar bölümü ve güven şeridi sayıları gerçek veri gelene kadar kapalı. Logo: `web/src/components/Logo.tsx`.

> Kapsam: sadece herkese açık giriş sayfası (`/` ve `/en`). Panel bu dosyanın kapsamı dışında.
> Mevcut sitenin kimliği korunur (koyu tema, mor vurgu, Inter) — yeniden çizilen şey yapı, hiyerarşi, detay ve güven.

---

## 1. Mevcut tasarımın teşhisi

**İyi olanlar:** Net H1, iki CTA (birincil + ikincil), koyu tema tutarlı, mor vurgu dikkat çekiyor, fiyat bölümü şeffaf.

**Profesyonel görünmesini engelleyenler:**
1. **Hiç ürün görseli yok.** Ziyaretçi paneli görmeden karar veriyor. SaaS landing'lerinde en büyük güven unsuru ekran görüntüsüdür.
2. Platform simgeleri gerçek logo değil, renkli kutuda harf ("IG", "FB"...) — amatör izlenim veriyor.
3. Logo sadece "S" harfi + metin; marka işareti zayıf.
4. Özellikler 6 eşit kart, art arda — ritim yok, hepsi aynı ağırlıkta. En güçlü farkın (Claude/ChatGPT MCP bağlantısı) diğerleriyle aynı boyutta kayboluyor.
5. Sosyal kanıt yok (kullanıcı yorumu, logo, sayı, "nasıl çalışır").
6. Fiyat kartlarında olmayan özellikler (Ücretsiz planda "Onay akışı" vb.) dahil olanlarla neredeyse aynı görünüyor; aylık/yıllık geçişi yok.
7. SSS yok, final CTA yok, footer çok ince (3 link).
8. Mobilde hero'dan sonra kartlar uzun tek sütun — kaydırma yorucu.

---

## 2. Tasarım ilkeleri
- **Göster, anlatma:** her özellik bölümünde gerçek panel parçası (ekran görüntüsü / canlı mini-UI).
- **Tek odak:** her ekranda tek birincil eylem — "14 gün ücretsiz dene".
- **Sakin premium:** bol boşluk, ince kenarlıklar, yumuşak ışık efektleri; gösterişli gradient yığını yok.
- **Yerel güven:** Türkçe dil, ₺ yaklaşık karşılık notu, KVKK vurgusu, resmî API rozeti.

---

## 3. Tasarım belirteçleri (tokens)

```css
:root{
  /* Zemin */
  --bg:#0B0D12;          /* sayfa */
  --bg-elev:#12151C;     /* kart */
  --bg-elev-2:#181C25;   /* hover / iç kart */
  --border:#232836;
  --border-strong:#2E3445;

  /* Metin */
  --text:#F2F4F8;
  --text-muted:#A3ABBD;   /* AA kontrast ≥ 4.5 */
  --text-subtle:#6B7386;

  /* Marka */
  --primary:#6D5DFC;
  --primary-hover:#7F71FF;
  --primary-soft:rgba(109,93,252,.14);
  --accent:#22D3EE;       /* ikinci vurgu, çok az kullan */
  --success:#22C55E;
  --warning:#F59E0B;

  /* Tipografi */
  --font-sans:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-display:"Inter Display","Inter",sans-serif; /* opsiyonel: Geist / Satoshi */

  /* Ölçü */
  --radius-sm:8px; --radius:12px; --radius-lg:20px; --radius-xl:28px;
  --container:1200px;
  --shadow-glow:0 0 0 1px var(--border),0 20px 60px -20px rgba(109,93,252,.35);
}
```

**Tipografi ölçeği (masaüstü / mobil):**
| Kullanım | Boyut | Ağırlık | Satır yüksekliği | Letter-spacing |
|---|---|---|---|---|
| H1 | 64 / 40px | 700 | 1.05 | -0.03em |
| H2 | 44 / 30px | 700 | 1.1 | -0.02em |
| H3 | 22 / 19px | 600 | 1.3 | -0.01em |
| Gövde büyük | 20 / 17px | 400 | 1.6 | 0 |
| Gövde | 16px | 400 | 1.6 | 0 |
| Etiket (eyebrow) | 13px | 600 BÜYÜK HARF | 1 | 0.08em |

**Boşluk:** 4px tabanlı (4, 8, 12, 16, 24, 32, 48, 64, 96, 128). Bölümler arası masaüstü 128px, mobil 80px.
**Izgara:** 12 sütun, 24px boşluk, max 1200px. Mobil kenar boşluğu 20px.

---

## 4. Sayfa akışı (bölüm bölüm)

### 4.0 Duyuru şeridi (opsiyonel)
İnce üst bant: "Yeni: Claude, ChatGPT, Gemini ve Grok ile panelini yönet →" (/docs/mcp).

### 4.1 Navigasyon (sticky, cam efekti)
- Sol: yeni logo (simge + kelime). Orta: Özellikler · AI Bağlantısı · Fiyatlar · SSS. Sağ: TR/EN · Giriş (ghost) · **Ücretsiz dene** (primary).
- Kaydırınca: `backdrop-filter: blur(12px)`, alt kenarlık belirginleşir, yükseklik 72→60px.
- Mobil: hamburger → tam ekran menü, CTA en altta sabit.

### 4.2 Hero
- Eyebrow rozeti: "● 9 platform · Resmî API'ler".
- H1: **Sosyal medyanı tek panelden, AI ile yönet** (mevcut H1 iyi — kalsın; "AI ile" kısmı mor gradient metin).
- Alt metin (max 560px genişlik).
- CTA'lar: **14 gün ücretsiz dene** + **Demoyu izle ▶** (60 sn video veya etkileşimli tur). Altında küçük not: "Kredi kartı gerekmez · 2 dakikada kurulum" (doğruysa).
- **Ürün görseli:** hero'nun altında, hafif perspektifli (rotateX 8°) büyük panel ekran görüntüsü — takvim görünümü. Arkasında mor ışık halesi (radial gradient, %30 opaklık). Kaydırınca düzleşir (scroll-linked, `prefers-reduced-motion` ise statik).
- Platform logoları: gerçek marka SVG'leri (Simple Icons), gri tonlu, hover'da renkli.

### 4.3 Sosyal kanıt şeridi
"Ajanslar, e-ticaret markaları ve içerik üreticileri kullanıyor" + gerçek müşteri logoları ya da sayılar (planlanan gönderi, bağlı kanal). **Gerçek veri yoksa bu bölümü koyma** — yerine "Resmî Meta / TikTok / X API ortaklığı rozetleri" ve "KVKK uyumlu · Token'lar şifreli" güven rozetleri.

### 4.4 Problem → çözüm
İki sütun: solda "Önce" (9 sekme, kopyala-yapıştır, kaçan DM'ler — soluk, kırmızımsı ikonlar), sağda "Reblebi ile" (tek takvim, tek gelen kutusu — parlak). Kısa, 3'er madde.

### 4.5 Özellikler — Bento ızgarası
Eşit kartlar yerine farklı boyutlu bento (masaüstü 3 sütun):
| Kart | Boyut | İçerik |
|---|---|---|
| Tek panelden planla | 2×2 büyük | Mini takvim UI'ı, sürüklenebilir gönderi kartı animasyonu |
| Birleşik gelen kutusu | 1×2 dikey | IG/WhatsApp/Telegram mesaj balonları akışı |
| AI içerik ve planlama | 1×1 | "Brief → 2 haftalık takvim" yazılma animasyonu |
| Ekip ve onay akışı | 1×1 | Avatarlar + "Onay bekliyor" rozeti |
| Resmî API'ler | 1×1 | Kilit ikonu + OAuth akış şeması |
| Analitik | 1×1 | Mini çizgi grafik |

Kartlar: `--bg-elev`, 1px kenarlık, hover'da kenarlık mor ve imleci takip eden ışık (spotlight) efekti.

### 4.6 Öne çıkan: AI asistan bağlantısı (MCP) — en güçlü fark
Tam genişlik koyu bölüm, solda metin, sağda **sahte değil, temsilî** bir sohbet penceresi:
> Kullanıcı: "Gelecek haftaya 5 Instagram reels planla, boş saatlere yerleştir."
> Asistan: "5 gönderi oluşturuldu ve Salı–Cumartesi 19:00'a planlandı ✓"
Altında Claude · ChatGPT · Gemini · Grok rozetleri (logolar markaların kullanım kurallarına uygun, sadece "uyumlu" ifadesiyle) + "Kurulum rehberi →" linki.

### 4.7 Nasıl çalışır (3 adım)
1. Hesaplarını resmî OAuth ile bağla → 2. Brief ver veya içerik yükle → 3. Planla, yayınla, gelen kutusunu tek yerden yanıtla. Numaralı, yatay çizgiyle bağlı adımlar.

### 4.8 Kimler için (sekme)
Sekmeler: **İçerik üreticisi · E-ticaret · Ajans**. Her sekmede o kitleye özel 3 fayda + uygun plan önerisi.

### 4.9 Fiyatlar
- **Aylık / Yıllık** geçiş anahtarı ("2 ay bedava" rozeti — $190 = 10 ay × $19 ✓).
- Pro kartı vurgulu: mor kenarlık + "En popüler" rozeti + hafif büyütme (scale 1.03).
- Dahil olan özellik: ✓ yeşil, metin normal. Dahil olmayan: — gri, metin `--text-subtle`, üstü çizili değil.
- Her kartta en üstte "kimin için" tek satırı (ör. Ajans: "Birden fazla müşteri yöneten ekipler").
- Kartların altında: "Fiyatlar USD'dir. Ödeme anında güncel kurla ₺ olarak gösterilir." (doğruysa) ve tam karşılaştırma tablosu linki.

### 4.10 Yorumlar
Sadece **gerçek** kullanıcı yorumları (ad, rol, fotoğraf izniyle). Henüz yoksa bölümü ekleme; beta kullanıcılarından 3 yorum topla.

### 4.11 SSS
8 soru, accordion. Örnek: Hangi platformlar? · Şifremi istiyor musunuz? · Deneme bitince ne olur? · İptal edebilir miyim? · Verilerim nerede saklanıyor? · MCP nedir? · Ajans modu nasıl çalışır? · Kendi AI anahtarımı kullanabilir miyim?

### 4.12 Final CTA
Büyük, ortalı kart; mor ışıklı arka plan: "Bugün planla, yarın yayında." + birincil CTA.

### 4.13 Footer (4 sütun)
Ürün (Özellikler, Fiyatlar, AI bağlantısı, Değişiklik günlüğü) · Kaynaklar (Blog, Dokümanlar, Rehberler) · Şirket (Hakkında, İletişim) · Yasal (Gizlilik, Koşullar, Veri silme, KVKK aydınlatma). Altta sosyal medya simgeleri, TR/EN, © 2026.

---

## 5. Hareket (motion)
- Giriş animasyonları: 12px yukarıdan fade-in, 400ms, `cubic-bezier(.2,.8,.2,1)`, bölüm içinde 60ms gecikmeli sıralı.
- Sadece `transform` ve `opacity` animasyonu (performans).
- `@media (prefers-reduced-motion: reduce)` → tüm animasyonlar kapalı.
- Kütüphane: Framer Motion (zaten React) veya saf CSS + IntersectionObserver.

## 6. Erişilebilirlik
- Kontrast WCAG AA (gövde metni ≥ 4.5:1).
- Tüm etkileşimli öğelerde görünür `:focus-visible` halkası (2px mor, 2px offset).
- Dokunma hedefleri ≥ 44×44px.
- Görsellerde anlamlı `alt`; dekoratif olanlarda `alt=""`.
- Accordion ve sekmeler klavye ile kullanılabilir (ARIA).

## 7. Görsel varlık listesi
- [ ] Yeni logo (SVG simge + kelime, tek renk ve renkli sürüm)
- [ ] Panel ekran görüntüleri (2x, WebP/AVIF): takvim, gelen kutusu, AI üretim, onay ekranı, analitik
- [ ] Platform logoları (Simple Icons SVG)
- [ ] OG görseli 1200×630
- [ ] 60 sn demo videosu (sessiz, altyazılı, poster görselli)

## 8. Bitti kriterleri
- Lighthouse mobil: Performance ≥ 90, Accessibility ≥ 95, SEO = 100
- 375px, 768px, 1280px, 1440px genişlikte yatay kaydırma yok
- Hero LCP öğesi (ekran görüntüsü) `fetchpriority="high"` ve boyutları belirtilmiş
- Tüm metinler TR ve EN sözlükten geliyor
