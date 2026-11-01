/* Farm Alert Performance service worker (scope /).
 * - Navigations (except /admin): network first, cached copy when offline, so
 *   My day opens with no signal (spec 3.2 / 10.1).
 * - /_next/static/*: cache first (content-hashed, never changes).
 * - /api/*: never cached here; the app keeps its own per-screen cache.
 * - Push: shows the reminder and opens the matching screen on tap (spec 7).
 */
var SHELL = "fa-perf-shell-v1";
var STATIC = "fa-perf-static-v1";

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (c) {
      return c.addAll(["/"]).catch(function () {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k.indexOf("fa-perf-") === 0 && k !== SHELL && k !== STATIC;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  if (req.mode === "navigate" && url.pathname.indexOf("/admin") !== 0) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) {
            c.put("/", copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match("/");
        })
    );
    return;
  }

  if (url.pathname.indexOf("/_next/static/") === 0 || url.pathname.indexOf("/icons/") === 0) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        return (
          hit ||
          fetch(req).then(function (res) {
            if (res.ok) {
              var copy = res.clone();
              caches.open(STATIC).then(function (c) {
                c.put(req, copy);
              });
            }
            return res;
          })
        );
      })
    );
  }
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Farm Alert", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Farm Alert Performance", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  if (target.charAt(0) !== "/" || target.charAt(1) === "/") target = "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.focus().then(function (fc) {
            return fc.navigate ? fc.navigate(target) : fc;
          });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
