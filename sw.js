/* Service worker: guarda o app e os mapas para uso sem internet */
var SHELL = 'shell-v5';
var CHARTS = 'cartas-v1';
var TILES = 'tiles-v1';
var SHELL_FILES = [
  './', 'index.html', 'style.css', 'geo.js', 'dados.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'leaflet.css', 'leaflet.js'
];
var TILE_HOSTS = ['server.arcgisonline.com', 'a.basemaps.cartocdn.com', 'tiles.openseamap.org'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(SHELL_FILES.map(function (u) {
      return fetch(u, { mode: u.indexOf('http') === 0 ? 'cors' : 'same-origin', cache: 'reload' })
        .then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () { });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== TILES && k !== CHARTS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Cartas náuticas: só existem no aparelho (importadas pelo usuário)
  if (url.origin === self.location.origin && url.pathname.indexOf('/carta/') >= 0) {
    e.respondWith(caches.open(CHARTS).then(function (c) {
      return c.match(url.href).then(function (hit) { return hit || new Response('', { status: 404 }); });
    }));
    return;
  }

  // Mapas: primeiro do aparelho, depois da internet (e guarda o que vier)
  if (TILE_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req.url, { ignoreVary: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var keep = res.ok || (res.type === 'opaque' && url.hostname === 'tiles.openseamap.org');
          if (keep) c.put(req.url, res.clone()).catch(function () { });
          return res;
        });
      });
    }).catch(function () { return Response.error(); }));
    return;
  }

  // Leaflet (CDN): do aparelho primeiro
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.match(req.url).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var cl = res.clone(); caches.open(SHELL).then(function (c) { c.put(req.url, cl); }); }
        return res;
      });
    }));
    return;
  }

  // Arquivos do app: internet primeiro (para pegar atualizações), aparelho se estiver offline
  if (url.origin === self.location.origin) {
    // com sinal fraco no mar, não espera mais que 4 s pela rede
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 4000);
    e.respondWith(fetch(req, { signal: ctrl.signal }).then(function (res) {
      clearTimeout(timer);
      if (res.ok) { var cl = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, cl); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('index.html');
      });
    }));
  }
});
