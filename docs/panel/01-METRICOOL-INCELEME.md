# 01 · Metricool incelemesi

> Tarih: 2026-10-03. Kaynak: kullanıcının kendi Metricool hesabı (ücretsiz plan, Chrome'da yalnızca okuma) ve oturum açılmamış giriş/kayıt ekranları.
> Hesaptaki gönderi metinleri, kişi adları ve sayılar bu dosyaya **bilerek yazılmadı**; yalnızca ekran yapısı, bileşenler ve davranış not edildi.
> Amaç kopyalamak değil: Reblebi panelinin eksiklerini görmek ve iyi kalıpları kendi tasarım dilimizle uygulamak.

## 1. Genel bilgi mimarisi

**Üst çubuk (koyu mürdüm zemin, alt kenarda ince limon çizgi)**
- Sol: logo · ana bölümler: **Analytics · Reporting · Inbox · Planning · SmartLinks · Ads** (ikon + etiket, etkin olan hafif açık zeminli kapsül).
- Sağ: "Upgrade your plan" (limon dolgulu CTA) · marka avatarı/seçici · bildirim zili · hamburger menü.

**Hamburger menü**: Add brand · Connections · Brand settings · User management · Plans and billing · Review requests · Language · Account settings · Help center · What's new · Affiliation program · Logout.
→ Ayar ve hesap işleri ana gezinmeden ayrılmış; ana çubuk yalnızca günlük işlere ayrılmış.

**Bağlamsal sol menü (Analytics içinde)**
- Summary (marka özeti) · ağlar tek tek (Facebook, Instagram, TikTok, YouTube, …): bağlı olmayan ağın yanında "+" (bağla), bağlı olanda hesap avatarı.
- Alt grup: Reporting · Reports · Hashtag Tracker · Brand settings. Menü daraltılabilir (alt köşede ‹).

## 2. Analitik · Marka özeti (Summary)

- Sekmeler: **Account · Posts** (sayfa içi çapa gibi).
- Sağ üst: **Main period** tarih aralığı seçici (ücretsiz planda 30 gün sınırı).
- Her metrik ayrı bir kart: **Followers · Impressions · Interactions · Number of posts**.
  - Kartın solunda büyük toplam kutusu (etiket + değer + ağ renginde ince oran çubuğu).
  - Sağda ağ başına renkli küçük kutular (Instagram pembe, Facebook mavi).
  - Altında günlük çizgi grafik (ağ renginde ince çizgi, noktalı işaretçiler, sade eksen).
- **List of posts**: arama · sütun seçici · CSV indir · sayfalama (5'li) · sütunlar: tür, tarih, gösterim, etkileşim, ağ.

## 3. Analitik · Ağ sayfası (Instagram örneği)

- Sekmeler: **Community · Account · Posts · Stories · Competitors**.
- Sağ üst: **Main period** + **Comparison period** ("Create comparison view").
- Bağlantı notu: "Takipçi ve hikâye metrikleri hesabın bağlandığı günden itibaren tutulur" — geçmiş veri yokluğunu dürüstçe açıklıyor.
- **Community**: büyüme grafiği (günlük çubuk) + KPI kutuları: takipçi, günlük takipçi, gönderi başına takipçi, takip, günlük gönderi, haftalık gönderi · takipçi dengesi.
- **Account**: alt sekmeler General evolution / Reach-Views / Interactions / Profile activity (kilitli olanlar kilit ikonuyla). Metrik kutuları grafiğin göstergesi gibi çalışıyor (görüntülenme, günlük ortalama erişim, toplam içerik).
- **Posts**: Organic Summary kutuları (engagement, interactions, avg. reach per post, views, posts) + grafik; Organic Interactions kutuları (likes, comments, saved, shares, posts) + grafik; türetilmiş oranlar (günlük beğeni, gönderi başına beğeni, günlük yorum, gönderi başına yorum, yorum başına beğeni); içerik türleri (tablo/grafik: carousel, reel…); organik/ücretli görüntülenme.
- **List of posts**: 16 sütun (organik/ücretli erişim, görüntülenme, gösterim, etkileşim, beğeni, kaydetme, paylaşım, yorum, engagement, tıklama, harcama, yeni takipçi), "Explore insights", "Add to dashboard", CSV.
- **List of hashtags**: hashtag, organik görüntülenme, gönderi sayısı, beğeni, yorum.
- **Stories**: gösterim, hikâye başına erişim, hikâye listesi (yanıt, geri/ileri dokunma, çıkış).
- **Competitors**: ücretli planda 100 rakibe kadar.
- Grafik dili: **çubuk + çizgi aynı grafikte, iki y ekseni**; pastel renkli metrik kutuları gösterge görevi görüyor; ücretsiz planda filigran.

### 3.1 Facebook sayfası (Meta hesabı bağlandıktan sonra, 2. tur)

- Sekmeler: **Page overview · Demographics · Posts · Reels · Stories · Competitors**; dönem + karşılaştırma dönemi.
- Üstte **metrik değişikliği notu**: Meta'nın kaldırdığı/değiştirdiği metrikler (sayfa beğenisi → takipçi, gösterim → görüntülenme) tarihleriyle açıklanıyor. Platform değişikliğini okura dürüstçe söyleyen iyi bir kalıp.
- **Page overview**: büyüme (takipçi, görüntülenme, sayfa ziyareti, toplam içerik), günlük ortalama yeni takipçi, günlük sayfa görüntülenmesi, günlük/haftalık gönderi · **takipçi dengesi** (kazanılan / kaybedilen).
- **Demographics**: ülkeye ve şehre göre takipçi (tablo / grafik geçişi), veri yoksa "No data available".
- **Posts**: genel bakış (engagement, interactions, gönderi başına ortalama erişim, views) · etkileşim (tepki, yorum, paylaşım, tıklama) · türetilmiş oranlar · türler · gönderi tablosu (erişim, görüntülenme, tepki, yorum, paylaşım, tıklama, link tıklaması, video izlenme, izlenme süresi, engagement, harcama).
- **Reels**: video görüntülenme, beğeni, aksiyon, toplam/ortalama izlenme süresi · **Stories** listesi.

### 3.2 Meta Ads (reklam hesabı bağlandıktan sonra)

- Marka özetine **Ad accounts** bölümü eklendi: gösterim, tıklama, CPM, CPC, harcama.
- Ayrı **Meta Ads** sayfası: **Account · Campaigns** sekmeleri; erişim, gösterim, harcama · sonuç (tıklama) · performans (CPM, CPC, CTR) · kampanya tablosu (sütun seçici, CSV, panoya ekle).
- Ücretsiz planda reklam verisi "birkaç günde bir" güncelleniyor; ekranda açıkça yazıyor.

## 4. Planlama (Planning)

- Sekmeler: **Calendar · List · Posts library · Autolists · Deleted posts · Flows (yeni)** · sağda saat dilimi.
- Araç çubuğu: arama · "This week" · ‹ tarih aralığı › · filtre · **Best times** (ağ seçimli) · görünüm oluştur · **Create post**.
- Haftalık saat ızgarası; **en iyi saatler** her hücrede yüzde olarak ve maviden açığa ısı haritası gibi.
- Plan limit bandı ("bu ay 20 gönderiden 0'ını kullandın").

## 5. Gönderi düzenleyici (Create post)

- Tam ekran modal: başlıkta marka çipi, sağda "Close".
- Sol: ağ çipleri + gönderi türü (POST ▾), "+" ile ağ ekleme · Notes · metin alanı · alt araç çubuğu: medya, emoji, ilk yorum, konum, link, AI, kayıtlı (hashtag/şablon) · ağ başına karakter sayacı (ör. 0/16192) · **Global presets** · Cancel · tarih/saat · **Schedule** (bölünmüş düğme).
- Sağ: ağ seçici + **canlı önizleme** (mobil/masaüstü geçişi) ve "önizleme yaklaşıktır" notu.

## 6. Gelen kutusu (Inbox)

- İki panel: solda ağ filtresi (ikonlar + ekle), arama (en az 3 karakter), filtre, **Unresolved / Unread / All** sekmeleri, konuşma listesi (avatar + ağ rozeti + tarih + önizleme); sağda konuşma ya da "soldan bir konuşma seç" boş durumu.
- Eksik izin olduğunda ağ bazında açıklayıcı modal (hangi ayardan izin verileceğini adım adım anlatıyor).

## 7. Raporlama, SmartLinks, Ads

- **Reporting merkezi**: Reports (logolu/renkli PDF-PPT) · Campaign dashboards · Metricool Studio (özel görünüm) · Looker Studio bağlayıcısı · Hashtag Tracker (günlük ücretli).
- **SmartLinks**: link-in-bio mikro sitesi + tıklama/ziyaret analitiği (ücretli).
- **Ads**: Meta / Google / TikTok reklam hesabı bağlama; sekmeler Campaigns · Groups · Advertisements · Keywords · Recommendations.

## 8. Giriş ve kayıt

- **Giriş**: tam ekran renkli illüstrasyon zemin (grafik çubukları gibi), sağda beyaz büyük köşeli kart: logo, "Nasıl giriş yapmak istersin?", Google + Facebook, "veya", e-posta, şifre (göster/gizle), şifremi unuttum, form geçerli olana kadar pasif "Erişim" düğmesi, "Hesap oluştur" bağlantısı.
- **Kayıt**: bölünmüş düzen; solda koyu zemin üzerinde başlık + 3 değer önerisi (ikon, büyük harf başlık, tek satır açıklama); sağda kart: sosyal kayıt, e-posta, şifre, veri işleme metni, koşulları kabul kutusu, pazarlama izni kutusu, "Ücretsiz başla", "ömür boyu ücretsiz" notu, giriş bağlantısı.

## 9. Görsel dil özeti

| Öğe | Metricool |
|---|---|
| Zemin | Açık gri-mavi, beyaz kartlar, yumuşak köşe |
| Gezinme | Koyu mürdüm üst çubuk + bağlamsal sol menü |
| Vurgu | Limon (CTA), pastel metrik kutuları |
| Grafik | İnce çizgi + nokta, çubuk; çoğu yerde çift eksen |
| Tablo | Arama, sütun seçici, CSV, sayfalama |
| Boş/izin durumu | Açıklayıcı metin + illüstrasyon |

## 10. Reblebi için çıkarım

**Alınacak kalıplar**: dönem + karşılaştırma dönemi · metrik başına kart (toplam + ağ dağılımı + günlük grafik) · gönderi tablosu (arama, sıralama, sütun seçici, CSV) · hashtag tablosu · içerik türü dağılımı · gün × saat ısı haritası · bağlamsal sol menü · ayarların hamburger menüye taşınması · dürüst "veri bağlandığı günden itibaren" notları · split kayıt ekranı.

**Bilerek alınmayacaklar** (gerekçe `03-PANEL-TASARIM.md`):
- Çift eksenli grafik: iki ölçeğin hizası keyfî, okura olmayan bir ilişki gösterir. Yerine tek eksenli küçük grafikler.
- Pastel kutularda koyu metin kontrastı ve filigran.
- Her sayfada tekrar eden yükseltme bandı.
- Olmayan özellik için sahte giriş düğmesi (Reblebi'de Google/Facebook ile giriş yok).
