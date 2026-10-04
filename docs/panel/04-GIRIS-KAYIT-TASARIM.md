# 04 · Giriş ve kayıt ekranları

> Uygulama: `web/src/pages/public/AuthPages.tsx` → `AuthLayout` (tek bileşen) + `web/src/panel/auth.css`.
> Etkilenen ekranlar: Giriş, Kayıt (ve ilk kurulum), Şifremi unuttum, Şifre sıfırla, E-posta doğrula, Davet, OAuth onay (`/consent`), çalışma alanı yok, müşteri önizleme hata ekranları.
> **Akış ve mantık değişmedi**: alanlar, doğrulama, istekler, yönlendirmeler, `next` parametresi aynı. Yalnızca görünüm.

## 1. Metricool'dan alınan / alınmayan

| Metricool | Reblebi |
|---|---|
| Giriş: tam ekran illüstrasyon + sağda kart | Bölünmüş düzen: solda marka paneli, sağda form (giriş ve kayıt aynı iskelet; tutarlılık) |
| Kayıt: solda 3 değer önerisi | Var; öneriler koddan doğrulanmış gerçekler |
| Google / Facebook ile giriş | **Yok**: Reblebi'de sosyal giriş yok, sahte düğme konmaz (yol haritası F2) |
| Form geçerli olana kadar pasif düğme | Düğme etkin kalır; tarayıcı doğrulaması ve hata mesajı (pasif düğme nedenini söylemez) |
| Şifre göster/gizle | **Eklendi** (yalnızca istemci) |
| "Ömür boyu ücretsiz" | Ücretsiz plan ve deneme süresi `/api/public/config`'ten |

## 2. Düzen

```
≥ 960px
┌──────────────────────────┬─────────────────────────────────┐
│ koyu panel (#13111c)     │                        TR | EN  │
│ [r] Reblebi              │   Başlık                        │
│                          │   alt metin                     │
│ Başlık (2 satır)         │   [ alanlar ]                   │
│                          │   [ birincil düğme ]            │
│ ▸ Dokuz platform, tek    │   bağlantılar                   │
│   takvim                 │                                 │
│ ▸ DM'ler tek kutuda      │                                 │
│ ▸ Ölç, karşılaştır,      │                                 │
│   dışa aktar             │                                 │
│ [dekoratif sütun grafiği │                                 │
│  + leblebi noktası]      │                                 │
│ alt not (deneme / kart)  │                                 │
└──────────────────────────┴─────────────────────────────────┘
< 960px: koyu panel gizlenir; üstte logo + dil seçici, altında form (form ilk ekranda kalsın diye).
```

- Sol panel `aria-hidden` değildir (gerçek metin), dekoratif grafik `aria-hidden`.
- Form kartı: 440px en fazla, 16px gövde (mobilde yakınlaştırma olmasın), 48px alan yüksekliği, görünür etiketler.
- Odak sırası: dil seçici → başlık → alanlar → düğme → bağlantılar.

## 3. Metinler (doğrulanmış)

| Öğe | Metin | Kaynak |
|---|---|---|
| Başlık | "Planla, yanıtla, ölç. Hepsi tek panelde." | Ürünün üç ana işlevi |
| Öneri 1 | Dokuz platform, tek takvim: Instagram'dan Telegram'a planla ve yayınla | `CORE_PLATFORMS` |
| Öneri 2 | DM'ler tek kutuda: Instagram, Messenger, WhatsApp, Telegram ve X; kurallarla otomatik yanıt | Gelen kutusu |
| Öneri 3 | Ölç ve karşılaştır: takipçi, etkileşim, en iyi saatler; CSV ve PDF | Yeni analitik raporu |
| Alt not (kayıt) | "{gün} gün {plan} ücretsiz · Kredi kartı gerekmez" | `/api/public/config` |
| Alt not (giriş) | "Şifreni hiçbir platforma vermezsin: hesaplar resmî izin ekranından bağlanır." | Resmî API / OAuth |

## 4. Durumlar

- Hata: alan altında kırmızı metin + ikon (renk tek başına değil), `aria-live`.
- Gönderiliyor: düğme "…" ve pasif (çift gönderim yok).
- Kayıt kapalı / yalnız davet: mevcut metinler, aynı kabuk.
- E-posta doğrulama bekleniyor: mevcut ekran, aynı kabuk.
