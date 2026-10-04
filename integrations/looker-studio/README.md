# Reblebi → Looker Studio bağlayıcısı

Metricool'daki "Looker Studio connector" karşılığı. Reblebi'deki kanalların günlük metriklerini Looker Studio'ya veri kaynağı olarak getirir.

## Ne gelir

Her satır **bir kanal × bir gün**:

| Alan | Açıklama |
|---|---|
| Tarih, Ağ, Kanal, Kanal kimliği | Boyutlar |
| Takipçi | O günün takipçi sayısı (toplanmaz, en büyük değer) |
| Gönderi, Beğeni, Yorum, Paylaşım, Kaydetme, Etkileşim, Gönderi görüntülenme | O gün yayınlanan gönderilerin son çekilen metrikleri |
| Erişim, Hesap görüntülenme, Profil ziyareti, Web sitesi tıklaması, Yeni takip, Takibi bırakan, İzlenme süresi | Platform hesap insights verdiğinde (Instagram, Facebook, YouTube, LinkedIn şirket sayfası) |

Kaynak uç nokta: `GET /api/export/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` (en fazla 366 gün). Aynı veri panelde `?format=csv` ile CSV olarak da indirilebilir.

## Kurulum (bir kez, ~5 dakika)

1. Reblebi panelinde **Ayarlar > API anahtarları**'ndan yeni bir anahtar oluştur (`sp_` ile başlar). Anahtar çalışma alanının tüm verisini okuyabilir; yalnızca güvendiğin raporlarda kullan.
2. https://script.google.com adresinde **Yeni proje** aç.
3. Proje ayarlarından **"appsscript.json" manifest dosyasını düzenleyicide göster** seçeneğini aç.
4. `Code.gs` ve `appsscript.json` içeriklerini bu klasördekilerle değiştir. Kendi sunucunu kullanıyorsan `appsscript.json` içindeki `urlFetchWhitelist` ve `Code.gs` içindeki `DEFAULT_URL` değerlerini kendi adresinle değiştir.
5. **Dağıt > Yeni dağıtım > Tür: Looker Studio bağlayıcısı** (yoksa "Dağıtımları yönet > Head dağıtımı"nın kimliğini kullan).
6. Looker Studio'da **Oluştur > Veri kaynağı > Kendi bağlayıcın (Build your own)** bölümüne dağıtım kimliğini yapıştır, yetki ver, API anahtarını gir.
7. Rapor oluşturup tarih aralığı denetimi ekle.

## Notlar

- Bağlayıcı yalnızca okur; Reblebi'de hiçbir şeyi değiştirmez.
- Anahtarı iptal etmek için panelden silmen yeterli; bağlayıcı "API anahtarı geçersiz" hatası verir.
- Herkese açık (tüm Looker Studio kullanıcılarına listelenen) bağlayıcı yayımlamak Google'ın ayrıca incelemesini gerektirir; bu klasör kendi kullanımın için hazırdır.
