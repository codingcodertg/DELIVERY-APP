// RTG Clock-In service worker — Web Push, plus the fetch handler Android
// requires before Chrome will offer a real "Install app" (standalone, no
// address bar). Without one, Android only ever created a browser shortcut,
// which is why it looked like an app on iPhone but not on Android.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Deliberately pass-through: a time clock must never serve a stale cached
// punch screen. The handler exists to satisfy installability and to give one
// honest message when the phone is genuinely offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      event.request.mode === "navigate"
        ? new Response(
            "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
              "<body style='font-family:system-ui;padding:2rem;text-align:center'>" +
              "<h2>Sin conexión</h2><p>Revisa tu señal y vuelve a intentar.</p>" +
              "<p style='color:#888'>No connection — check your signal and try again.</p></body>",
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
          )
        : Response.error(),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "RTG Clock-In", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "RTG Clock-In";
  const options = {
    body: data.body || "",
    icon: "/clockin-icon-192.png",
    badge: "/clockin-icon-192.png",
    data: { url: data.url || "/clock" },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/clock";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && "focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
