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
// Bahsetme izleme: demo kurgusal kalsın, "Şimdi tara" gerçek kaynaklara gitmesin; Reddit ve web kaynakları açık görünsün
process.env.LISTEN_OFFLINE = "1";
process.env.REDDIT_CLIENT_ID ||= "demo";
process.env.REDDIT_CLIENT_SECRET ||= "demo";
process.env.BRAVE_SEARCH_API_KEY ||= "demo";

const { ensureDirs } = await import("../src/core/config.js");
ensureDirs();
const { seedDemo } = await import("./demo-seed.js");
const r = seedDemo();
console.log(r.created ? "demo verisi oluşturuldu (data/demo)" : "demo verisi zaten var (data/demo)");
// Demo kullanıcı platform sahibi gibi davranır: kurulum rehberi / anahtar ekranları görünsün
const { usersRepo } = await import("../src/core/repos/orgs.js");
const { DEMO_EMAIL } = await import("./demo-seed.js");
const demoUser = usersRepo.findByEmail(DEMO_EMAIL);
if (demoUser && !demoUser.isSuperadmin) usersRepo.update(demoUser.id, { isSuperadmin: true });
await import("../src/api/main.js");
