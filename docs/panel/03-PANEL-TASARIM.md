# 03 · Panel tasarımı

> Hedef: Metricool kadar düzenli ve ölçülebilir, ama Reblebi'nin kendi dilinde bir panel.
> Kaynaklar: `01-METRICOOL-INCELEME.md` (kalıplar), `web/BRAND_DECISIONS.md` (marka), görselleştirme kuralları (tek eksen, ince işaretler, tablo görünümü).
> Uygulama: `web/src/styles.css` (token'lar), `web/src/components/Shell.tsx` (kabuk), `web/src/panel/` (grafik kiti ve analitik).

## 1. İlkeler

1. **Önce sayı, sonra grafik.** Her bölüm bir KPI ile açılır; grafik o sayının hikâyesini anlatır.
2. **Tek filtre satırı.** Dönem ve karşılaştırma sayfanın en üstünde; altındaki her şey aynı dilimi gösterir.
3. **Dürüst veri.** Platformun vermediği metrik "API vermiyor", bağlantıdan önceki dönem "kanal bağlandığı günden itibaren" diye yazılır; boş grafik sıfır gibi çizilmez.
4. **Tek eksen.** Metricool'daki çift eksenli çubuk + çizgi yerine aynı zaman ekseninde alt alta küçük grafikler.
5. **Her grafiğin tablo karşılığı var.** Renk körlüğü, ekran okuyucu ve CSV için.
6. **Sakin yüzey, yüksek kontrast.** Pastel kutu yerine beyaz kart + mürekkep metin; renk yalnızca veri işaretinde.

## 2. Token'lar

Açık tema **varsayılan**, koyu tema sağ üst menüden seçilir (`localStorage: sp_theme`).

| Rol | Açık | Koyu | Not |
|---|---|---|---|
| `--bg` sayfa | `#f3f1ec` | `#0f0e15` | Sitenin sıcak nötrüyle akraba, veri yoğunluğu için bir ton serin |
| `--bg-2` kart | `#ffffff` | `#1b1926` | Grafik yüzeyi |
| `--bg-3` ikincil dolgu | `#f6f4f0` | `#232032` | Tablo başlığı, segment |
| `--border` / `--border-2` | `#e6e1d8` / `#d6cfc2` | `#2e2a3d` / `#3d3850` | Kılçık çizgi |
| `--text` / `--text-2` / `--text-3` | `#1a1726` / `#3a3548` / `#5e5970` | `#f4f1ea` / `#cfc9da` / `#a39db4` | `--text-3` beyaz kartta ≈ 6.4:1 |
| `--accent` (düğme) | `#5b49f2` | `#6d5dfc` | Logo moru |
| `--accent-2` (bağlantı metni) | `#4b39e0` | `#a99fff` | |
| Üst çubuk | `#13111c` zemin, `#f4f1ea` metin | aynı | Sitenin koyu yüzeyi; alt kenarda 2px leblebi `#d9a441` çizgisi |
| Durum: iyi / uyarı / hata / bilgi | `#1f7a45` / `#9a5b00` / `#b42318` / `#1d5fa8` | `#4ade80` / `#fbbf24` / `#f87171` / `#7cb8f5` | Her zaman ikon + metinle |

**Grafik paleti (kategorik, sabit sıra; doğrulayıcıdan geçti):**

| Sıra | Açık | Koyu |
|---|---|---|
| 1 mor | `#5b49f2` | `#9085e9` |
| 2 turuncu | `#eb6834` | `#d95926` |
| 3 su yeşili | `#1baf7a` | `#199e70` |
| 4 sarı | `#eda100` | `#c98500` |
| 5 pembe | `#e87ba4` | `#d55181` |
| 6 yeşil | `#008300` | `#008300` |
| 7 mavi | `#2a78d6` | `#3987e5` |
| 8 kırmızı | `#e34948` | `#e66767` |

- Doğrulama (`validate_palette.js`): açık zeminde (`#ffffff`) tüm kontroller geçti, en kötü komşu renk körlüğü farkı ΔE 9.1. Koyu zeminde (`#1b1926`) tüm kontroller geçti, ΔE 8.4. Açık zeminde 3 renk 3:1'in altında kalıyor; bu yüzden etiket ve tablo görünümü zorunlu.
- **Renk ağı izler, sırayı değil**: Instagram hep 1, Facebook hep 2… (sabit sağlayıcı sırası `web/src/panel/charts/palette.ts`). Filtre değişince renkler kaymaz.
- Ağ logosu her zaman renkli işaretin yanında durur (ikincil kodlama).
- Isı haritası: tek renk (mor) açıktan koyuya, ölçek göstergesiyle.

Tipografi: metin ve tüm sayılar **Inter**; sayfa başlıkları **Bricolage Grotesque** (marka). Tablo sütunları ve eksenler `tabular-nums`, büyük sayılar orantılı rakam.

## 3. Kabuk ve gezinme

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [r] Çalışma alanı ▾ │ Panel  Analitik  Planlama  Gelen kutusu•3  Otomasyon │ [+ Yeni gönderi] 🔔 ☾ (A) │  ← koyu üst çubuk
├───────────────┬────────────────────────────────────────────────────────────┤  ← 2px leblebi çizgisi
│ bağlamsal     │  Sayfa başlığı                       filtre satırı         │
│ sol menü      │  ───────────────────────────────────────────────────────── │
│ (bölüme göre) │  içerik                                                     │
└───────────────┴────────────────────────────────────────────────────────────┘
```

| Üst bölüm | Rotalar | Sol menü |
|---|---|---|
| Panel | `/app` | yok (tam genişlik) |
| Analitik | `/app/analytics` | Özet · bağlı ağlar (ikon + ad; `?network=`) |
| Planlama | `/app/posts`, `/app/posts/new`, `/app/posts/:id`, `/app/campaigns`, `/app/media` | Takvim ve liste · Kampanyalar · Medya |
| Gelen kutusu | `/app/inbox` | yok (sayfa iki panelli) |
| Otomasyon | `/app/automation` | yok (sayfa sekmeli) |
| Hesap (sağ üst menü) | `/app/channels`, `/app/team`, `/app/billing`, `/app/settings`, `/app/admin` | Kanallar · Ekip · Plan ve kullanım · Ayarlar · Süper admin |

- **Sağ üst menü** (avatar): ad, e-posta · Kanallar · Ekip · Plan ve kullanım · Ayarlar · (Süper admin) · Dil TR/EN · Çıkış. Metricool'un hamburger menüsünün karşılığı.
- Rozetler: Gelen kutusu (dikkat/okunmamış), Planlama (onay bekleyen, yöneticiye), Kanallar (sorunlu kanal).
- Mobil (<900px): üst çubukta logo + çalışma alanı + menü düğmesi; bölümler ve sol menü aynı çekmecede; "Yeni gönderi" ikon düğmesi.
- Klavye: tüm menüler Escape ile kapanır, odak tetikleyiciye döner; görünür odak halkası.

## 4. Grafik kiti (`web/src/panel/charts/`)

Bağımlılık yok; SVG + React. Her bileşen boyutunu kapsayıcıdan alır (ResizeObserver), x ekseni bandı yüksekliğe dahildir.

| Bileşen | Kullanım | Kural |
|---|---|---|
| `StatTile` | KPI: etiket · değer (kısaltılmış: 12,9 B) · fark (önceki döneme göre, yön × iyi/kötü) · isteğe bağlı sparkline | Fark ikon + metinle, renk tek başına değil |
| `TimeChart` | Zaman serisi: çizgi (takipçi, görüntülenme) ya da sütun (gönderi, etkileşim) | 2px çizgi, ≥8px son nokta, sütun ≤24px, 4px yuvarlak uç; dikey imleç çizgisi + tek ipucu kutusu (tüm seriler); ≥2 seride gösterge; boşluk = veri yok (sıfır değil) |
| `BarList` | Sıralı yatay çubuk (içerik türü, ağ dağılımı) | Değer çubuğun ucunda, metin mürekkep renginde |
| `Heatmap` | Gün × saat | Tek renk ölçek + gösterge, hücre başına ipucu |
| `DataTable` | Gönderi ve hashtag tabloları | Arama, sıralama, sütun seçici, sayfalama, CSV |
| `ChartCard` | Kart çerçevesi | Başlık, alt başlık, "Tablo" geçişi (her grafiğin tablo görünümü), not satırı |

Yeniden yükleme sırasında grafik son halini düşük opaklıkla korur (iskelet yanıp sönmez).

## 5. Analitik sayfası (Özet ve ağ görünümü)

**Filtre satırı**: dönem (7 · 30 · 90 gün · bu ay · özel aralık) · "Önceki dönemle karşılaştır" · Şimdi çek · Yazdır / PDF.

**Sıralama** (Metricool'daki ACCOUNT / POSTS çapalarının karşılığı: Topluluk · Gönderiler · Zamanlama · Liste):

1. **KPI şeridi**: Takipçi · Yayınlanan gönderi · Etkileşim · Görüntülenme · Etkileşim oranı · Otomatik yanıt oranı (DM; Reblebi farkı).
2. **Topluluk**: takipçi kartı = solda toplam + ağ çipleri, sağda günlük takipçi çizgisi (ağ başına seri, en çok 4 doğrudan etiket); altında ağ dağılımı tablosu (takipçi, değişim, gönderi, etkileşim, görüntülenme, oran).
3. **Gönderiler**: günlük gönderi sütunu ve günlük etkileşim sütunu alt alta (aynı zaman ekseni, ayrı y ekseni yerine ayrı grafik) · içerik türü çubukları · hashtag tablosu.
4. **Zamanlama**: gün × saat ısı haritası (kendi gönderilerinin ortalama etkileşimi; en az 1 gönderili hücreler; kaynak açıklaması kartın altında).
5. **Gönderi listesi**: içerik, ağ, tür, tarih, beğeni, yorum, paylaşım, görüntülenme, etkileşim, oran; sıralama, arama, sütun seçici, CSV.

**Ağ görünümü** (`?network=instagram`): aynı sayfa tek ağa süzülür; başlıkta ağ ikonu ve hesaplar, ağın API'si metrik vermiyorsa açıklama.

**Boş durumlar**: kanal yok → "Kanal bağla" · dönemde gönderi yok → açıklama + "Yeni gönderi" · metrik yok → platform notu.

## 6. Diğer sayfalar

Token ve kabuk değişikliği tüm sayfalara uygulanır (kart, düğme, tablo, rozet aynı değişkenleri kullanır). Sayfa içi yapı bu turda değişmedi; Metricool kalıplarının sayfa sayfa uygulanması (takvimde en iyi saat katmanı, gelen kutusunda çözülmemiş/okunmamış sekmeleri, düzenleyicide mobil/masaüstü önizleme) `05-YOL-HARITASI.md`'de.

## 7. Erişilebilirlik ve kalite

- Metin kontrastı WCAG AA (her iki tema), odak halkası görünür, menüler Escape ile kapanır.
- Grafik değerleri ipucu kutusuna kilitli değil: tablo görünümü ve CSV.
- `prefers-reduced-motion`: geçişler kapanır.
- Yazdırma: kabuk gizlenir, kartlar sayfa kırılımında bölünmez (tarayıcıdan PDF).
