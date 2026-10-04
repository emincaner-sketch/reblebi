/**
 * Demo API: paneli kurgusal verilerle yerelde görmek için ayrı sunucu (docs/panel/05-YOL-HARITASI.md F1).
 * - Veri: ./data/demo (data/ git dışı); gerçek ./data veritabanına dokunmaz.
 * - Zamanlayıcı kapalı: demo kanallarının sahte token'larıyla hiçbir platforma istek gitmez.
 * - Yedekleme kapalı.
 *
 * Çalıştırma (proje kökünden):
 *   npx tsx server/scripts/demo-api.ts                         → API :4510
 *   VITE_API_URL=http://localhost:4510 npx vite --port 5530    → web (web/ klasöründe)
 * Giriş bilgileri: server/scripts/demo-seed.ts başında.
 */
process.env.DATA_DIR ||= "./data/demo";
process.env.API_PORT ||= "4510";
process.env.PUBLIC_URL ||= "http://localhost:5530";
process.env.APP_URL ||= "http://localhost:5530";
process.env.DISABLE_SCHEDULER = "1";
process.env.BACKUP_ENABLED = "false";

const { ensureDirs } = await import("../src/core/config.js");
ensureDirs();
const { seedDemo } = await import("./demo-seed.js");
const r = seedDemo();
console.log(r.created ? "demo verisi oluşturuldu (data/demo)" : "demo verisi zaten var (data/demo)");
await import("../src/api/main.js");
