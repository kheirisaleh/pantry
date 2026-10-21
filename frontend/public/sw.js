const VERSION = "pantry-v10";
const SHELL = ["/", "/m", "/logo.svg", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

function remember(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(VERSION).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/export") || url.pathname === "/sw.js") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => remember(request, response)).catch(() => caches.match(request).then((match) => match || caches.match(url.pathname.startsWith("/m") ? "/m" : "/"))));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).then((response) => remember(request, response)).catch(() => caches.match(request, { ignoreVary: true }).then((match) => match || Response.error())));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/media/")) {
    event.respondWith(caches.match(request).then((match) => match || fetch(request).then((response) => remember(request, response))));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: "Pantry", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Pantry", {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/m" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/m";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).pathname.startsWith("/m")) {
        client.focus();
        client.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  }));
});
