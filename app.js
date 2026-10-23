/* Derrota — navegação offline com rotas editáveis */
(function () {
  'use strict';
  var G = window.Geo;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var STORE = 'derrota.v1';
  var TILE_CACHE = 'tiles-v1';
  var CHART_CACHE = 'cartas-v1';
  var CHART_VER = 1;

  // ---------- Camadas de mapa ----------
  var SOURCES = {
    sat: { name: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagens © Esri, Maxar, Earthstar Geographics', kb: 22 },
    map: { name: 'Mapa', url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', attr: '© OpenStreetMap © CARTO', kb: 14 },
    chart: { name: 'Carta náutica', url: new URL('carta/{z}/{x}/{y}.png', location.href).href.replace('%7Bz%7D', '{z}').replace('%7Bx%7D', '{x}').replace('%7By%7D', '{y}'), attr: 'Cartas © DHN/Marinha do Brasil', kb: 12 },
    sea: { name: 'Sinais náuticos', url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', attr: 'Sinais © OpenSeaMap', kb: 2 }
  };
  function tileUrl(key, z, x, y) { return SOURCES[key].url.replace('{z}', z).replace('{x}', x).replace('{y}', y); }

  // ---------- Estado ----------
  var DEFAULT_SETTINGS = { fmt: 'ddm', decl: -21.5, arrive: 0.1, speed: 5, base: 'sat', sea: true, showMarks: true, showTrack: true, rec: true, night: false, wake: false, buf: 2, zmax: 14, dlSat: true, dlMap: false, dlSea: true, chart: true, chartInfo: null, hdgSrc: 'compass', hdgLen: 15 };
  var S = load();
  function freshState() {
    var d = JSON.parse(JSON.stringify(window.DADOS_INICIAIS));
    return { migr1: true, migr2: true, routes: d.routes, marks: d.marks, selRoute: d.routes[0] && d.routes[0].id, nav: null, settings: Object.assign({}, DEFAULT_SETTINGS), track: [] };
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) {
        var s = JSON.parse(raw); s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {}); s.track = s.track || [];
        // remove o rascunho do trecho interno (posições erradas no Varadouro)
        if (!s.migr1) {
          s.routes = (s.routes || []).filter(function (r) { return r.id !== 'r-interno'; });
          if (s.nav && s.nav.routeId === 'r-interno') s.nav = null;
          if (s.selRoute === 'r-interno') s.selRoute = s.routes[0] && s.routes[0].id;
          s.migr1 = true;
        }
        // troca a route183 pela route184
        if (!s.migr2) {
          s.routes = (s.routes || []).filter(function (r) { return r.id !== 'r-navionics'; });
          if (!s.routes.some(function (r) { return r.id === 'r-184'; })) s.routes.unshift(JSON.parse(JSON.stringify(window.DADOS_INICIAIS.routes[0])));
          if (s.nav && s.nav.routeId === 'r-navionics') s.nav = null;
          s.selRoute = 'r-184';
          s.migr2 = true;
        }
        return s;
      }
    } catch (e) { }
    return freshState();
  }
  var saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    var go = function () { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { toast('Não consegui salvar no aparelho. Exporte um GPX como backup.'); } };
    if (now) go(); else saveTimer = setTimeout(go, 300);
  }
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var route = function (id) { return S.routes.find(function (r) { return r.id === (id || S.selRoute); }); };
  var set = S.settings;

  // ---------- Formatação ----------
  var nf = function (v, d) { return v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var fNM = function (v) { return v < 10 ? nf(v, 2) : nf(v, 1); };
  var fDeg = function (v) { return String(Math.round(G.norm360(v)) % 360).padStart(3, '0') + '°'; };
  var mag = function (t) { return G.toMagnetic(t, set.decl); };
  var fCoord = function (p) { return G.formatCoord(p, set.fmt); };
  var fDur = function (h) { if (!isFinite(h)) return '—'; var m = Math.round(h * 60); var d = Math.floor(m / 1440); m -= d * 1440; return (d ? d + 'd ' : '') + Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
  var fClock = function (date) { return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  // ---------- Mapa ----------
  if (set.night) document.documentElement.classList.add('night');
  var map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 18, minZoom: 3, worldCopyJump: false, tap: false });
  map.setView([-24.3, -46.5], 7); // vista inicial antes de qualquer camada
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  function loadImg(url, noCors) {
    return new Promise(function (res, rej) {
      var im = new Image(); if (!noCors) im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); }; im.onerror = rej; im.src = url;
    });
  }
  // Camada que, sem o tile exato, amplia o tile "pai" que estiver salvo
  var SmartLayer = L.GridLayer.extend({
    createTile: function (c, done) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 256;
      var ctx = cv.getContext('2d'), key = this.options.key, maxUp = this.options.maxUp;
      (async function () {
        try { ctx.drawImage(await loadImg(tileUrl(key, c.z, c.x, c.y)), 0, 0, 256, 256); return; } catch (e) { }
        if (key === 'sea') { try { ctx.drawImage(await loadImg(tileUrl(key, c.z, c.x, c.y), true), 0, 0, 256, 256); return; } catch (e) { } }
        for (var dz = 1; dz <= maxUp && c.z - dz >= 0; dz++) {
          var f = 1 << dz, s = 256 / f;
          try {
            var im = await loadImg(tileUrl(key, c.z - dz, Math.floor(c.x / f), Math.floor(c.y / f)));
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(im, (c.x % f) * s * im.width / 256, (c.y % f) * s * im.height / 256, s * im.width / 256, s * im.height / 256, 0, 0, 256, 256);
            return;
          } catch (e) { }
        }
      })().then(function () { done(null, cv); });
      return cv;
    }
  });
  var baseLayers = {
    sat: new SmartLayer({ key: 'sat', maxUp: 8, maxZoom: 18, attribution: SOURCES.sat.attr }),
    map: new SmartLayer({ key: 'map', maxUp: 8, maxZoom: 18, attribution: SOURCES.map.attr })
  };
  var seaLayer = new SmartLayer({ key: 'sea', maxUp: 3, maxZoom: 18, attribution: SOURCES.sea.attr, zIndex: 5 });
  var chartLayer = new SmartLayer({ key: 'chart', maxUp: 6, maxZoom: 18, attribution: SOURCES.chart.attr, zIndex: 3 });
  function applyLayers() {
    Object.keys(baseLayers).forEach(function (k) { if (k === set.base) baseLayers[k].addTo(map); else map.removeLayer(baseLayers[k]); });
    if (set.sea) seaLayer.addTo(map); else map.removeLayer(seaLayer);
    if (set.chart && set.chartInfo) chartLayer.addTo(map); else map.removeLayer(chartLayer);
    if (set.showMarks) marksLayer.addTo(map); else map.removeLayer(marksLayer);
    if (set.showTrack) trackLine.addTo(map); else map.removeLayer(trackLine);
  }

  var routesLayer = L.layerGroup().addTo(map);
  var marksLayer = L.layerGroup();
  var trackLine = L.polyline([], { color: '#f2b33d', weight: 3, opacity: .85 });
  var navLine = L.polyline([], { color: '#ffffff', weight: 2, dashArray: '4 6', opacity: .9 }).addTo(map);

  // ---------- Desenho de rotas e pontos ----------
  var editing = false;      // edição no mapa ligada
  var pickCb = null;        // callback de "escolher no mapa"
  function wpIcon(r, i, active, off) {
    return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="wp-icon' + (active ? ' active' : '') + (off ? ' off' : '') + '" style="--c:' + r.color + '">' + (i + 1) + '</div>' });
  }
  // Pontos com o olho fechado ficam na lista, mas fora da rota
  var on = function (p) { return !p.off; };
  function prevOn(r, i) { for (var k = i - 1; k >= 0; k--) if (on(r.points[k])) return r.points[k]; return null; }
  function findOn(r, i, d) { for (var k = i; k >= 0 && k < r.points.length; k += d) if (on(r.points[k])) return k; return -1; }
  function activePts(r) { return r.points.filter(on); }
  function deleteWp(r, idx) {
    r.points.splice(idx, 1);
    if (S.nav && S.nav.type === 'route' && S.nav.routeId === r.id) {
      if (S.nav.idx > idx) S.nav.idx--;
      var k = findOn(r, Math.min(S.nav.idx, r.points.length - 1), 1);
      if (k < 0) k = findOn(r, r.points.length - 1, -1);
      if (k < 0) S.nav = null; else S.nav.idx = k;
    }
  }
  function toggleWp(r, idx) {
    var p = r.points[idx]; p.off = !p.off;
    if (p.off && S.nav && S.nav.type === 'route' && S.nav.routeId === r.id && S.nav.idx === idx) {
      var k = findOn(r, idx, 1); if (k < 0) k = findOn(r, idx, -1);
      if (k < 0) S.nav = null; else S.nav.idx = k;
    }
  }
  // Toque em cima da linha: insere um waypoint naquele trecho
  function insertOnLine(r, latlng) {
    var a = [], idxs = [];
    r.points.forEach(function (p, i) { if (on(p)) { a.push(p); idxs.push(i); } });
    if (a.length < 2) return false;
    var z = map.getZoom(), P = map.project(latlng, z), best = Infinity, bk = -1, bp = null;
    for (var k = 0; k < a.length - 1; k++) {
      var A = map.project([a[k].lat, a[k].lon], z), B = map.project([a[k + 1].lat, a[k + 1].lon], z);
      var d = L.LineUtil.pointToSegmentDistance(P, A, B);
      if (d < best) { best = d; bk = k; bp = L.LineUtil.closestPointOnSegment(P, A, B); }
    }
    var ll = map.unproject(bp, z), at = idxs[bk + 1];
    r.points.splice(at, 0, { name: 'Novo ponto', lat: ll.lat, lon: ll.lng, note: '' });
    if (S.nav && S.nav.type === 'route' && S.nav.routeId === r.id && S.nav.idx >= at) S.nav.idx++;
    save(); renderAll(); toast('Ponto ' + (at + 1) + ' inserido na linha. Arraste para ajustar.');
    return true;
  }
  function drawRoutes() {
    routesLayer.clearLayers();
    S.routes.forEach(function (r) {
      var sel = r.id === S.selRoute;
      var latlngs = activePts(r).map(function (p) { return [p.lat, p.lon]; });
      L.polyline(latlngs, { color: r.color, weight: sel ? 4 : 3, opacity: sel ? .95 : .6, dashArray: r.draft ? '8 8' : null, interactive: false })
        .addTo(routesLayer);
      // faixa invisível e larga para facilitar o toque na linha
      L.polyline(latlngs, { color: '#000', weight: 26, opacity: 0, bubblingMouseEvents: false })
        .on('click', function (e) {
          L.DomEvent.stop(e);
          if (pickCb) { var cb = pickCb; pickCb = null; hideHint(); cb({ lat: e.latlng.lat, lon: e.latlng.lng }); return; }
          if (editing && sel) insertOnLine(r, e.latlng);
          else if (editing) addEnd(e.latlng);
          else selectRoute(r.id);
        })
        .addTo(routesLayer);
      r.points.forEach(function (p, i) {
        var isNav = S.nav && S.nav.type === 'route' && S.nav.routeId === r.id && S.nav.idx === i;
        var m = L.marker([p.lat, p.lon], { icon: wpIcon(r, i, isNav, p.off), draggable: editing && sel, zIndexOffset: sel ? 500 : 0, opacity: p.off ? .5 : 1 }).addTo(routesLayer);
        if (sel && p.name) m.bindTooltip(p.name, { permanent: map.getZoom() >= 10, direction: 'right', offset: [12, 0], className: 'wp-label' });
        m.on('dragend', function () { var ll = m.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; save(); renderAll(); });
        m.on('click', function () { if (pickCb || editing) return; wpPopup(r, i, m); });
      });
    });
  }
  function wpPopup(r, i, m) {
    var p = r.points[i], prev = prevOn(r, i);
    var leg = p.off ? 'Fora da rota (olho fechado)' : prev ? fNM(G.distNM(prev, p)) + ' NM · ' + fDeg(mag(G.bearing(prev, p))) + 'M' : 'Início da rota';
    var html = '<b>' + (i + 1) + '. ' + esc(p.name || 'Ponto') + '</b><div class="pc">' + esc(fCoord(p)) + '</div><div>' + leg + '</div>' + (p.note ? '<div>' + esc(p.note) + '</div>' : '') +
      '<div class="pb">' + (p.off ? '' : '<button data-a="go">Navegar daqui</button>') + '<button data-a="tog">' + (p.off ? 'Pôr de volta na rota' : 'Tirar da rota') + '</button><button data-a="edit">Editar</button></div>';
    m.bindPopup(html).openPopup();
    var el = m.getPopup().getElement();
    if (!p.off) el.querySelector('[data-a=go]').onclick = function () { startNav(r.id, i); map.closePopup(); };
    el.querySelector('[data-a=tog]').onclick = function () { toggleWp(r, i); map.closePopup(); save(); renderAll(); };
    el.querySelector('[data-a=edit]').onclick = function () { map.closePopup(); openEditor({ kind: 'wp', routeId: r.id, idx: i }); };
  }
  function drawMarks() {
    marksLayer.clearLayers();
    S.marks.forEach(function (mk) {
      var m = L.marker([mk.lat, mk.lon], { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="mk-icon"></div>' }), zIndexOffset: -100 }).addTo(marksLayer);
      if (map.getZoom() >= 9) m.bindTooltip(mk.name, { permanent: true, direction: 'right', offset: [8, 0], className: 'wp-label' });
      m.on('click', function () {
        if (pickCb || editing) return;
        var html = '<b>' + esc(mk.name) + '</b><div class="pc">' + esc(fCoord(mk)) + '</div>' + (mk.note ? '<div>' + esc(mk.note) + '</div>' : '') +
          '<div class="pb"><button data-a="go">Ir até aqui</button><button data-a="add">Pôr na rota</button><button data-a="edit">Editar</button></div>';
        m.bindPopup(html).openPopup();
        var el = m.getPopup().getElement();
        el.querySelector('[data-a=go]').onclick = function () { gotoMark(mk); map.closePopup(); };
        el.querySelector('[data-a=add]').onclick = function () { addMarkToRoute(mk); map.closePopup(); };
        el.querySelector('[data-a=edit]').onclick = function () { map.closePopup(); openEditor({ kind: 'mark', id: mk.id }); };
      });
    });
  }
  var booted = false;
  map.on('zoomend', function () { if (booted) { drawRoutes(); drawMarks(); } });

  // Toque no mapa: escolher coordenada ou adicionar ponto à rota
  map.on('click', function (e) {
    var p = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (pickCb) { var cb = pickCb; pickCb = null; hideHint(); cb(p); return; }
    if (editing) addEnd(e.latlng);
  });
  function addEnd(ll) {
    var r = route(); if (!r) return;
    r.points.push({ name: 'Ponto ' + (r.points.length + 1), lat: ll.lat, lon: ll.lng, note: '' });
    save(); renderAll(); toast('Ponto ' + r.points.length + ' adicionado no fim');
  }
  function showHint(text, onDone, doneLabel) {
    var h = $('#mapHint'); h.innerHTML = '<span>' + esc(text) + '</span>' + (onDone ? '<button type="button">' + esc(doneLabel || 'Concluir') + '</button>' : '');
    h.hidden = false; if (onDone) h.querySelector('button').onclick = onDone;
  }
  function hideHint() { $('#mapHint').hidden = true; }
  function setEditing(on) {
    editing = on;
    if (on) { collapseSheet(); showHint('Toque na linha para inserir no meio, ou fora dela para pôr no fim. Arraste os números.', function () { setEditing(false); }); }
    else hideHint();
    drawRoutes(); renderRoutes();
  }

  // ---------- GPS ----------
  var me = { pos: null, acc: null, sog: null, cog: null, last: null, hist: [] };
  var meMarker = null, accCircle = null, follow = true, watchId = null;
  function meIcon(hdg) {
    var shape = hdg == null ? '<circle cx="17" cy="17" r="9" fill="#1e90ff" stroke="#fff" stroke-width="4"/>' :
      '<g transform="rotate(' + hdg.toFixed(1) + ' 17 17)"><path d="M17 2 7 31l10-6 10 6z" fill="#1e90ff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></g>';
    return L.divIcon({ className: 'me-icon', iconSize: [34, 34], iconAnchor: [17, 17], html: '<svg viewBox="0 0 34 34" width="34" height="34">' + shape + '</svg>' });
  }
  // ---------- Bússola do celular e linha de proa ----------
  var compass = { on: false, mag: null, t: 0, listening: false };
  var hdgLayer = L.layerGroup().addTo(map);
  function screenAngle() { try { return (screen.orientation && screen.orientation.angle) || window.orientation || 0; } catch (e) { return 0; } }
  function onOrient(e) {
    var h = null;
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;   // iPhone (magnético)
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                                         // Android
    if (h == null) return;
    h = G.norm360(h + screenAngle());
    if (compass.mag == null) compass.mag = h;
    else { var d = ((h - compass.mag + 540) % 360) - 180; compass.mag = G.norm360(compass.mag + d * 0.25); } // suaviza
    compass.t = Date.now();
    if (!onOrient._raf) onOrient._raf = setTimeout(function () { onOrient._raf = null; drawMe(); updateHdgCell(); }, 200);
  }
  function startCompass() {
    var go = function () {
      if (compass.listening) return;
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      window.addEventListener('deviceorientation', onOrient, true);
      compass.listening = true; compass.on = true; $('#btnCompass').classList.add('on');
      setTimeout(function () { if (compass.on && compass.mag == null) toast('Bússola sem leitura. Este aparelho pode não ter o sensor, ou ele precisa de calibração.', 5000); }, 3000);
    };
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (r) {
        if (r !== 'granted') toast('Sem permissão para a bússola. Libere "Movimento e orientação" para o navegador.', 5000);
        go();
      }).catch(function () { go(); });
    } else if (window.DeviceOrientationEvent) go();
    else toast('Este aparelho não tem bússola disponível.');
  }
  function stopCompass() {
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    window.removeEventListener('deviceorientation', onOrient, true);
    compass.listening = false; compass.on = false; compass.mag = null; $('#btnCompass').classList.remove('on');
    drawMe(); updateHdgCell();
  }
  // proa verdadeira usada no mapa: bússola (se ligada e lendo) ou rumo do GPS
  function headingTrue() {
    var compOk = compass.on && compass.mag != null && Date.now() - compass.t < 5000;
    if (set.hdgSrc === 'compass' && compOk) return { v: G.norm360(compass.mag + set.decl), src: 'bússola' };
    if (me.cog != null) return { v: me.cog, src: 'GPS' };
    if (compOk) return { v: G.norm360(compass.mag + set.decl), src: 'bússola' };
    return null;
  }
  function drawMe() {
    if (!meMarker || !me.pos) return;
    var h = headingTrue();
    meMarker.setIcon(meIcon(h ? h.v : null));
    hdgLayer.clearLayers();
    if (!h || !(set.hdgLen > 0)) return;
    var len = +set.hdgLen, end = G.destination(me.pos, len, h.v);
    L.polyline([[me.pos.lat, me.pos.lon], [end.lat, end.lon]], { color: '#1e90ff', weight: 3, opacity: .9, dashArray: '10 6', interactive: false }).addTo(hdgLayer);
    var step = len <= 6 ? 1 : 5;
    for (var d = step; d <= len + 1e-9; d += step) {
      var q = G.destination(me.pos, d, h.v);
      L.circleMarker([q.lat, q.lon], { radius: 4, color: '#fff', weight: 2, fillColor: '#1e90ff', fillOpacity: 1, interactive: false })
        .bindTooltip(d + ' NM', { permanent: true, direction: 'right', offset: [6, 0], className: 'wp-label' }).addTo(hdgLayer);
    }
  }
  function updateHdgCell() {
    var lbl = $('#navCogLbl'), h = headingTrue();
    if (compass.on && compass.mag != null) { lbl.textContent = 'Bússola'; $('#navCog').textContent = fDeg(compass.mag) + 'M'; }
    else { lbl.textContent = 'Proa GPS'; $('#navCog').textContent = me.cog != null ? fDeg(mag(me.cog)) + 'M' : '—'; }
  }
  function onPos(pos) {
    var c = pos.coords, p = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now() };
    me.acc = c.accuracy;
    // velocidade e proa
    me.hist.push(p); while (me.hist.length > 30) me.hist.shift();
    var ref = null;
    for (var i = me.hist.length - 2; i >= 0; i--) { if (p.t - me.hist[i].t >= 8000) { ref = me.hist[i]; break; } }
    var calcSog = ref ? G.distNM(ref, p) / ((p.t - ref.t) / 3600000) : null;
    me.sog = (c.speed != null && c.speed >= 0) ? c.speed * 1.943844 : calcSog;
    if (c.heading != null && !isNaN(c.heading) && me.sog > 0.4) me.cog = c.heading;
    else if (ref && G.distNM(ref, p) > 0.01) me.cog = G.bearing(ref, p);
    else if (me.sog != null && me.sog < 0.3) me.cog = null;
    me.pos = p;
    var ll = [p.lat, p.lon];
    if (!meMarker) {
      accCircle = L.circle(ll, { radius: c.accuracy, color: '#1e90ff', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon(null), zIndexOffset: 1000, interactive: false }).addTo(map);
      if (follow) map.setView(ll, Math.max(map.getZoom(), 13));
    } else {
      meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(c.accuracy);
      if (follow) map.panTo(ll, { animate: true });
    }
    drawMe();
    recordTrack(p);
    updateNav();
  }
  function onPosErr(err) {
    var msg = err.code === 1 ? 'Permita o acesso à localização para ver sua posição.' : err.code === 3 ? 'Sinal de GPS fraco. Tentando…' : 'GPS indisponível no momento.';
    $('#navPos').textContent = msg;
    if (err.code === 1) toast(msg, 5000);
  }
  function startGPS() {
    if (!('geolocation' in navigator)) { $('#navPos').textContent = 'Este navegador não tem GPS.'; return; }
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  map.on('dragstart', function () { if (follow) { follow = false; $('#btnFollow').classList.remove('on'); } });
  $('#btnFollow').onclick = function () {
    follow = true; this.classList.add('on');
    if (me.pos) map.setView([me.pos.lat, me.pos.lon], Math.max(map.getZoom(), 13)); else { toast('Procurando sua posição…'); startGPS(); }
  };

  // Rastro
  function recordTrack(p) {
    if (!set.rec || me.acc > 100) return;
    var last = S.track[S.track.length - 1];
    if (last && G.distNM(last, p) < 0.027 && p.t - last.t < 120000) return; // ~50 m
    if (last && G.distNM(last, p) < 0.005) return;
    S.track.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), t: p.t });
    if (S.track.length > 20000) S.track.splice(0, S.track.length - 20000);
    trackLine.addLatLng([p.lat, p.lon]);
    if (S.track.length % 5 === 0) save();
  }

  // ---------- Navegação ----------
  function startNav(routeId, idx) {
    var r = route(routeId); if (!r || !r.points.length) return;
    var k = findOn(r, Math.min(Math.max(0, idx), r.points.length - 1), 1); if (k < 0) k = findOn(r, r.points.length - 1, -1);
    if (k < 0) { toast('Todos os pontos desta rota estão fora da rota.'); return; }
    S.nav = { type: 'route', routeId: routeId, idx: k };
    if (S.selRoute !== routeId) S.selRoute = routeId;
    save(); renderAll(); toast('Navegando para ' + (r.points[S.nav.idx].name || 'ponto ' + (S.nav.idx + 1)));
  }
  function gotoMark(mk) { S.nav = { type: 'goto', target: { name: mk.name, lat: mk.lat, lon: mk.lon } }; save(); renderAll(); toast('Indo para ' + mk.name); }
  function navTarget() {
    if (!S.nav) return null;
    if (S.nav.type === 'goto') return { p: S.nav.target, prev: null, label: S.nav.target.name };
    var r = route(S.nav.routeId); if (!r || !r.points[S.nav.idx]) { S.nav = null; return null; }
    return { p: r.points[S.nav.idx], prev: prevOn(r, S.nav.idx), label: (S.nav.idx + 1) + '. ' + (r.points[S.nav.idx].name || 'Ponto'), r: r };
  }
  function stepNav(d) {
    if (!S.nav || S.nav.type !== 'route') return;
    var r = route(S.nav.routeId); var n = findOn(r, S.nav.idx + d, d);
    if (n < 0) return;
    S.nav.idx = n; save(); renderAll();
  }
  function updateNav() {
    var t = navTarget();
    $('#navActions').hidden = !S.nav;
    $('#btnPrevWp').hidden = $('#btnNextWp').hidden = !(S.nav && S.nav.type === 'route');
    $('#navSog').textContent = me.sog != null ? nf(me.sog, 1) + ' nós' : '—';
    updateHdgCell();
    $('#navGps').textContent = me.acc != null ? '±' + Math.round(me.acc) + ' m' : '—';
    $('#navPos').textContent = me.pos ? fCoord(me.pos) : $('#navPos').textContent;
    if (!t) {
      $('#navTarget').textContent = 'Sem rota ativa'; $('#navDist').textContent = '—'; $('#navBrg').textContent = '—'; $('#navEta').textContent = '—'; $('#navXte').textContent = '—';
      navLine.setLatLngs([]); return;
    }
    $('#navTarget').textContent = t.label;
    if (!me.pos) { $('#navDist').textContent = '…'; $('#navBrg').textContent = '…'; $('#navEta').textContent = '—'; navLine.setLatLngs([]); return; }
    var d = G.distNM(me.pos, t.p), b = G.bearing(me.pos, t.p);
    $('#navDist').textContent = fNM(d) + ' NM';
    $('#navBrg').textContent = fDeg(mag(b)) + 'M';
    $('#navBrg').title = fDeg(b) + ' verdadeiro';
    if (me.sog && me.sog > 0.5) { var h = d / me.sog; $('#navEta').textContent = fClock(new Date(Date.now() + h * 3600000)); }
    else $('#navEta').textContent = '—';
    if (t.prev) { var x = G.crossTrack(t.prev, t.p, me.pos); $('#navXte').textContent = nf(Math.abs(x), 2) + (x >= 0 ? ' BE' : ' BB'); }
    else $('#navXte').textContent = '—';
    navLine.setLatLngs([[me.pos.lat, me.pos.lon], [t.p.lat, t.p.lon]]);
    // chegada
    if (d <= set.arrive) {
      var nx = S.nav.type === 'route' ? findOn(t.r, S.nav.idx + 1, 1) : -1;
      if (nx >= 0) {
        S.nav.idx = nx; save(); toast('Chegou em ' + (t.p.name || 'ponto') + '. Próximo: ' + (t.r.points[S.nav.idx].name || 'ponto ' + (S.nav.idx + 1)), 4000);
        renderAll();
      } else if (!updateNav._arrived) { updateNav._arrived = true; toast('Chegou ao destino: ' + (t.p.name || ''), 5000); }
    } else updateNav._arrived = false;
  }
  $('#btnPrevWp').onclick = function () { stepNav(-1); };
  $('#btnNextWp').onclick = function () { stepNav(1); };
  $('#btnStopNav').onclick = function () { S.nav = null; save(); renderAll(); };

  // ---------- Folha inferior ----------
  var sheet = $('#sheet');
  function collapseSheet() { sheet.classList.add('collapsed'); }
  $('#sheetGrip').onclick = function () { sheet.classList.toggle('collapsed'); };
  var curTab = 'rotas';
  document.querySelectorAll('.tab').forEach(function (b) {
    b.onclick = function () {
      curTab = b.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.id !== 'pane-' + curTab; });
      sheet.classList.remove('collapsed');
      if (curTab === 'offline') renderOffline();
    };
  });

  // ---------- Painel: Rotas ----------
  var confirmDel = false, pendingImport = null, delAsk = -1;
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 2 2 3.3l3.2 3.2C3.4 7.9 2.1 9.9 1.5 12c1.2 2.6 5 7 10.5 7 1.9 0 3.6-.5 5-1.3l3.7 3.7 1.3-1.3L3.3 2Zm8.7 14.5a4.5 4.5 0 0 1-4.3-5.8l1.8 1.8a2.2 2.2 0 0 0 2.5 2.5l1.8 1.8c-.5.2-1.1.3-1.8.3ZM12 5c-1.3 0-2.5.2-3.6.6l2 2c.5-.1 1-.1 1.6-.1a4.5 4.5 0 0 1 4.4 5.6l3.2 3.2c1.4-1.2 2.4-2.6 2.9-3.9C21.3 9.4 17.5 5 12 5Z"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.6v-8H10Zm3.4 0v8H15v-8h-1.6Z"/></svg>';
  function routeTotals(r) {
    var a = activePts(r), tot = 0; for (var i = 1; i < a.length; i++) tot += G.distNM(a[i - 1], a[i]);
    return tot;
  }
  function selectRoute(id) { S.selRoute = id; confirmDel = false; save(); renderAll(); }
  function renderRoutes() {
    var pane = $('#pane-rotas'), r = route();
    var h = [];
    if (pendingImport) {
      h.push('<div class="warn">O arquivo tem ' + pendingImport.marks.length + ' pontos soltos. O que fazer com eles?</div><div class="row-btns"><button class="btn primary sm" data-a="imp-route">Criar rota com eles</button><button class="btn sm" data-a="imp-marks">Guardar como pontos de referência</button><button class="btn ghost sm" data-a="imp-cancel">Cancelar</button></div>');
    }
    h.push('<div class="route-head">' + (r ? '<span class="swatch" style="background:' + r.color + '"></span>' : '') +
      '<select id="routeSel" aria-label="Rota">' + S.routes.map(function (x) { return '<option value="' + x.id + '"' + (r && x.id === r.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<button class="btn sm" data-a="new">Nova</button></div>');
    if (!r) { h.push('<p class="muted">Nenhuma rota. Crie uma nova ou importe um arquivo GPX/KML.</p><div class="row-btns"><button class="btn sm" data-a="import">Importar arquivo</button></div>'); pane.innerHTML = h.join(''); bindRoutes(pane); return; }
    var tot = routeTotals(r);
    h.push('<div class="route-sum"><span><b>' + fNM(tot) + '</b> NM</span><span><b>' + activePts(r).length + '</b> pontos' + (activePts(r).length < r.points.length ? ' (' + (r.points.length - activePts(r).length) + ' fora)' : '') + '</span><span>a ' + nf(set.speed, 1) + ' nós: <b>' + fDur(tot / set.speed) + '</b></span></div>');
    if (r.draft) h.push('<div class="warn">Rascunho com posições aproximadas. Ajuste os pontos ao canal antes de seguir.</div>');
    h.push('<div class="row-btns">' +
      '<button class="btn primary sm" data-a="nav">' + (S.nav && S.nav.routeId === r.id ? 'Navegando' : 'Navegar') + '</button>' +
      '<button class="btn sm" data-a="edit-map">' + (editing ? 'Concluir edição' : 'Editar no mapa') + '</button>' +
      '<button class="btn sm" data-a="add">+ Ponto</button>' +
      '<button class="btn sm" data-a="fit">Ver no mapa</button></div>');
    h.push('<ol class="wps">');
    r.points.forEach(function (p, i) {
      var prev = prevOn(r, i), active = S.nav && S.nav.type === 'route' && S.nav.routeId === r.id && S.nav.idx === i;
      var leg = p.off ? 'Fora da rota' : prev ? fNM(G.distNM(prev, p)) + ' NM · ' + fDeg(mag(G.bearing(prev, p))) + 'M (' + fDeg(G.bearing(prev, p)) + 'V)' : 'Início';
      h.push('<li class="wp' + (active ? ' active' : '') + (p.off ? ' off' : '') + '"><span class="num" style="border-color:' + r.color + (active ? ';background:' + r.color : '') + '">' + (i + 1) + '</span>' +
        '<div class="main" data-a="focus" data-i="' + i + '"><div class="name">' + esc(p.name || 'Ponto ' + (i + 1)) + '</div><div class="coord">' + esc(fCoord(p)) + '</div><div class="leg">' + leg + '</div>' + (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') + '</div>' +
        '<div class="acts">' +
          '<button class="ico eye' + (p.off ? ' is-off' : '') + '" data-a="tog" data-i="' + i + '" aria-label="' + (p.off ? 'Pôr de volta na rota' : 'Tirar da rota') + '" title="' + (p.off ? 'Pôr de volta na rota' : 'Tirar da rota') + '">' + (p.off ? EYE_OFF : EYE) + '</button>' +
          '<button class="ico" data-a="up" data-i="' + i + '" aria-label="Subir" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button class="ico" data-a="down" data-i="' + i + '" aria-label="Descer" ' + (i === r.points.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button class="ico" data-a="editwp" data-i="' + i + '" aria-label="Editar">✎</button>' +
          (delAsk === i ? '<button class="ico trash ask" data-a="delwp" data-i="' + i + '" aria-label="Confirmar: apagar ponto">Apagar?</button>' : '<button class="ico trash" data-a="delwp" data-i="' + i + '" aria-label="Apagar ponto">' + TRASH + '</button>') +
        '</div>' +
        (i < r.points.length - 1 ? '<button class="ins" data-a="ins" data-i="' + i + '">+ inserir ponto aqui</button>' : '') + '</li>');
    });
    h.push('</ol>');
    h.push('<h3>Colar lista de coordenadas</h3><textarea id="pasteWp" rows="3" style="width:100%;font:13px var(--mono);border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg);color:var(--fg)" placeholder="Um ponto por linha, ex.:\nPonta do Boi 23°58.0\'S 45°15.1\'W\nMoela -24.0506, -46.2633"></textarea><div class="row-btns"><button class="btn sm" data-a="paste">Adicionar ao fim da rota</button></div>');
    h.push('<h3>Rota</h3><div class="row-btns"><button class="btn sm" data-a="rename">Renomear</button><button class="btn sm" data-a="reverse">Inverter</button><button class="btn sm" data-a="draft">' + (r.draft ? 'Marcar como pronta' : 'Marcar como rascunho') + '</button><button class="btn sm" data-a="export">Exportar GPX</button><button class="btn sm" data-a="import">Importar arquivo</button><button class="btn danger sm" data-a="del">Apagar rota</button></div>');
    if (confirmDel) h.push('<div class="confirm">Apagar "' + esc(r.name) + '"? <span class="spacer"></span><button class="btn ghost sm" data-a="del-no">Cancelar</button><button class="btn danger sm" data-a="del-yes">Apagar</button></div>');
    pane.innerHTML = h.join('');
    bindRoutes(pane);
  }
  var COLORS = ['#e83fc6', '#2ec4d6', '#ff8c1a', '#7bd35a', '#a77bff', '#ff4d6d'];
  function bindRoutes(pane) {
    var sel = $('#routeSel', pane); if (sel) sel.onchange = function () { selectRoute(sel.value); fitRoute(); };
    pane.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      var a = b.dataset.a, i = +b.dataset.i, r = route();
      if (a !== 'delwp') delAsk = -1;
      if (a === 'new') {
        var nr = { id: uid('r'), name: 'Nova rota ' + (S.routes.length + 1), color: COLORS[S.routes.length % COLORS.length], draft: false, points: [] };
        S.routes.push(nr); S.selRoute = nr.id; save(); renderAll(); setEditing(true);
      } else if (a === 'nav') {
        var start = 0;
        if (me.pos && r.points.length > 1) { var best = Infinity; r.points.forEach(function (p, k) { var d = G.distNM(me.pos, p); if (d < best) { best = d; start = k; } }); if (best < set.arrive * 3 && start < r.points.length - 1) start++; }
        else if (r.points.length > 1) start = 1;
        startNav(r.id, start); collapseSheet();
      } else if (a === 'edit-map') setEditing(!editing);
      else if (a === 'add') openEditor({ kind: 'wp', routeId: r.id, idx: r.points.length, isNew: true });
      else if (a === 'ins') openEditor({ kind: 'wp', routeId: r.id, idx: i + 1, isNew: true });
      else if (a === 'fit') { fitRoute(); collapseSheet(); }
      else if (a === 'focus') { var p = r.points[i]; follow = false; $('#btnFollow').classList.remove('on'); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12)); collapseSheet(); }
      else if (a === 'up' || a === 'down') {
        var j = a === 'up' ? i - 1 : i + 1; var tmp = r.points[i]; r.points[i] = r.points[j]; r.points[j] = tmp;
        if (S.nav && S.nav.routeId === r.id) { if (S.nav.idx === i) S.nav.idx = j; else if (S.nav.idx === j) S.nav.idx = i; }
        save(); renderAll();
      } else if (a === 'editwp') openEditor({ kind: 'wp', routeId: r.id, idx: i });
      else if (a === 'tog') { toggleWp(r, i); save(); renderAll(); toast(r.points[i].off ? 'Ponto ' + (i + 1) + ' fora da rota' : 'Ponto ' + (i + 1) + ' de volta na rota'); }
      else if (a === 'delwp') {
        if (delAsk !== i) { delAsk = i; renderRoutes(); return; }
        delAsk = -1; var nm = r.points[i].name || 'Ponto ' + (i + 1); deleteWp(r, i); save(); renderAll(); toast('"' + nm + '" apagado');
      }
      else if (a === 'paste') {
        var lines = $('#pasteWp', pane).value.split(/\r?\n/), ok = 0, bad = [];
        lines.forEach(function (l) { if (!l.trim()) return; var q = G.parseLine(l); if (q) { r.points.push({ name: q.name || 'Ponto ' + (r.points.length + 1), lat: q.lat, lon: q.lon, note: q.note || '' }); ok++; } else bad.push(l.trim()); });
        save(); renderAll();
        toast(ok + ' ponto(s) adicionado(s)' + (bad.length ? '. Não entendi: ' + bad.slice(0, 2).join(' | ') : ''), bad.length ? 6000 : 2600);
      } else if (a === 'rename') {
        var head = pane.querySelector('.route-head');
        head.innerHTML = '<input type="text" id="renameIn" value="' + esc(r.name) + '" maxlength="60"><button class="btn primary sm" data-a="rename-ok">OK</button>';
        var inp = $('#renameIn', head); inp.focus(); inp.select();
        inp.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); head.querySelector('[data-a=rename-ok]').click(); } };
      } else if (a === 'rename-ok') { var v = $('#renameIn').value.trim(); if (v) r.name = v; save(); renderAll(); }
      else if (a === 'reverse') { r.points.reverse(); if (S.nav && S.nav.routeId === r.id) S.nav.idx = r.points.length - 1 - S.nav.idx; save(); renderAll(); toast('Rota invertida'); }
      else if (a === 'draft') { r.draft = !r.draft; save(); renderAll(); }
      else if (a === 'export') shareFile(slug(r.name) + '.gpx', G.toGPX([{ name: r.name, points: activePts(r) }], [], null));
      else if (a === 'import') $('#fileInput').click();
      else if (a === 'del') { confirmDel = true; renderRoutes(); }
      else if (a === 'del-no') { confirmDel = false; renderRoutes(); }
      else if (a === 'del-yes') {
        S.routes = S.routes.filter(function (x) { return x.id !== r.id; });
        if (S.nav && S.nav.routeId === r.id) S.nav = null;
        S.selRoute = S.routes[0] && S.routes[0].id; confirmDel = false; save(); renderAll();
      } else if (a === 'imp-route') {
        var nr2 = { id: uid('r'), name: pendingImport.name, color: COLORS[S.routes.length % COLORS.length], draft: false, points: pendingImport.marks.map(function (m, k) { return { name: m.name || 'Ponto ' + (k + 1), lat: m.lat, lon: m.lon, note: m.note || '' }; }) };
        S.routes.push(nr2); S.selRoute = nr2.id; pendingImport = null; save(); renderAll(); fitRoute();
      } else if (a === 'imp-marks') {
        pendingImport.marks.forEach(function (m) { S.marks.push({ id: uid('m'), name: m.name || 'Ponto', lat: m.lat, lon: m.lon, note: m.note || '' }); });
        pendingImport = null; save(); renderAll();
      } else if (a === 'imp-cancel') { pendingImport = null; renderRoutes(); }
    };
  }
  function fitRoute() {
    var r = route(); if (!r || !r.points.length) return;
    follow = false; $('#btnFollow').classList.remove('on');
    map.fitBounds(L.latLngBounds(r.points.map(function (p) { return [p.lat, p.lon]; })), { paddingTopLeft: [30, 170], paddingBottomRight: [30, 90], maxZoom: 14 });
  }
  function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'rota'; }

  // ---------- Painel: Pontos ----------
  function addMarkToRoute(mk) {
    var r = route(); if (!r) { toast('Crie ou escolha uma rota primeiro.'); return; }
    r.points.push({ name: mk.name, lat: mk.lat, lon: mk.lon, note: mk.note || '' }); save(); renderAll();
    toast('"' + mk.name + '" virou o ponto ' + r.points.length + ' de ' + r.name);
  }
  function renderMarks() {
    var pane = $('#pane-pontos'), h = [];
    h.push('<p class="muted">Pontos de referência da viagem. Não fazem parte de nenhuma rota, mas você pode colocá-los na rota selecionada ou navegar direto até eles.</p>');
    h.push('<div class="row-btns"><button class="btn sm" data-a="addmk">+ Ponto</button><button class="btn sm" data-a="pickmk">Marcar no mapa</button><button class="btn sm" data-a="exportmk">Exportar GPX</button></div>');
    h.push('<ol class="wps">');
    S.marks.forEach(function (mk, i) {
      var dist = me.pos ? ' · ' + fNM(G.distNM(me.pos, mk)) + ' NM ' + fDeg(mag(G.bearing(me.pos, mk))) + 'M de você' : '';
      h.push('<li class="wp"><span class="num" style="border-color:#f2b33d">◆</span><div class="main" data-a="focusmk" data-i="' + i + '"><div class="name">' + esc(mk.name) + '</div><div class="coord">' + esc(fCoord(mk)) + '</div>' + (dist ? '<div class="leg">' + dist.slice(3) + '</div>' : '') + (mk.note ? '<div class="note">' + esc(mk.note) + '</div>' : '') + '</div>' +
        '<div class="acts"><button class="ico" data-a="gomk" data-i="' + i + '" aria-label="Ir até">➤</button><button class="ico" data-a="tomk" data-i="' + i + '" aria-label="Pôr na rota">＋</button><button class="ico" data-a="editmk" data-i="' + i + '" aria-label="Editar">✎</button></div></li>');
    });
    h.push('</ol>');
    h.push('<h3>Colar lista de pontos</h3><textarea id="pasteMk" rows="3" style="width:100%;font:13px var(--mono);border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg);color:var(--fg)" placeholder="Nome e coordenada, um por linha"></textarea><div class="row-btns"><button class="btn sm" data-a="pastemk">Adicionar pontos</button></div>');
    pane.innerHTML = h.join('');
    pane.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a, mk = S.marks[+b.dataset.i];
      if (a === 'addmk') openEditor({ kind: 'mark', isNew: true });
      else if (a === 'pickmk') { collapseSheet(); showHint('Toque no mapa onde fica o ponto', function () { pickCb = null; hideHint(); }, 'Cancelar'); pickCb = function (p) { openEditor({ kind: 'mark', isNew: true, at: p }); }; }
      else if (a === 'exportmk') shareFile('pontos-referencia.gpx', G.toGPX([], S.marks, null));
      else if (a === 'focusmk') { follow = false; $('#btnFollow').classList.remove('on'); map.setView([mk.lat, mk.lon], Math.max(map.getZoom(), 12)); collapseSheet(); }
      else if (a === 'gomk') { gotoMark(mk); collapseSheet(); }
      else if (a === 'tomk') addMarkToRoute(mk);
      else if (a === 'editmk') openEditor({ kind: 'mark', id: mk.id });
      else if (a === 'pastemk') {
        var ok = 0, bad = 0;
        $('#pasteMk', pane).value.split(/\r?\n/).forEach(function (l) { if (!l.trim()) return; var q = G.parseLine(l); if (q) { S.marks.push({ id: uid('m'), name: q.name || 'Ponto', lat: q.lat, lon: q.lon, note: q.note || '' }); ok++; } else bad++; });
        save(); renderAll(); toast(ok + ' ponto(s) adicionado(s)' + (bad ? ', ' + bad + ' linha(s) não reconhecida(s)' : ''));
      }
    };
  }

  // ---------- Editor de ponto ----------
  var ed = null;
  function openEditor(o) {
    ed = o;
    var p, r = o.kind === 'wp' ? route(o.routeId) : null;
    if (o.kind === 'wp') p = o.isNew ? { name: 'Ponto ' + (o.idx + 1), lat: NaN, lon: NaN, note: '' } : r.points[o.idx];
    else p = o.isNew ? { name: '', lat: NaN, lon: NaN, note: '' } : S.marks.find(function (m) { return m.id === o.id; });
    if (o.at) { p = Object.assign({}, p, o.at); }
    $('#edTitle').textContent = o.isNew ? (o.kind === 'wp' ? 'Novo ponto da rota' : 'Novo ponto de referência') : (o.kind === 'wp' ? 'Ponto ' + (o.idx + 1) + ' de ' + r.name : 'Ponto de referência');
    $('#edName').value = p.name || '';
    $('#edCoord').value = isFinite(p.lat) ? fCoord(p) : (me.pos && o.isNew && !o.at ? '' : '');
    $('#edNote').value = p.note || '';
    $('#edDelete').hidden = !!o.isNew;
    $('#edDelete').textContent = 'Apagar'; $('#edDelete').dataset.confirm = '';
    validateCoord();
    $('#editor').hidden = false;
    setTimeout(function () { (o.isNew ? $('#edCoord') : $('#edName')).focus(); }, 50);
  }
  function closeEditor() { $('#editor').hidden = true; ed = null; }
  function validateCoord() {
    var v = $('#edCoord').value, help = $('#edCoordHelp');
    if (!v.trim()) { help.className = 'help'; help.textContent = 'Aceita graus e minutos (24°41.211\'S 47°25.284\'W), graus-min-seg ou decimal (-24.6869, -47.4214).'; return null; }
    var c = G.parseCoord(v);
    if (c) { help.className = 'help'; help.textContent = '✓ ' + G.formatCoord(c, 'ddm') + '  ·  ' + G.formatCoord(c, 'dec'); }
    else { help.className = 'help err'; help.textContent = 'Não reconheci essa coordenada. Use, por exemplo, 24°41.211\'S 47°25.284\'W ou -24.6869, -47.4214.'; }
    return c;
  }
  $('#edCoord').oninput = validateCoord;
  $('#edCancel').onclick = closeEditor;
  $('#editor').onclick = function (e) { if (e.target.id === 'editor') closeEditor(); };
  $('#edHere').onclick = function () {
    if (!me.pos) { toast('Ainda sem posição do GPS.'); return; }
    $('#edCoord').value = fCoord(me.pos); validateCoord();
  };
  $('#edPick').onclick = function () {
    var keep = { name: $('#edName').value, note: $('#edNote').value }, o = ed;
    $('#editor').hidden = true; collapseSheet();
    showHint('Toque no mapa para escolher a posição', function () { pickCb = null; hideHint(); openEditor(o); }, 'Cancelar');
    pickCb = function (p) { openEditor(o); $('#edName').value = keep.name; $('#edNote').value = keep.note; $('#edCoord').value = fCoord(p); validateCoord(); };
  };
  $('#edDelete').onclick = function () {
    var b = $('#edDelete');
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Toque de novo para apagar'; return; }
    if (ed.kind === 'wp') {
      deleteWp(route(ed.routeId), ed.idx);
    } else S.marks = S.marks.filter(function (m) { return m.id !== ed.id; });
    save(); closeEditor(); renderAll(); toast('Ponto apagado');
  };
  $('#editorForm').onsubmit = function (e) {
    e.preventDefault();
    var c = validateCoord();
    if (!c) { $('#edCoord').focus(); if (!$('#edCoord').value.trim()) { var h = $('#edCoordHelp'); h.className = 'help err'; h.textContent = 'Informe a coordenada, ou use "Escolher no mapa".'; } return; }
    var data = { name: $('#edName').value.trim(), lat: c.lat, lon: c.lon, note: $('#edNote').value.trim() };
    if (ed.kind === 'wp') {
      var r = route(ed.routeId);
      if (!data.name) data.name = 'Ponto ' + (ed.idx + 1);
      if (ed.isNew) { r.points.splice(ed.idx, 0, data); if (S.nav && S.nav.routeId === r.id && S.nav.idx >= ed.idx) S.nav.idx++; }
      else Object.assign(r.points[ed.idx], data);
    } else {
      if (!data.name) data.name = 'Ponto';
      if (ed.isNew) S.marks.push(Object.assign({ id: uid('m') }, data));
      else Object.assign(S.marks.find(function (m) { return m.id === ed.id; }), data);
    }
    save(); closeEditor(); renderAll(); toast('Salvo');
  };

  // ---------- Importar / exportar ----------
  $('#fileInput').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var txt = String(rd.result), name = f.name.replace(/\.[^.]+$/, ''), res;
      try {
        if (/\.gpx$/i.test(f.name) || /<gpx[\s>]/i.test(txt)) res = G.parseGPX(txt);
        else if (/\.kml$/i.test(f.name) || /<kml[\s>]/i.test(txt)) res = G.parseKML(txt);
        else res = G.parseText(txt);
      } catch (e) { res = null; }
      if (!res || (!res.routes.length && !res.marks.length)) { toast('Não encontrei pontos nesse arquivo. Use GPX, KML ou texto com coordenadas.', 5000); return; }
      res.routes.forEach(function (r, k) {
        S.routes.push({ id: uid('r'), name: r.name || name, color: COLORS[(S.routes.length) % COLORS.length], draft: false, points: r.points.map(function (p, i) { return { name: p.name || 'Ponto ' + (i + 1), lat: p.lat, lon: p.lon, note: p.note || '' }; }) });
        if (k === 0) S.selRoute = S.routes[S.routes.length - 1].id;
      });
      if (res.routes.length) {
        res.marks.forEach(function (m) { S.marks.push({ id: uid('m'), name: m.name || 'Ponto', lat: m.lat, lon: m.lon, note: m.note || '' }); });
        toast(res.routes.length + ' rota(s) importada(s)' + (res.marks.length ? ' e ' + res.marks.length + ' ponto(s)' : ''));
        save(); renderAll(); fitRoute();
      } else { pendingImport = { name: name, marks: res.marks }; document.querySelector('.tab[data-tab=rotas]').click(); renderRoutes(); }
    };
    rd.readAsText(f);
  };
  function shareFile(filename, text) {
    var blob = new Blob([text], { type: 'application/gpx+xml' });
    try {
      var file = new File([blob], filename, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: filename }).catch(function () { }); return; }
    } catch (e) { }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------- Painel: Offline ----------
  var dl = { running: false, cancel: false, done: 0, total: 0, fail: 0, bytes: 0, seaCors: true };
  function dlLayers() { return ['sat', 'map', 'sea'].filter(function (k) { return set['dl' + k[0].toUpperCase() + k.slice(1)]; }); }
  function corridorTiles() {
    var lines = S.routes.map(function (r) { return activePts(r); }).filter(function (p) { return p.length > 1; });
    var pts = S.marks.concat(S.routes.reduce(function (a, r) { return r.points.length === 1 ? a.concat(r.points) : a; }, []));
    var all = lines.reduce(function (a, l) { return a.concat(l); }, []).concat(pts);
    if (!all.length) return [];
    var s = Math.min.apply(null, all.map(function (p) { return p.lat; })) - .3, n = Math.max.apply(null, all.map(function (p) { return p.lat; })) + .3;
    var w = Math.min.apply(null, all.map(function (p) { return p.lon; })) - .3, e = Math.max.apply(null, all.map(function (p) { return p.lon; })) + .3;
    var t = G.tilesForBounds(s, w, n, e, 5, 9);
    return t.concat(G.tilesForCorridor(lines, pts, +set.buf, 10, +set.zmax));
  }
  function screenTiles() {
    var b = map.getBounds(), z0 = Math.max(5, map.getZoom() - 2);
    return G.tilesForBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), z0, Math.max(+set.zmax, Math.min(17, map.getZoom() + 2)));
  }
  function estimate(tiles) {
    var kb = dlLayers().reduce(function (a, k) { return a + SOURCES[k].kb; }, 0);
    return tiles.length * dlLayers().length + ' arquivos, cerca de ' + nf(tiles.length * kb / 1024, 0) + ' MB';
  }
  function renderOffline() {
    var pane = $('#pane-offline');
    var corr = corridorTiles(), scr = screenTiles();
    var zOpts = [[12, 'Geral (zoom 12)'], [13, 'Médio (zoom 13)'], [14, 'Bom (zoom 14)'], [15, 'Detalhado (zoom 15)'], [16, 'Muito detalhado (zoom 16)']];
    var bOpts = [[1, '1 NM'], [2, '2 NM'], [3, '3 NM'], [5, '5 NM']];
    pane.innerHTML =
      '<div class="warn">Baixe com internet, antes de sair. Depois o mapa e o GPS funcionam sem sinal. No iPhone, adicione o app à Tela de Início primeiro e baixe de dentro dele.</div>' +
      '<div class="stat" id="offStat">Verificando armazenamento…</div>' +
      '<h3>O que baixar</h3>' +
      '<label class="opt"><input type="checkbox" id="dlSat"' + (set.dlSat ? ' checked' : '') + '> Satélite</label>' +
      '<label class="opt"><input type="checkbox" id="dlMap"' + (set.dlMap ? ' checked' : '') + '> Mapa</label>' +
      '<label class="opt"><input type="checkbox" id="dlSea"' + (set.dlSea ? ' checked' : '') + '> Sinais náuticos</label>' +
      '<div class="grid2"><label class="field">Faixa de cada lado da rota<select id="bufSel">' + bOpts.map(function (o) { return '<option value="' + o[0] + '"' + (+set.buf === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field">Detalhe máximo<select id="zSel">' + zOpts.map(function (o) { return '<option value="' + o[0] + '"' + (+set.zmax === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<h3>Todas as rotas e pontos</h3><div class="estimate">' + estimate(corr) + '</div>' +
      '<div class="row-btns"><button class="btn primary" data-a="dl-corr"' + (dl.running ? ' disabled' : '') + '>Baixar trajeto</button></div>' +
      '<h3>Área que está na tela</h3><p class="muted">Use para trechos estreitos, como o Varadouro: aproxime o mapa no trecho e baixe com mais detalhe (até zoom ' + Math.max(+set.zmax, Math.min(17, map.getZoom() + 2)) + ').</p><div class="estimate">' + estimate(scr) + '</div>' +
      '<div class="row-btns"><button class="btn" data-a="dl-screen"' + (dl.running || scr.length > 40000 ? ' disabled' : '') + '>Baixar área da tela</button>' + (scr.length > 40000 ? '<span class="muted">Aproxime mais o mapa.</span>' : '') + '</div>' +
      '<div id="dlBox"' + (dl.running || dl.total ? '' : ' hidden') + '><div class="progress"><div id="dlBar"></div></div><div class="stat" id="dlTxt"></div><div class="row-btns" style="margin-top:6px"><button class="btn sm" data-a="dl-cancel"' + (dl.running ? '' : ' hidden') + '>Cancelar download</button></div></div>' +
      '<h3>Carta náutica</h3>' +
      (set.chartInfo ? '<div class="stat">No aparelho: ' + nf(set.chartInfo.count, 0) + ' blocos · ' + esc(set.chartInfo.name) + '</div>' : '<p class="muted">Cartas da Marinha de Paraty a Paranaguá, cerca de 24 MB. Baixe no Wi-Fi.</p>') +
      '<div class="row-btns"><button class="btn' + (set.chartInfo ? '' : ' primary') + '" data-a="chart-dl"' + (chartImp.running ? ' disabled' : '') + '>' + (set.chartInfo ? 'Baixar de novo' : 'Baixar cartas') + '</button>' +
      '<button class="btn sm" data-a="chart-imp"' + (chartImp.running ? ' disabled' : '') + '>Importar arquivo</button>' +
      (set.chartInfo ? '<button class="btn danger sm" data-a="chart-del">Remover cartas</button>' : '') + '</div>' +
      '<div id="chartBox"' + (chartImp.running ? '' : ' hidden') + '><div class="progress"><div id="chartBar"></div></div><div class="stat" id="chartTxt"></div></div>' +
      '<h3>Manutenção</h3><div class="row-btns"><button class="btn danger sm" data-a="clear">Apagar mapas baixados</button></div><div id="clearBox"></div>';
    ['dlSat', 'dlMap', 'dlSea'].forEach(function (k) { $('#' + k, pane).onchange = function () { set[k] = this.checked; save(); renderOffline(); }; });
    $('#bufSel', pane).onchange = function () { set.buf = +this.value; save(); renderOffline(); };
    $('#zSel', pane).onchange = function () { set.zmax = +this.value; save(); renderOffline(); };
    pane.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      var a = b.dataset.a;
      if (a === 'dl-corr') runDownload(corridorTiles());
      else if (a === 'dl-screen') runDownload(screenTiles());
      else if (a === 'dl-cancel') dl.cancel = true;
      else if (a === 'clear') $('#clearBox').innerHTML = '<div class="confirm">Apagar todos os mapas salvos no aparelho? <span class="spacer"></span><button class="btn ghost sm" data-a="clear-no">Cancelar</button><button class="btn danger sm" data-a="clear-yes">Apagar</button></div>';
      else if (a === 'clear-no') $('#clearBox').innerHTML = '';
      else if (a === 'chart-imp') $('#chartInput').click();
      else if (a === 'chart-dl') downloadCharts();
      else if (a === 'chart-del') { caches.delete(CHART_CACHE).then(function () { set.chartInfo = null; save(); applyLayers(); toast('Cartas removidas'); renderOffline(); }); }
      else if (a === 'clear-yes') { caches.delete(TILE_CACHE).then(function () { toast('Mapas apagados'); dl.total = 0; renderOffline(); }); }
    };
    updateDlUi(); chartUi(); refreshStorage();
  }
  function refreshStorage() {
    var el = $('#offStat'); if (!el) return;
    var parts = [navigator.onLine ? 'Com internet' : 'Sem internet'];
    var swOk = navigator.serviceWorker && navigator.serviceWorker.controller;
    parts.push(swOk ? 'app disponível offline' : 'app ainda não está salvo para uso offline (abra de novo com internet)');
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        parts.push(nf((est.usage || 0) / 1048576, 0) + ' MB usados');
        el.textContent = parts.join(' · ');
      });
    } else el.textContent = parts.join(' · ');
  }
  function updateDlUi() {
    var bar = $('#dlBar'), txt = $('#dlTxt'); if (!bar) return;
    var pct = dl.total ? Math.round(dl.done / dl.total * 100) : 0;
    bar.style.width = pct + '%';
    txt.textContent = dl.running ? 'Baixando ' + dl.done + ' de ' + dl.total + ' (' + pct + '%) · ' + nf(dl.bytes / 1048576, 1) + ' MB' + (dl.fail ? ' · ' + dl.fail + ' falhas' : '')
      : dl.total ? 'Concluído: ' + (dl.done - dl.fail) + ' de ' + dl.total + ' salvos' + (dl.fail ? ' · ' + dl.fail + ' falharam (tente de novo para completar)' : '') + (!dl.seaCors ? ' · sinais náuticos não puderam ser salvos' : '') : '';
  }
  async function runDownload(tiles) {
    var layers = dlLayers();
    if (!layers.length) { toast('Escolha pelo menos uma camada.'); return; }
    if (!navigator.onLine) { toast('Sem internet agora. Conecte para baixar.'); return; }
    if (!('caches' in window)) { toast('Este navegador não permite salvar mapas. Use Safari ou Chrome.', 5000); return; }
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { } }
    var urls = [];
    layers.forEach(function (k) { tiles.forEach(function (t) { var a = t.split('/'); urls.push({ k: k, u: tileUrl(k, a[0], a[1], a[2]) }); }); });
    Object.assign(dl, { running: true, cancel: false, done: 0, total: urls.length, fail: 0, bytes: 0, seaCors: true });
    renderOffline();
    var cache = await caches.open(TILE_CACHE), i = 0, seaDead = false;
    var wakeLock = null; try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
    async function worker() {
      while (i < urls.length && !dl.cancel) {
        var it = urls[i++];
        try {
          if (it.k === 'sea' && seaDead) throw 0;
          if (await cache.match(it.u)) { dl.done++; continue; }
          var ok = false;
          for (var tryN = 0; tryN < 2 && !ok; tryN++) {
            try {
              var res = await fetch(it.u, { mode: 'cors' });
              if (res.ok) { var bl = await res.clone().blob(); dl.bytes += bl.size; await cache.put(it.u, res); ok = true; }
              else if (res.status === 404) ok = true; // sem dados nesse tile
            } catch (e) { if (it.k === 'sea' && tryN === 1) { seaDead = true; dl.seaCors = false; } }
          }
          if (!ok) dl.fail++;
        } catch (e) { dl.fail++; }
        dl.done++;
        if (dl.done % 10 === 0) updateDlUi();
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    dl.running = false;
    if (wakeLock) try { wakeLock.release(); } catch (e) { }
    toast(dl.cancel ? 'Download cancelado' : 'Mapas salvos no aparelho', 3500);
    if (curTab === 'offline') renderOffline(); else updateDlUi();
  }
  // ---------- Importar cartas (zip com z/x/y.png) ----------
  var chartImp = { running: false };
  async function readZipEntries(file) {
    var tailLen = Math.min(file.size, 65557);
    var tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    var eocd = -1;
    for (var i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Arquivo não é um .zip válido.');
    var count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    var cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder(), p = 0, out = [];
    for (var k = 0; k < count; k++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      var method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
      var nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      out.push({ name: name, method: method, csize: csize, off: off });
      p += 46 + nl + el + cl;
    }
    return out;
  }
  async function entryBlob(file, e) {
    var lh = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
    var start = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    var blob = file.slice(start, start + e.csize);
    if (e.method === 0) return blob;
    if (e.method === 8 && 'DecompressionStream' in window) return await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    throw new Error('Formato de compressão não suportado.');
  }
  function chartUi() {
    var bar = $('#chartBar'), txt = $('#chartTxt'), box = $('#chartBox'); if (!bar) return;
    box.hidden = !chartImp.running && !chartImp.total;
    var pct = chartImp.total ? Math.round(chartImp.done / chartImp.total * 100) : 0;
    bar.style.width = pct + '%';
    txt.textContent = chartImp.running ? 'Importando ' + chartImp.done + ' de ' + chartImp.total + ' (' + pct + '%)' : chartImp.msg || '';
  }
  async function downloadCharts() {
    if (!navigator.onLine) { toast('Sem internet agora. Conecte para baixar as cartas.'); return; }
    chartImp = { running: true, done: 0, total: 0, msg: '' };
    if (curTab === 'offline') renderOffline();
    var txt = function (m) { var t = $('#chartTxt'); if (t) t.textContent = m; var bx = $('#chartBox'); if (bx) bx.hidden = false; };
    try {
      var res = await fetch('cartas/cartas.zip?v=' + CHART_VER, { cache: 'no-store' });
      if (!res.ok) throw new Error('O site respondeu ' + res.status + '.');
      var len = +res.headers.get('Content-Length') || 0, got = 0, parts = [];
      var reader = res.body.getReader();
      while (true) {
        var r = await reader.read(); if (r.done) break;
        parts.push(r.value); got += r.value.length;
        var bar = $('#chartBar'); if (bar && len) bar.style.width = Math.round(got / len * 100) + '%';
        txt('Baixando ' + nf(got / 1048576, 1) + (len ? ' de ' + nf(len / 1048576, 1) : '') + ' MB');
      }
      var blob = new Blob(parts, { type: 'application/zip' }); parts = null;
      blob.name = 'Cartas Paraty–Paranaguá';
      chartImp.running = false;
      await importCharts(blob);
    } catch (err) {
      chartImp.running = false; chartImp.msg = 'Download não concluído: ' + (err && err.message ? err.message : err) + ' Tente de novo com sinal melhor.';
      toast('Falha ao baixar as cartas', 4000);
      if (curTab === 'offline') renderOffline(); else chartUi();
    }
  }
  async function importCharts(file) {
    if (!('caches' in window)) { toast('Este navegador não permite guardar as cartas.'); return; }
    chartImp = { running: true, done: 0, total: 0 };
    if (curTab === 'offline') renderOffline();
    try {
      if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { } }
      var entries = (await readZipEntries(file)).filter(function (e) { return /^\d+\/\d+\/\d+\.png$/.test(e.name); });
      if (!entries.length) throw new Error('Esse arquivo não tem cartas no formato do app.');
      chartImp.total = entries.length; chartUi();
      await caches.delete(CHART_CACHE);
      var cache = await caches.open(CHART_CACHE), i = 0;
      async function worker() {
        while (i < entries.length) {
          var e = entries[i++];
          var b = await entryBlob(file, e);
          await cache.put(new URL('carta/' + e.name, location.href).href, new Response(b, { headers: { 'Content-Type': 'image/png' } }));
          chartImp.done++; if (chartImp.done % 50 === 0) chartUi();
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      set.chartInfo = { count: entries.length, name: file.name, at: Date.now() }; set.chart = true; save();
      $('#ovChart').checked = true;
      chartImp.running = false; chartImp.msg = 'Pronto: ' + entries.length + ' blocos de carta guardados no aparelho.';
      map.removeLayer(chartLayer); applyLayers();
      toast('Cartas náuticas importadas', 3500);
    } catch (err) {
      chartImp.running = false; chartImp.msg = 'Não deu certo: ' + (err && err.message ? err.message : err) + ' Tente de novo com o arquivo inteiro baixado.';
      toast('Falha ao importar as cartas', 4000);
    }
    if (curTab === 'offline') renderOffline(); else chartUi();
  }
  $('#chartInput').onchange = function () { var f = this.files[0]; this.value = ''; if (f) importCharts(f); };

  window.addEventListener('online', refreshStorage); window.addEventListener('offline', refreshStorage);

  // ---------- Painel: Ajustes ----------
  var wakeLock = null;
  async function applyWake() {
    if (set.wake && document.visibilityState === 'visible') { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
    else if (wakeLock) { try { await wakeLock.release(); } catch (e) { } wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { applyWake(); startGPS(); } });
  var confirmReset = false;
  function renderSettings() {
    var pane = $('#pane-ajustes');
    pane.innerHTML =
      '<label class="field">Formato das coordenadas<select id="fmtSel"><option value="ddm">Graus e minutos · 24°41.211\'S</option><option value="dms">Graus, minutos e segundos · 24°41\'12.7"S</option><option value="dec">Decimal · -24.68685</option></select></label>' +
      '<div class="grid2"><label class="field">Declinação magnética (°)<input type="number" step="0.1" id="declIn" value="' + set.decl + '" inputmode="decimal"></label>' +
      '<label class="field">Velocidade média (nós)<input type="number" step="0.5" min="0.5" id="spdIn" value="' + set.speed + '" inputmode="decimal"></label></div>' +
      '<p class="help">Oeste é negativo. Na costa entre Paraty e Paranaguá fica em torno de 21° a 22° W, ou seja, cerca de -21,5. Confira na rosa da carta. Rumos com "M" são magnéticos e com "V" são verdadeiros; desvio da agulha não está incluído.</p>' +
      '<label class="field">Raio de chegada no waypoint (NM)<input type="number" step="0.05" min="0.02" id="arrIn" value="' + set.arrive + '" inputmode="decimal"></label>' +
      '<label class="opt"><input type="checkbox" id="recIn"' + (set.rec ? ' checked' : '') + '> Gravar rastro percorrido</label>' +
      '<label class="opt"><input type="checkbox" id="wakeIn"' + (set.wake ? ' checked' : '') + '> Manter a tela ligada</label>' +
      '<div class="grid2"><label class="field">Linha de proa segue<select id="hdgSrcSel"><option value="compass">Bússola do celular</option><option value="gps">Rumo do GPS</option></select></label>' +
      '<label class="field">Comprimento da linha<select id="hdgLenSel"><option value="0">Desligada</option><option value="5">5 NM</option><option value="10">10 NM</option><option value="15">15 NM</option><option value="20">20 NM</option><option value="30">30 NM</option></select></label></div>' +
      '<p class="help">A bússola só vale como proa com o celular preso alinhado à linha de centro do barco, com a ponta para a proa. Ferro, motor e alto-falantes perto dele desviam a leitura. Sem a bússola, a linha usa o rumo do GPS, que só aparece com o barco andando.</p>' +
      '<div class="muted">Rastro: ' + S.track.length + ' pontos</div>' +
      '<div class="row-btns"><button class="btn sm" data-a="trk-exp">Exportar rastro (GPX)</button><button class="btn sm" data-a="trk-clr">Limpar rastro</button></div>' +
      '<h3>Backup</h3><div class="row-btns"><button class="btn sm" data-a="all-exp">Exportar tudo (GPX)</button><button class="btn sm" data-a="import">Importar arquivo</button></div>' +
      '<div class="row-btns"><button class="btn danger sm" data-a="reset">Restaurar dados iniciais</button></div><div id="resetBox"></div>' +
      '<p class="help">Este app é um apoio à navegação. Não substitui cartas náuticas oficiais, ecobatímetro nem vigilância. O satélite não mostra profundidade.</p>';
    $('#fmtSel', pane).value = set.fmt;
    $('#fmtSel', pane).onchange = function () { set.fmt = this.value; save(); renderAll(); };
    var num = function (id, key, min) { $(id, pane).onchange = function () { var v = parseFloat(String(this.value).replace(',', '.')); if (isFinite(v) && (min == null || v >= min)) { set[key] = v; save(); renderAll(); } else this.value = set[key]; }; };
    num('#declIn', 'decl'); num('#spdIn', 'speed', 0.5); num('#arrIn', 'arrive', 0.02);
    $('#recIn', pane).onchange = function () { set.rec = this.checked; save(); };
    $('#wakeIn', pane).onchange = function () { set.wake = this.checked; save(); applyWake(); };
    $('#hdgSrcSel', pane).value = set.hdgSrc; $('#hdgLenSel', pane).value = String(set.hdgLen);
    $('#hdgSrcSel', pane).onchange = function () { set.hdgSrc = this.value; save(); drawMe(); updateHdgCell(); if (this.value === 'compass' && !compass.on) startCompass(); };
    $('#hdgLenSel', pane).onchange = function () { set.hdgLen = +this.value; save(); drawMe(); };
    pane.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return; var a = b.dataset.a;
      if (a === 'trk-exp') { if (S.track.length < 2) toast('O rastro ainda está vazio.'); else shareFile('rastro.gpx', G.toGPX([], [], S.track)); }
      else if (a === 'trk-clr') { S.track = []; trackLine.setLatLngs([]); save(); renderSettings(); toast('Rastro limpo'); }
      else if (a === 'all-exp') shareFile('derrota-backup.gpx', G.toGPX(S.routes.map(function (r) { return { name: r.name, points: activePts(r) }; }), S.marks, S.track));
      else if (a === 'import') $('#fileInput').click();
      else if (a === 'reset') $('#resetBox').innerHTML = '<div class="confirm">Isso substitui suas rotas e pontos pelos dados iniciais. <span class="spacer"></span><button class="btn ghost sm" data-a="reset-no">Cancelar</button><button class="btn danger sm" data-a="reset-yes">Restaurar</button></div>';
      else if (a === 'reset-no') $('#resetBox').innerHTML = '';
      else if (a === 'reset-yes') { var keep = S.settings, trk = S.track; S = freshState(); S.settings = keep; S.track = trk; set = S.settings; save(true); renderAll(); fitRoute(); toast('Dados iniciais restaurados'); }
    };
  }

  $('#btnCompass').onclick = function () { if (compass.on) stopCompass(); else startCompass(); };

  // ---------- Camadas e modo noturno ----------
  $('#btnLayers').onclick = function (e) { e.stopPropagation(); $('#layerMenu').hidden = !$('#layerMenu').hidden; };
  document.addEventListener('click', function (e) { if (!$('#layerMenu').hidden && !e.target.closest('#layerMenu') && !e.target.closest('#btnLayers')) $('#layerMenu').hidden = true; });
  $('#baseSat').checked = set.base === 'sat'; $('#baseMap').checked = set.base === 'map';
  $('#ovChart').checked = set.chart;
  $('#ovChart').onchange = function () {
    set.chart = this.checked; save(); applyLayers();
    if (this.checked && !set.chartInfo) toast('Nenhuma carta importada ainda. Veja a aba Offline.', 4000);
  };
  $('#ovSea').checked = set.sea; $('#ovMarks').checked = set.showMarks; $('#ovTrack').checked = set.showTrack;
  document.querySelectorAll('input[name=base]').forEach(function (r) { r.onchange = function () { set.base = this.value; save(); applyLayers(); }; });
  $('#ovSea').onchange = function () { set.sea = this.checked; save(); applyLayers(); };
  $('#ovMarks').onchange = function () { set.showMarks = this.checked; save(); applyLayers(); };
  $('#ovTrack').onchange = function () { set.showTrack = this.checked; save(); applyLayers(); };
  $('#btnNight').onclick = function () {
    set.night = !set.night; save();
    document.documentElement.classList.toggle('night', set.night); this.classList.toggle('on', set.night);
  };
  $('#btnNight').classList.toggle('on', set.night);

  // ---------- Render geral ----------
  function renderAll() {
    drawRoutes(); drawMarks(); renderRoutes(); renderMarks(); renderSettings(); updateNav();
  }

  // ---------- Início ----------
  trackLine.setLatLngs(S.track.map(function (p) { return [p.lat, p.lon]; }));
  applyLayers();
  var allPts = S.routes.reduce(function (a, r) { return a.concat(r.points); }, []).concat(S.marks);
  if (allPts.length) map.fitBounds(L.latLngBounds(allPts.map(function (p) { return [p.lat, p.lon]; })), { paddingTopLeft: [20, 170], paddingBottomRight: [20, 80] });
  follow = false;
  booted = true;
  renderAll();
  startGPS();
  applyWake();
  setInterval(function () { if (curTab === 'pontos' && me.pos && !sheet.classList.contains('collapsed')) renderMarks(); }, 15000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(function () { if (curTab === 'offline') refreshStorage(); }).catch(function () { });
  }
})();
