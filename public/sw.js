self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "Neue Sitzplatzbestellung" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Neue Bestellung", {
    body: data.body || "Eine neue Bestellung ist eingegangen.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/sitzplatzbestellung" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url || "/sitzplatzbestellung";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => "focus" in client);
    return existing ? existing.focus() : clients.openWindow(path);
  }));
});
