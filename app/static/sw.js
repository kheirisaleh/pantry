const VERSION = "pantry-v9";
const SHELL = [
  "/m/", "/", "/static/styles.css", "/static/desktop.css", "/static/m/mobile.css", "/static/js/core.js", "/static/js/views.js",
  "/static/js/shell.js", "/static/js/desktop.js", "/static/m/mobile.js", "/static/m/manifest.webmanifest",
  "/static/fonts/bricolage-grotesque-latin-700-normal.woff2", "/static/fonts/bricolage-grotesque-latin-800-normal.woff2",
  "/static/fonts/manrope-latin-400-normal.woff2", "/static/fonts/manrope-latin-600-normal.woff2", "/static/fonts/manrope-latin-700-normal.woff2",
  "/static/fonts/vazirmatn-arabic-400-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/export")) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/" || url.pathname === "/m/" || url.pathname.startsWith("/static/js/") || url.pathname.endsWith(".css")) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request, { ignoreVary: true }).then((match) => match || caches.match(url.pathname === "/" ? "/" : "/m/"))));
    return;
  }
  event.respondWith(caches.match(request).then((match) => match || fetch(request).then((response) => {
    if (response.ok && (url.pathname.startsWith("/static/") || url.pathname.startsWith("/media/"))) {
      const copy = response.clone();
      caches.open(VERSION).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { title: "Pantry", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Pantry", {
    body: data.body || "",
    icon: "/static/m/icon-192.png",
    badge: "/static/m/icon-192.png",
    data: { url: data.url || "/m/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/m/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.includes("/m/")) { client.focus(); client.navigate(target); return; }
    }
    return self.clients.openWindow(target);
  }));
});
