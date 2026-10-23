/* Geo: cálculos de navegação, coordenadas e arquivos. Sem dependências. */
(function (root) {
  'use strict';
  var R_NM = 3440.065;          // raio da Terra em milhas náuticas
  var rad = function (d) { return d * Math.PI / 180; };
  var deg = function (r) { return r * 180 / Math.PI; };
  var norm360 = function (a) { return ((a % 360) + 360) % 360; };

  // Distância ortodrômica em NM
  function distNM(a, b) {
    var la1 = rad(a.lat), la2 = rad(b.lat), dla = la2 - la1, dlo = rad(b.lon - a.lon);
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Rumo verdadeiro inicial (graus)
  function bearing(a, b) {
    var la1 = rad(a.lat), la2 = rad(b.lat), dlo = rad(b.lon - a.lon);
    var y = Math.sin(dlo) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
    return norm360(deg(Math.atan2(y, x)));
  }
  // Ponto a partir de distância (NM) e rumo verdadeiro
  function destination(a, dNM, brg) {
    var la = rad(a.lat), lo = rad(a.lon), b = rad(brg), d = dNM / R_NM;
    var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: deg(la2), lon: ((deg(lo2) + 540) % 360) - 180 };
  }
  // Erro de trilha (XTE) em NM: positivo = à direita da derrota
  function crossTrack(from, to, p) {
    var d13 = distNM(from, p) / R_NM;
    var t13 = rad(bearing(from, p)), t12 = rad(bearing(from, to));
    return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R_NM;
  }
  // Rumo magnético: declinação oeste é negativa (ex.: -21.5)
  function toMagnetic(trueBrg, decl) { return norm360(trueBrg - decl); }

  // ---------- Coordenadas: leitura ----------
  // Aceita: "-23.55, -46.63" | "-23,55 -46,63" | "24°41.211'S 47°25.284'W"
  // "S 24 41.211 W 47 25.284" | "23°17'30\"S 44°30'10\"W" | "24 41.211 S, 47 25.284 O"
  function parseCoord(text) {
    if (text == null) return null;
    var s = String(text).trim().toUpperCase()
      .replace(/[′’‘`´]/g, "'").replace(/[″“”]/g, '"').replace(/''/g, '"')
      .replace(/\bSUL\b/g, 'S').replace(/\bNORTE\b/g, 'N').replace(/\bOESTE\b/g, 'W').replace(/\bLESTE\b/g, 'E');
    var re = /([-+]?\d+(?:[.,]\d+)?)|([NSEWLO])(?![A-Z])/g, m, tokens = [];
    while ((m = re.exec(s))) {
      if (m[1] != null) tokens.push({ n: parseFloat(m[1].replace(',', '.')), neg: /^-/.test(m[1]) });
      else tokens.push({ h: m[2] === 'O' ? 'W' : (m[2] === 'L' ? 'E' : m[2]) });
    }
    if (!tokens.length) return null;
    var groups = [], hasH = tokens.some(function (t) { return t.h; });
    if (hasH) {
      var prefix = !!tokens[0].h, cur = { nums: [], h: null };
      tokens.forEach(function (t) {
        if (t.h) {
          if (prefix) { if (cur.h || cur.nums.length) groups.push(cur); cur = { nums: [], h: t.h }; }
          else { cur.h = t.h; groups.push(cur); cur = { nums: [], h: null }; }
        } else cur.nums.push(t);
      });
      if (cur.nums.length || cur.h) groups.push(cur);
      groups = groups.filter(function (g) { return g.nums.length; });
    } else {
      var nums = tokens;
      var per = nums.length === 2 ? 1 : nums.length === 4 ? 2 : nums.length === 6 ? 3 : 0;
      if (!per) return null;
      groups = [{ nums: nums.slice(0, per) }, { nums: nums.slice(per) }];
    }
    if (groups.length !== 2) return null;
    function val(g) {
      if (g.nums.length > 3) return NaN;
      var d = Math.abs(g.nums[0].n), mi = g.nums[1] ? g.nums[1].n : 0, se = g.nums[2] ? g.nums[2].n : 0;
      if (mi >= 60 || se >= 60) return NaN;
      var v = d + mi / 60 + se / 3600;
      if (g.nums[0].neg) v = -v;
      if (g.h === 'S' || g.h === 'W') v = -Math.abs(v);
      if (g.h === 'N' || g.h === 'E') v = Math.abs(v);
      return v;
    }
    var a = groups[0], b = groups[1], lat, lon;
    if (a.h === 'E' || a.h === 'W' || b.h === 'N' || b.h === 'S') { lat = val(b); lon = val(a); }
    else { lat = val(a); lon = val(b); }
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }

  // ---------- Coordenadas: escrita ----------
  function fmtPart(v, pos, neg, fmt, degW) {
    var h = v < 0 ? neg : pos, a = Math.abs(v);
    if (fmt === 'dec') return v.toFixed(5);
    if (fmt === 'dms') {
      var d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
      if (s >= 59.95) { s = 0; m++; } if (m >= 60) { m = 0; d++; }
      return pad(d, degW) + '°' + pad(m, 2) + "'" + s.toFixed(1).padStart(4, '0') + '"' + h;
    }
    var dd = Math.floor(a), mm = (a - dd) * 60;
    if (mm >= 59.9995) { mm = 0; dd++; }
    return pad(dd, degW) + '°' + mm.toFixed(3).padStart(6, '0') + "'" + h;
  }
  function pad(n, w) { return String(n).padStart(w, '0'); }
  function formatCoord(p, fmt) {
    if (!p) return '';
    if (fmt === 'dec') return p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);
    return fmtPart(p.lat, 'N', 'S', fmt, 2) + ' ' + fmtPart(p.lon, 'E', 'W', fmt, 2);
  }

  // Linha de texto com nome + coordenada -> {name, lat, lon}
  function parseLine(line) {
    var t = line.trim();
    if (!t || /^#/.test(t)) return null;
    var fields = t.split(/\t|;/).map(function (f) { return f.trim(); }).filter(Boolean);
    if (fields.length >= 3) { // nome;lat;lon ou lat;lon;nome
      var c1 = parseCoord(fields[1] + ' ' + fields[2]);
      if (c1 && isNaN(parseFloat(fields[0]))) return { name: fields[0], lat: c1.lat, lon: c1.lon, note: fields.slice(3).join(' ') };
      var c2 = parseCoord(fields[0] + ' ' + fields[1]);
      if (c2) return { name: fields.slice(2).join(' '), lat: c2.lat, lon: c2.lon };
    }
    // tenta cada ponto de corte possível entre nome e coordenada
    var re = /(?:^|[\s,;:–—])(?=[-+]?\d|[NSWE]\s*\d)/gi, m;
    while ((m = re.exec(t))) {
      var cut = m.index + m[0].length;
      var c = parseCoord(t.slice(cut));
      if (c) return { name: t.slice(0, cut).replace(/[\s,;:–—-]+$/, '').trim(), lat: c.lat, lon: c.lon };
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    return null;
  }

  // ---------- Arquivos ----------
  function parseGPX(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    var out = { routes: [], marks: [] };
    var txt = function (el, tag) { var x = el.getElementsByTagName(tag)[0]; return x ? x.textContent.trim() : ''; };
    var pt = function (el) { return { name: txt(el, 'name'), lat: parseFloat(el.getAttribute('lat')), lon: parseFloat(el.getAttribute('lon')), note: txt(el, 'desc') || txt(el, 'cmt') }; };
    Array.prototype.forEach.call(doc.getElementsByTagName('wpt'), function (w) { out.marks.push(pt(w)); });
    Array.prototype.forEach.call(doc.getElementsByTagName('rte'), function (r) {
      var pts = Array.prototype.map.call(r.getElementsByTagName('rtept'), pt);
      if (pts.length) out.routes.push({ name: txt(r, 'name') || 'Rota importada', points: pts });
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('trk'), function (t) {
      var pts = Array.prototype.map.call(t.getElementsByTagName('trkpt'), pt);
      if (pts.length > 1) out.routes.push({ name: txt(t, 'name') || 'Trilha importada', points: simplify(pts, 0.03).map(function (p, i) { p.name = p.name || ('P' + (i + 1)); return p; }) });
    });
    return out;
  }
  function parseKML(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    var out = { routes: [], marks: [] };
    var coordsOf = function (s) {
      return s.trim().split(/\s+/).map(function (c) { var a = c.split(','); return { lat: parseFloat(a[1]), lon: parseFloat(a[0]) }; })
        .filter(function (p) { return isFinite(p.lat) && isFinite(p.lon); });
    };
    Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm) {
      var nameEl = pm.getElementsByTagName('name')[0], name = nameEl ? nameEl.textContent.trim() : '';
      var descEl = pm.getElementsByTagName('description')[0];
      var pEl = pm.getElementsByTagName('Point')[0], lEl = pm.getElementsByTagName('LineString')[0];
      if (pEl) {
        var c = coordsOf(pEl.getElementsByTagName('coordinates')[0].textContent)[0];
        if (c) out.marks.push({ name: name, lat: c.lat, lon: c.lon, note: descEl ? descEl.textContent.replace(/<[^>]+>/g, ' ').trim().slice(0, 140) : '' });
      } else if (lEl) {
        var pts = coordsOf(lEl.getElementsByTagName('coordinates')[0].textContent);
        if (pts.length > 60) pts = simplify(pts, 0.03);
        out.routes.push({ name: name || 'Rota importada', points: pts.map(function (p, i) { p.name = 'P' + (i + 1); return p; }) });
      }
    });
    return out;
  }
  function parseText(text) {
    var marks = text.split(/\r?\n/).map(parseLine).filter(Boolean);
    return { routes: [], marks: marks };
  }
  // Douglas-Peucker simples, tolerância em NM
  function simplify(pts, tolNM) {
    if (pts.length < 3) return pts.slice();
    var keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], maxD = 0, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var d = Math.abs(crossTrack(pts[a], pts[b], pts[i]));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tolNM && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter(function (_, i) { return keep[i]; });
  }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toGPX(routes, marks, track) {
    var o = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Derrota" xmlns="http://www.topografix.com/GPX/1/1">'];
    (marks || []).forEach(function (m) {
      o.push('<wpt lat="' + m.lat.toFixed(6) + '" lon="' + m.lon.toFixed(6) + '"><name>' + esc(m.name) + '</name>' + (m.note ? '<desc>' + esc(m.note) + '</desc>' : '') + '</wpt>');
    });
    (routes || []).forEach(function (r) {
      o.push('<rte><name>' + esc(r.name) + '</name>');
      r.points.forEach(function (p) { o.push('<rtept lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '"><name>' + esc(p.name) + '</name>' + (p.note ? '<desc>' + esc(p.note) + '</desc>' : '') + '</rtept>'); });
      o.push('</rte>');
    });
    if (track && track.length > 1) {
      o.push('<trk><name>Rastro</name><trkseg>');
      track.forEach(function (p) { o.push('<trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '">' + (p.t ? '<time>' + new Date(p.t).toISOString() + '</time>' : '') + '</trkpt>'); });
      o.push('</trkseg></trk>');
    }
    o.push('</gpx>');
    return o.join('\n');
  }

  // ---------- Tiles ----------
  function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function lat2y(lat, z) { var r = rad(lat); return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  // Tiles cobrindo: faixa de bufNM ao redor das linhas + círculos ao redor dos pontos
  function tilesForCorridor(lines, points, bufNM, zmin, zmax) {
    var set = {};
    function addCircle(p, z) {
      var n = destination(p, bufNM, 0), s = destination(p, bufNM, 180), e = destination(p, bufNM, 90), w = destination(p, bufNM, 270);
      var x0 = lon2x(w.lon, z), x1 = lon2x(e.lon, z), y0 = lat2y(n.lat, z), y1 = lat2y(s.lat, z);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) set[z + '/' + x + '/' + y] = 1;
    }
    for (var z = zmin; z <= zmax; z++) {
      var tileNM = 21600 / Math.pow(2, z) * Math.cos(rad(25)); // largura aproximada de um tile em NM
      var step = Math.max(0.05, Math.min(tileNM / 2, bufNM));
      lines.forEach(function (pts) {
        for (var i = 0; i < pts.length - 1; i++) {
          var a = pts[i], b = pts[i + 1], d = distNM(a, b), n = Math.max(1, Math.ceil(d / step));
          for (var k = 0; k <= n; k++) addCircle({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n }, z);
        }
      });
      points.forEach(function (p) { addCircle(p, z); });
    }
    return Object.keys(set);
  }
  function tilesForBounds(s, w, n, e, zmin, zmax) {
    var out = [];
    for (var z = zmin; z <= zmax; z++) {
      var x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push(z + '/' + x + '/' + y);
    }
    return out;
  }

  var Geo = { distNM: distNM, bearing: bearing, destination: destination, crossTrack: crossTrack, toMagnetic: toMagnetic,
    parseCoord: parseCoord, formatCoord: formatCoord, parseLine: parseLine, parseGPX: parseGPX, parseKML: parseKML,
    parseText: parseText, toGPX: toGPX, simplify: simplify, tilesForCorridor: tilesForCorridor, tilesForBounds: tilesForBounds,
    lon2x: lon2x, lat2y: lat2y, norm360: norm360 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo; else root.Geo = Geo;
})(this);
