# Panel dokümanları

Reblebi panelini Metricool seviyesine taşıma çalışması (2026-10-03).

| Dosya | İçerik |
|---|---|
| [01-METRICOOL-INCELEME.md](01-METRICOOL-INCELEME.md) | Metricool'un ekranları, bileşenleri, grafik dili, giriş/kayıt; alınacak ve bilerek alınmayacak kalıplar |
| [02-OZELLIK-ESLESTIRME.md](02-OZELLIK-ESLESTIRME.md) | Özellik tablosu: Metricool ↔ Reblebi (var / kısmi / yok / bu çalışma) ve Reblebi'nin farkları |
| [03-PANEL-TASARIM.md](03-PANEL-TASARIM.md) | Token'lar, grafik paleti (doğrulanmış), kabuk ve gezinme haritası, grafik kiti, analitik sayfası tarifi |
| [04-GIRIS-KAYIT-TASARIM.md](04-GIRIS-KAYIT-TASARIM.md) | Giriş / kayıt ekranlarının düzeni, metinleri ve durumları |
| [05-YOL-HARITASI.md](05-YOL-HARITASI.md) | F1 (yapılan) → F4: veri derinliği, raporlama, genişleme |

Yerelde demo verisiyle görmek için: `05-YOL-HARITASI.md` → "Demo nasıl açılır".

## Doğrulama (2026-10-03)

| Kontrol | Sonuç | Nasıl |
|---|---|---|
| Sunucu testleri | 59/59 geçti (5'i yeni rapor testi) | `npm test -w server` |
| Tip kontrolü | Hatasız (server + web) | `npm run typecheck` |
| Web derlemesi + ön-render | Hatasız, 12 sayfa | `npm run build -w web` |
| Yatay taşma (360px) | Panelin 12 sayfasında sayfa taşması yok | Headless Edge ölçümü |
| Metin kontrastı (WCAG AA) | Açık ve koyu temada 0 ihlal (analitik, panel, planlama, gelen kutusu, ayarlar, giriş) | Hesaplanan renk/zemin taraması |
| Grafik paleti | Açık ΔE 9.1, koyu ΔE 8.4 (renk körlüğü komşu ayrımı) | `validate_palette.js` |
| Lighthouse | Ölçülmedi | |
