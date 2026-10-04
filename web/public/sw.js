/* Reblebi servis çalışanı: uygulamanın yüklenebilmesi (PWA) ve çevrimdışı sayfası.
 * - API, oturum, OAuth, webhook ve medya istekleri ASLA önbelleğe alınmaz (her zaman ağdan).
 * - Sayfalar ağdan gelir (yeni sürüm hemen görünür); ağ yoksa çevrimdışı sayfası gösterilir.
 * - Yalnızca adında içerik özeti olan /assets/ ve /fonts/ dosyaları önbellekten verilir (değişmez). */
const VERSION = "reblebi-v2";
const OFFLINE = "/offline.html";
const NEVER = ["/api/", "/mcp", "/oauth/", "/webhooks/", "/media/", "/l/", "/.well-known/"];

self.addEventListener("install", (event) => {
  // Her dosya ayrı eklenir: biri alınamazsa kurulum yine tamamlanır (addAll tek hatada hepsini reddeder)
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all([OFFLINE, "/favicon.svg", "/icon-192.png"].map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* Anlık bildirim: sunucu şifreli JSON gönderir { title, body, url, tag } */
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: event.data ? event.data.text() : "Reblebi" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Reblebi", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/favicon-48.png",
      tag: d.tag || undefined,
      data: { url: d.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Açık bir panel sekmesi varsa ona git, yoksa yeni pencere aç
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.some((p) => url.pathname.startsWith(p))) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
  }
});
