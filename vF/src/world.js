/* The stage: every person and every AI copy is one mark. Firms are rings (area grows with
 * headcount), firm types sit in a row ordered by AI share, and whoever is outside a firm
 * waits in the pools underneath. Agents keep their identity and travel when the
 * organisation changes. */
(function (root) {
  'use strict';
  var SP = 2.6;          // spacing of agents inside a firm, in world units (an agent has radius 1)
  var SPM = 3.0;         // spacing in a loose fringe of one-agent firms
  var TAU = Math.PI * 2;

  // hexagonal lattice, sorted from the centre outwards
  var HX = null, HY = null, HR = null;
  (function buildHex(R) {
    var pts = [], h = Math.sqrt(3) / 2;
    for (var j = -R - 8; j <= R + 8; j++) for (var i = -R - 2; i <= R + 2; i++) {
      var x = i + ((j & 1) ? 0.5 : 0), y = j * h, d = x * x + y * y;
      if (d <= R * R + 1e-9) pts.push([x, y, d, Math.atan2(y, x)]);
    }
    pts.sort(function (a, b) { return (a[2] - b[2]) || (a[3] - b[3]); });
    var n = pts.length;
    HX = new Float32Array(n); HY = new Float32Array(n); HR = new Float32Array(n);
    for (var k = 0; k < n; k++) { HX[k] = pts[k][0]; HY[k] = pts[k][1]; HR[k] = Math.sqrt(pts[k][2]); }
  })(64);

  // unit positions of n agents inside one firm, and the radius they reach
  function seat(n, i) {
    if (n === 1) return [0, 0];
    if (n <= 5) { var r = 0.5 / Math.sin(Math.PI / n), a = -Math.PI / 2 + i * TAU / n; return [r * Math.cos(a), r * Math.sin(a)]; }
    if (n === 6) { if (i === 0) return [0, 0]; var a6 = -Math.PI / 2 + (i - 1) * TAU / 5; return [0.92 * Math.cos(a6), 0.92 * Math.sin(a6)]; }
    return [HX[i], HY[i]];
  }
  function reach(n) {
    if (n <= 1) return 0;
    if (n <= 5) return 0.5 / Math.sin(Math.PI / n);
    if (n === 6) return 0.92;
    return HR[Math.min(n, HR.length) - 1];
  }
  // radius of the ring around a firm of n agents. Deliberately smooth in n: a firm that gains
  // one member must not make its whole district jump.
  function ringR(n) { return SP * (0.525 * Math.sqrt(Math.max(n, 1)) + 0.95); }

  // ── layout: integer structure -> seats, firms, districts, pools ──
  // Labels are drawn in screen pixels, so the gaps that hold them are sized from the scale
  // the camera will end up with: a first pass measures, a second pass places.
  function layoutWorld(real, meta) {
    var nT = meta.nRoles + 1, vw = Math.max(160, (meta.view && meta.view.w) || 800), vh = Math.max(160, (meta.view && meta.view.h) || 500);
    var byMk = {}, mks;
    real.groups.forEach(function (g, gi) { g.gi = gi; (byMk[g.mk] = byMk[g.mk] || []).push(g); });
    mks = Object.keys(byMk).sort();
    var GAP = 16, rowsG = [], maxW = 0, sumH = 0;
    mks.forEach(function (mk) {
      var gs = byMk[mk], rowH = 0, x = 0;
      gs.forEach(function (g) {
        if (g.micro) { g.Rf = 0; g.dF = SPM; g.Rd = SPM * (0.525 * Math.sqrt(g.total) + 1.2); }
        else {
          g.firms.forEach(function (f) { var s = 0; for (var q = 0; q < nT; q++) s += f[q]; f.size = s; });
          var nFg = g.firms.length, avg = g.total / nFg;
          g.Rf = ringR(nFg > 1 ? avg + 1 : avg);
          g.dF = 2 * g.Rf + SP * 1.0;
          // a district of n firms: the lattice disc that holds them, again smooth in n
          // a lone firm fills its district, so the district must reach the corners of the firm's hexagon
          g.Rd = (nFg > 1 ? g.dF * (0.525 * Math.sqrt(nFg) + 0.35) : 0) + g.Rf * (nFg > 1 ? 1 : HEX_R) + (nFg > 1 ? SP * 0.6 : 0);
        }
        if (2 * g.Rd > rowH) rowH = 2 * g.Rd;
      });
      sumH += rowH;
      rowsG.push({ mk: +mk, gs: gs, w: 0, h: rowH });
    });
    // horizontal placement: neighbours stand far enough apart for their labels to sit side by side
    var lw = meta.labelW || [];
    function placeRows(sc) {
      maxW = 0;
      rowsG.forEach(function (row) {
        var x = 0, prev = null;
        row.gs.forEach(function (g) {
          var half = Math.max(g.Rd, ((lw[g.gi] || 0) / 2 + 7) / sc);
          if (prev) x += Math.max(prev.Rd + g.Rd + GAP, prev.half + half);
          else x = half;
          g.cx = x; g.half = half; prev = g;
        });
        row.w = prev ? x + prev.half : 0;
        if (row.w > maxW) maxW = row.w;
      });
    }
    placeRows(1e9);
    var nb = 0; real.unemployed.forEach(function (v) { nb += v; });
    var ni = real.idleAI, SB = 2.5, SI = 1.34;
    var cb = nb ? Math.max(1, Math.ceil(Math.sqrt(nb * 2.6))) : 0, rb = nb ? Math.ceil(nb / cb) : 0;
    var ci = ni ? Math.max(1, Math.ceil(Math.sqrt(ni * 3.4))) : 0, rI = ni ? Math.ceil(ni / ci) : 0;
    var wb = cb * SB, wi = ci * SI, gapP = nb && ni ? 30 : 0, poolW = wb + gapP + wi, poolH = Math.max(rb * SB, rI * SI);
    var contentW = Math.max(maxW, poolW, 1), nGaps = Math.max(0, rowsG.length - 1) + (poolH > 0 && rowsG.length ? 1 : 0);
    // scale estimate with 64px per gap, then the gaps in world units
    var sEst = 1;
    for (var pass = 0; pass < 3; pass++) {
      contentW = Math.max(maxW, poolW, 1);
      sEst = Math.min(vw / contentW, Math.max(40, vh - 64 * nGaps - 40) / Math.max(1, sumH + poolH), 9);
      placeRows(sEst);
    }
    contentW = Math.max(maxW, poolW, 1);
    var ROWGAP = 66 / sEst, POOLGAP = 60 / sEst;
    if (nb && ni) { gapP = Math.max(gapP, 104 / sEst - (wb + wi) / 2); poolW = wb + gapP + wi; contentW = Math.max(contentW, poolW); }   // room for both pool labels

    var t, slots = [], employed = [], firms = [], districts = [], rows = [], links = [], y = 0, leadT = real.leadRole == null ? -1 : real.leadRole, coSeats = [];
    for (t = 0; t < nT; t++) slots.push([]);
    rowsG.forEach(function (row) {
      row.y = y + row.h / 2; row.top = y; row.x0 = (contentW - row.w) / 2;
      y += row.h + ROWGAP;
      row.gs.forEach(function (g) {
        var cx = g.cx + row.x0, cy = row.y, d = { gi: g.gi, ri: g.ri, mk: g.mk, x: cx, y: cy, r: g.Rd, micro: g.micro, total: g.total, f0: firms.length, nF: 0 };
        if (g.micro) {
          var k = 0;
          meta.centerOrder.forEach(function (tt) {
            for (var c = 0; c < g.counts[tt]; c++, k++) slots[tt].push(cx + HX[k] * SPM, cy + HY[k] * SPM);
          });
        } else {
          var nF = g.firms.length;
          for (var f = 0; f < nF; f++) {
            var p = seat(nF, f), fx = cx + p[0] * g.dF, fy = cy + p[1] * g.dF, fm = g.firms[f], n = fm.size, i = 0;
            // the ring takes the colour of the role most of the firm's people have; a firm with no people keeps the neutral ring
            var maj = -1, mjc = 0;
            for (var hq = 0; hq < nT - 1; hq++) if (fm[hq] > mjc) { mjc = fm[hq]; maj = hq; }
            firms.push({ x: fx, y: fy, r: ringR(n), n: n, gi: g.gi, c: fm, maj: maj });
            meta.centerOrder.forEach(function (tt) {
              for (var c = 0; c < fm[tt]; c++, i++) {
                var s = seat(n, i);
                if (tt === leadT && !(g.lead && c === 0)) coSeats.push(slots[tt].length / 2);   // everyone in the leading role but the one leader works as a coordinator
                slots[tt].push(fx + s[0] * SP, fy + s[1] * SP);
              }
            });
          }
          d.nF = nF;
          // firms of one network sit next to each other and are joined by a line
          if (g.net > 1.05) {
            // walk the firms row by row, turning at each end, so that neighbours in the walk are neighbours on the stage
            var ord = [], rowOf = function (q) { return Math.round((firms[d.f0 + q].y - cy) / g.dF * 4); };
            for (f = 0; f < nF; f++) ord.push(f);
            ord.sort(function (u, v) { var ru = rowOf(u), rv = rowOf(v); return ru - rv || (ru % 2 ? firms[d.f0 + v].x - firms[d.f0 + u].x : firms[d.f0 + u].x - firms[d.f0 + v].x); });
            for (f = 1; f < nF; f++) {
              if (Math.floor(f / g.net) !== Math.floor((f - 1) / g.net)) continue;
              var fa = firms[d.f0 + ord[f - 1]], fb = firms[d.f0 + ord[f]];
              if (Math.pow(fa.x - fb.x, 2) + Math.pow(fa.y - fb.y, 2) <= 4.9 * g.dF * g.dF) links.push(d.f0 + ord[f - 1], d.f0 + ord[f]);
            }
          }
        }
        districts.push(d);
      });
      rows.push(row);
    });
    var bottom = rows.length ? y - ROWGAP : 0;
    for (t = 0; t < nT; t++) employed.push(slots[t].length / 2);
    // pools: people outside firms, and idle compute
    var px = (contentW - poolW) / 2, py = bottom + (rows.length ? POOLGAP : 0), pools = [];
    if (nb) {
      var q = 0;
      for (t = 0; t < meta.nRoles; t++) for (var u = 0; u < real.unemployed[t]; u++, q++) slots[t].push(px + (q % cb + 0.5) * SB, py + (Math.floor(q / cb) + 0.5) * SB);
      pools.push({ kind: 'bench', x: px, y: py, w: wb, h: rb * SB, n: nb });
    }
    if (ni) {
      var ix = px + wb + gapP;
      for (var v = 0; v < ni; v++) slots[nT - 1].push(ix + (v % ci + 0.5) * SI, py + (Math.floor(v / ci) + 0.5) * SI);
      pools.push({ kind: 'idle', x: ix, y: py, w: wi, h: rI * SI, n: ni, ci: ci, si: SI });
    }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function ext(x0, y0, x1, y1) { if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1; if (y0 < minY) minY = y0; if (y1 > maxY) maxY = y1; }
    districts.forEach(function (d) { var hw = Math.max(d.r, ((lw[d.gi] || 0) / 2) / sEst); ext(d.x - hw, d.y - d.r, d.x + hw, d.y + d.r); });
    pools.forEach(function (p) { ext(p.x, p.y, p.x + p.w, p.y + p.h); });
    if (minX === Infinity) { minX = -50; maxX = 50; minY = -30; maxY = 30; }
    return { slots: slots.map(function (a) { return new Float32Array(a); }), employed: employed, firms: firms, links: links, leadT: leadT, coSeats: coSeats, districts: districts, pools: pools, rows: rows, bounds: [minX, minY, maxX, maxY], nT: nT };
  }

  // ── the canvas world ──
  function World(canvas, cb) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.cb = cb || {};
    this.tp = [];
    this.cam = { x: 0, y: 0, s: 1 }; this.camT = { x: 0, y: 0, s: 1 };
    this.userCam = false; this.L = null; this.C = null; this.labels = []; this.rowTags = [];
    this.speed = 1; this.w = 300; this.h = 200; this.dpr = 1;
    this.raf = 0; this.last = 0; this.hover = null; this.focusGi = -1; this.first = true;
    this.inset = { t: 18, r: 18, b: 18, l: 18 };
    this.show = { labels: true };
    var mq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = !!(mq && mq.matches);
    var me = this;
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { me.reduced = mq.matches; });   // honour the setting when it changes, not only at load
    this._bind();
  }

  World.prototype.setColors = function (C) { this.C = C; this.kick(); };
  World.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
    if (r.width < 2 || r.height < 2) return;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    if (!this.userCam) this.fit(true);
    this.kick();
  };
  World.prototype.fitTarget = function () {
    if (!this.L) return { x: 0, y: 0, s: 1 };
    var b = this.L.bounds, I = this.inset, labelPad = this.show.labels ? 42 : 8;
    var aw = Math.max(40, this.w - I.l - I.r), ah = Math.max(40, this.h - I.t - I.b - labelPad);
    var bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
    var s = Math.min(aw / bw, ah / bh, 9);
    return { x: (b[0] + b[2]) / 2 - ((I.l - I.r) / 2) / s, y: (b[1] + b[3]) / 2 - ((I.t - I.b - labelPad) / 2) / s, s: s };
  };
  World.prototype.fit = function (instant) {
    this.userCam = false; this.camT = this.fitTarget();
    if (instant || this.reduced) this.cam = { x: this.camT.x, y: this.camT.y, s: this.camT.s };
    this.kick();
  };
  World.prototype.panBy = function (dx, dy) {
    var s = this.camT.s; this.camT = { s: s, x: this.camT.x + dx / s, y: this.camT.y + dy / s };
    this.userCam = true; this.kick();
  };
  World.prototype.zoomBy = function (f, cx, cy) {
    var s0 = this.camT.s, s1 = Math.min(60, Math.max(0.05, s0 * f));
    if (cx == null) { cx = this.w / 2; cy = this.h / 2; }
    var wx = this.camT.x + (cx - this.w / 2) / s0, wy = this.camT.y + (cy - this.h / 2) / s0;
    this.camT = { s: s1, x: wx - (cx - this.w / 2) / s1, y: wy - (cy - this.h / 2) / s1 };
    this.userCam = true; this.kick();
  };
  World.prototype.focus = function (gi) {
    this.focusGi = gi;
    if (gi >= 0 && this.L) {
      var d = null; this.L.districts.forEach(function (x) { if (x.gi === gi) d = x; });
      if (d) {
        var s = Math.min(9, Math.min(this.w - 60, this.h - 150) / (2 * d.r + 10));
        this.camT = { x: d.x, y: d.y, s: s }; this.userCam = true;
      }
    }
    this.kick();
  };

  // position along a Hilbert curve: nearby points get nearby numbers
  function hilbert(x, y) {
    var d = 0, t;
    for (var q = 32768; q > 0; q >>= 1) {
      var rx = (x & q) > 0 ? 1 : 0, ry = (y & q) > 0 ? 1 : 0;
      d += q * q * ((3 * rx) ^ ry);
      if (ry === 0) { if (rx === 1) { x = 65535 - x; y = 65535 - y; } t = x; x = y; y = t; }
    }
    return d;
  }
  function extent(ids, count, xs, ys, stride) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, same = xs === ys ? 1 : 0;
    for (var i = 0; i < count; i++) { var k = ids[i] * stride, px = xs[k], py = ys[k + same]; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    return [x0, y0, x1, y1];
  }
  // order items (index list `ids`) along the curve, positions read relative to the frame `box`
  function curveOrder(ids, count, xs, ys, stride, box) {
    var x0 = box[0], y0 = box[1], sx = box[2] > x0 ? 65535 / (box[2] - x0) : 0, sy = box[3] > y0 ? 65535 / (box[3] - y0) : 0;
    var keys = new Float64Array(count), same = xs === ys ? 1 : 0, i, k, ux, uy;
    for (i = 0; i < count; i++) {
      k = ids[i] * stride;
      ux = (xs[k] - x0) * sx; uy = (ys[k + same] - y0) * sy;
      ux = ux < 0 ? 0 : ux > 65535 ? 65535 : ux | 0; uy = uy < 0 ? 0 : uy > 65535 ? 65535 : uy | 0;
      keys[i] = hilbert(ux, uy) * 1048576 + i;      // room for a million items in one group
    }
    keys.sort();
    var out = new Int32Array(count);
    for (i = 0; i < count; i++) out[i] = ids[keys[i] % 1048576];
    return out;
  }

  // Give each incumbent the free seat nearest to where it sits, reading its old place in the
  // frame of the new arrangement. Returns the agents that found nothing nearby.
  function seatNearby(stay, b, oldBox, S, seats, cnt, sbox, used) {
    var c = 3.4, x0 = sbox[0] - c, y0 = sbox[1] - c, W = Math.floor((sbox[2] - x0) / c) + 2, H = Math.floor((sbox[3] - y0) / c) + 2;
    var cellOf = new Int32Array(cnt), start = new Int32Array(W * H + 1), i, k;
    for (i = 0; i < cnt; i++) {
      k = seats[i] * 2;
      cellOf[i] = Math.floor((S[k + 1] - y0) / c) * W + Math.floor((S[k] - x0) / c); start[cellOf[i] + 1]++;
    }
    for (i = 0; i < W * H; i++) start[i + 1] += start[i];
    var fill = start.slice(0, W * H), items = new Int32Array(cnt);
    for (i = 0; i < cnt; i++) items[fill[cellOf[i]]++] = i;
    var fx = 1, fy = 1, ox = 0, oy = 0;
    if (oldBox) {                                   // map the old arrangement onto the new one
      fx = oldBox[2] > oldBox[0] ? (sbox[2] - sbox[0]) / (oldBox[2] - oldBox[0]) : 1;
      fy = oldBox[3] > oldBox[1] ? (sbox[3] - sbox[1]) / (oldBox[3] - oldBox[1]) : 1;
      ox = sbox[0] - oldBox[0] * fx; oy = sbox[1] - oldBox[1] * fy;
    }
    var left = [], RMAX = 14;
    for (var a = 0; a < stay.length; a++) {
      var m = stay[a], px = b.tx[m] * fx + ox, py = b.ty[m] * fy + oy;
      var cx0 = Math.floor((px - x0) / c), cy0 = Math.floor((py - y0) / c), best = -1, bd = Infinity;
      if (cx0 < 0) cx0 = 0; else if (cx0 >= W) cx0 = W - 1;
      if (cy0 < 0) cy0 = 0; else if (cy0 >= H) cy0 = H - 1;
      for (var r = 0; r <= RMAX; r++) {
        for (var cy = cy0 - r; cy <= cy0 + r; cy++) {
          if (cy < 0 || cy >= H) continue;
          var edge = cy === cy0 - r || cy === cy0 + r, step = edge || r === 0 ? 1 : 2 * r;
          for (var cx = cx0 - r; cx <= cx0 + r; cx += step) {
            if (cx < 0 || cx >= W) continue;
            var cell = cy * W + cx;
            for (var q = start[cell]; q < start[cell + 1]; q++) {
              var li = items[q]; if (used[li]) continue;
              var sk = seats[li] * 2, dx = S[sk] - px, dy = S[sk + 1] - py, d2 = dx * dx + dy * dy;
              if (d2 < bd) { bd = d2; best = li; }
            }
          }
        }
        if (best >= 0 && r >= 1 && bd <= r * c * r * c) break;   // nothing nearer lies further out
      }
      if (best >= 0) { used[best] = 1; var sb = seats[best] * 2; b.tx[m] = S[sb]; b.ty[m] = S[sb + 1]; }
      else left.push(m);
    }
    return left;
  }

  // New organisation: every agent gets a seat to travel to. Agents keep their place where they
  // can: those already in firms stay in firms, close to where they sat; only hires and leavers travel.
  World.prototype.update = function (L, order, labels, rowTags, instant) {
    var nT = L.nT, t, i, snap = instant || this.reduced || this.first;
    for (t = 0; t < nT; t++) {
      var n = L.slots[t].length / 2, b = this.tp[t];
      if (!b || b.cap < n) {
        var cap = Math.max(64, Math.ceil(n * 1.25)), nb = { n: 0, cap: cap, x: new Float32Array(cap), y: new Float32Array(cap), tx: new Float32Array(cap), ty: new Float32Array(cap), st: new Uint8Array(cap), k: new Float32Array(cap), box: [null, null] };
        if (b) { nb.x.set(b.x.subarray(0, b.n)); nb.y.set(b.y.subarray(0, b.n)); nb.tx.set(b.tx.subarray(0, b.n)); nb.ty.set(b.ty.subarray(0, b.n)); nb.st.set(b.st.subarray(0, b.n)); nb.n = b.n; nb.box = b.box; }
        for (i = 0; i < cap; i++) nb.k[i] = 0.55 + 0.9 * (((i * 2654435761) >>> 0) % 1000) / 1000;
        b = this.tp[t] = nb;
      }
      var S = L.slots[t], emp = L.employed[t], old = Math.min(b.n, n), ord = order && order[t];
      var inFirm = [], out = [], fresh = [];
      if (ord) { for (i = 0; i < n; i++) (i < emp ? inFirm : out).push(ord[i]); }
      else {
        for (i = 0; i < old; i++) (b.st[i] === 0 ? inFirm : out).push(i);
        for (i = old; i < n; i++) fresh.push(i);
        while (inFirm.length > emp) out.push(inFirm.pop());                 // released
        while (inFirm.length < emp && out.length) inFirm.push(out.pop());   // hired from the pool
        while (inFirm.length < emp && fresh.length) inFirm.push(fresh.pop());
        while (fresh.length) out.push(fresh.pop());
      }
      var seatIds = new Int32Array(n); for (i = 0; i < n; i++) seatIds[i] = i;
      var groups = [[inFirm, 0, emp], [out, emp, n - emp]], newBox = [null, null];
      for (var gq = 0; gq < 2; gq++) {
        var ag = groups[gq][0], s0 = groups[gq][1], cnt = groups[gq][2];
        if (!cnt) continue;
        var seats = seatIds.subarray(s0, s0 + cnt), sbox = extent(seats, cnt, S, S, 2);
        newBox[gq] = sbox;
        // incumbents were in this group already; movers arrive from the other group; newcomers have no place yet
        var stay = [], rest = [];
        for (i = 0; i < cnt; i++) { var id = ag[i]; if (id < old && b.st[id] === gq && !snap) stay.push(id); else rest.push(id); }
        var used = new Uint8Array(cnt);
        // a very large group is matched along the curve instead: old neighbours stay neighbours, in a fraction of the time
        if (stay.length) rest = (cnt > 12000 ? Array.prototype.slice.call(curveOrder(stay, stay.length, b.tx, b.ty, 1, b.box[gq] || sbox)) : seatNearby(stay, b, b.box[gq], S, seats, cnt, sbox, used)).concat(rest);
        if (rest.length) {
          var seatOrder = curveOrder(seats, cnt, S, S, 2, sbox), q = 0;
          for (i = 0; i < rest.length; i++) {
            var m2 = rest[i], li = -1;
            while (q < cnt) { var cand = seatOrder[q++]; if (!used[cand - s0]) { li = cand; break; } }
            if (li < 0) break;
            used[li - s0] = 1;
            b.tx[m2] = S[2 * li]; b.ty[m2] = S[2 * li + 1]; b.st[m2] = gq;
            if (m2 >= old || snap) { b.x[m2] = b.tx[m2]; b.y[m2] = b.ty[m2]; }
          }
        }
      }
      b.box = newBox; b.n = n;
      b.co = null;
      if (t === L.leadT && L.coSeats.length) {      // which of these people sit in a coordinator's seat
        var coKey = {}, ci;
        for (ci = 0; ci < L.coSeats.length; ci++) coKey[S[2 * L.coSeats[ci]] + ',' + S[2 * L.coSeats[ci] + 1]] = 1;
        b.co = new Uint8Array(n);
        for (ci = 0; ci < n; ci++) if (b.st[ci] === 0 && coKey[b.tx[ci] + ',' + b.ty[ci]]) b.co[ci] = 1;
      }
    }
    for (t = nT; t < this.tp.length; t++) if (this.tp[t]) this.tp[t].n = 0;
    this.L = L; this.labels = labels || []; this.rowTags = rowTags || [];
    this.hover = null; this.focusGi = -1;
    if (!this.userCam) { this.camT = this.fitTarget(); if (snap) this.cam = { x: this.camT.x, y: this.camT.y, s: this.camT.s }; }
    this.first = false;
    this.kick();
  };

  World.prototype.kick = function () {
    if (this.raf) return;
    var self = this; this.last = 0;
    this.raf = root.requestAnimationFrame(function step(ts) {
      var dt = self.last ? Math.min(0.05, (ts - self.last) / 1000) : 0.016; self.last = ts;
      var moving = self.advance(dt);
      self.draw();
      self.raf = moving ? root.requestAnimationFrame(step) : 0;
    });
  };
  World.prototype.advance = function (dt) {
    var moving = false, rate = 7.5 * this.speed, t, i;
    for (t = 0; t < this.tp.length; t++) {
      var b = this.tp[t]; if (!b) continue;
      var x = b.x, y = b.y, tx = b.tx, ty = b.ty, k = b.k, n = b.n;
      for (i = 0; i < n; i++) {
        var dx = tx[i] - x[i], dy = ty[i] - y[i];
        if (dx !== 0 || dy !== 0) {
          if (dx * dx + dy * dy < 0.0009) { x[i] = tx[i]; y[i] = ty[i]; }
          else { var a = 1 - Math.exp(-dt * rate * k[i]); x[i] += dx * a; y[i] += dy * a; moving = true; }
        }
      }
    }
    var c = this.cam, g = this.camT, ca = 1 - Math.exp(-dt * 9);
    if (Math.abs(g.x - c.x) * c.s > 0.3 || Math.abs(g.y - c.y) * c.s > 0.3 || Math.abs(g.s / c.s - 1) > 0.002) {
      c.x += (g.x - c.x) * ca; c.y += (g.y - c.y) * ca; c.s *= Math.pow(g.s / c.s, ca); moving = true;
    } else { c.x = g.x; c.y = g.y; c.s = g.s; }
    return moving;
  };

  // A firm's outline: a hexagon standing on a point, drawn around the circle its agents fill, so that
  // neighbouring firms in the hexagonal packing meet edge to edge like cells of a comb.
  var HEX_R = 1 / Math.cos(Math.PI / 6), HEX_X = Math.cos(Math.PI / 6);
  function hexPath(ctx, x, y, r) {
    var R = r * HEX_R, hx = R * HEX_X, hy = R * 0.5;
    ctx.moveTo(x, y - R); ctx.lineTo(x + hx, y - hy); ctx.lineTo(x + hx, y + hy); ctx.lineTo(x, y + R); ctx.lineTo(x - hx, y + hy); ctx.lineTo(x - hx, y - hy); ctx.closePath();
  }
  World.prototype.draw = function () {
    var ctx = this.ctx, w = this.w, h = this.h, C = this.C, L = this.L;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!L || !C) return;
    var s = this.cam.s, ox = w / 2 - this.cam.x * s, oy = h / 2 - this.cam.y * s, i, t, self = this;
    // districts
    L.districts.forEach(function (d) {
      ctx.beginPath(); ctx.arc(ox + d.x * s, oy + d.y * s, d.r * s * 1.04 + 3, 0, TAU);   // a round frame around each firm type; the firms inside stay hexagons
      ctx.fillStyle = C.veil; ctx.fill();
      var lit = d.gi === self.focusGi || (self.hover && self.hover.gi === d.gi && self.hover.kind === 'district');
      ctx.strokeStyle = lit ? C.ink2 : C.hair2; ctx.lineWidth = 1; ctx.stroke();
    });
    var F = L.firms, K = L.links || [];
    // links between the firms of a network, from ring to ring
    if (K.length) {
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.25; ctx.beginPath();
      for (i = 0; i < K.length; i += 2) {
        var fa = F[K[i]], fb = F[K[i + 1]], ra = fa.r * s, rb = fb.r * s;
        if (ra < 2.2) continue;
        var ax = ox + fa.x * s, ay = oy + fa.y * s, bx = ox + fb.x * s, by = oy + fb.y * s, dd = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
        if (dd <= ra + rb || (Math.max(ax, bx) < 0 || Math.min(ax, bx) > w || Math.max(ay, by) < 0 || Math.min(ay, by) > h)) continue;
        var ux = (bx - ax) / dd, uy = (by - ay) / dd;
        ctx.moveTo(ax + ux * ra, ay + uy * ra); ctx.lineTo(bx - ux * rb, by - uy * rb);
      }
      ctx.stroke();
    }
    // firm rings, one pass per colour: neutral for AI-only firms, then each role
    for (var rc = -1; rc < C.types.length - 1; rc++) {
      var any = false;
      ctx.beginPath();
      for (i = 0; i < F.length; i++) {
        var f = F[i]; if (f.maj !== rc) continue;
        var fr = f.r * s; if (fr < 2.2) continue;
        var fx = ox + f.x * s, fy = oy + f.y * s;
        if (fx + fr < 0 || fx - fr > w || fy + fr < 0 || fy - fr > h) continue;
        hexPath(ctx, fx, fy, fr); any = true;
      }
      if (any) { ctx.strokeStyle = rc < 0 ? C.ring : C.types[rc]; ctx.lineWidth = 1; ctx.stroke(); }
    }
    if (this.hover && this.hover.kind === 'firm') {
      var hf = F[this.hover.fi];
      if (hf) { ctx.beginPath(); hexPath(ctx, ox + hf.x * s, oy + hf.y * s, hf.r * s); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    // agents
    var rs = Math.max(0.8, s), nT = L.nT;
    for (t = 0; t < nT; t++) {
      var b = this.tp[t]; if (!b || !b.n) continue;
      var isAI = t === nT - 1, x = b.x, y = b.y, st = b.st, n = b.n, px, py;
      var q = isAI ? rs * 0.68 : rs, sq = isAI || rs < 1.7, co = b.co;   // a copy is drawn at about 70% of a person
      // on a light stage a lime copy sits on a thin olive edge, drawn first so the lime keeps its full size: the edge carries the 3:1
      var edge = isAI && C.aiEdge && C.aiEdge !== C.types[t] ? C.aiEdge : null;
      for (var pass = 0; pass < (co ? 2 : 1); pass++) {   // second pass: former leaders, in the coordinator colour
        ctx.fillStyle = pass ? C.co : C.types[t];
        ctx.beginPath();
        for (i = 0; i < n; i++) {
          if (st[i] !== 0 || (co && co[i] !== pass)) continue;
          px = ox + x[i] * s; py = oy + y[i] * s;
          if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
          if (sq) ctx.rect(px - q, py - q, 2 * q, 2 * q);
          else { ctx.moveTo(px + rs, py); ctx.arc(px, py, rs, 0, TAU); }
        }
        if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2 * Math.max(0.4, Math.min(1, q * 0.3)); ctx.stroke(); }
        ctx.fill();
      }
      // outside firms
      ctx.beginPath();
      if (isAI) {
        var qi = Math.max(0.55, s * 0.5);
        for (i = 0; i < n; i++) {
          if (st[i] !== 1) continue;
          px = ox + x[i] * s; py = oy + y[i] * s;
          if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
          ctx.rect(px - qi, py - qi, 2 * qi, 2 * qi);
        }
        ctx.globalAlpha = 0.7;   // dimmer than a working copy, still 3:1 on a white or a black stage
        if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2 * Math.max(0.35, Math.min(0.8, qi * 0.3)); ctx.stroke(); }
        ctx.fill(); ctx.globalAlpha = 1;
        // the idle copies pack too tightly for their own edges to show, so on a light stage the pool gets one olive outline
        var ip = edge && L.pools.filter(function (pp) { return pp.kind === 'idle'; })[0];
        if (ip) {
          var gx = ox + ip.x * s, gy = oy + ip.y * s, gw = ip.w * s, gs = ip.si * s, rows = Math.ceil(ip.n / ip.ci), last = ip.n - (rows - 1) * ip.ci, lw = last * gs, e2 = 0.5;
          var topW = rows > 1 ? gw : lw;   // a single short row is outlined at its own length
          ctx.beginPath(); ctx.moveTo(gx - e2, gy - e2); ctx.lineTo(gx + topW + e2, gy - e2);
          if (last < ip.ci && rows > 1) { ctx.lineTo(gx + gw + e2, gy + (rows - 1) * gs + e2); ctx.lineTo(gx + lw + e2, gy + (rows - 1) * gs + e2); ctx.lineTo(gx + lw + e2, gy + rows * gs + e2); }
          else ctx.lineTo(gx + topW + e2, gy + rows * gs + e2);
          ctx.lineTo(gx - e2, gy + rows * gs + e2); ctx.closePath();
          ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
        }
      } else if (rs < 1.7) {
        for (i = 0; i < n; i++) {
          if (st[i] !== 1) continue;
          px = ox + x[i] * s; py = oy + y[i] * s;
          if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
          ctx.rect(px - rs, py - rs, 2 * rs, 2 * rs);
        }
        ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      } else {
        var rr = rs * 0.78;
        for (i = 0; i < n; i++) {
          if (st[i] !== 1) continue;
          px = ox + x[i] * s; py = oy + y[i] * s;
          if (px < -4 || px > w + 4 || py < -4 || py > h + 4) continue;
          ctx.moveTo(px + rr, py); ctx.arc(px, py, rr, 0, TAU);
        }
        ctx.strokeStyle = C.types[t]; ctx.lineWidth = Math.max(1, rs * 0.38); ctx.stroke();
      }
    }
    // labels
    if (this.show.labels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
      var placed = [];
      this.labels.forEach(function (lb) {
        var lx = ox + lb.x * s, ly = oy + lb.y * s + 7;
        ctx.font = '700 16px ' + C.fontRead;
        var w1 = ctx.measureText(lb.name).width;
        ctx.font = '11px ' + C.fontUI;
        var w2 = lb.sub ? ctx.measureText(lb.sub).width : 0, bw = Math.max(w1, w2) / 2 + 5;
        for (var guard = 0; guard < 3; guard++) {
          var hit = false;
          for (var p = 0; p < placed.length; p++) { var o = placed[p]; if (Math.abs(o.x - lx) < o.w + bw && Math.abs(o.y - ly) < 27) { hit = true; break; } }
          if (!hit) break; ly += 28;
        }
        placed.push({ x: lx, y: ly, w: bw });
        if (lx + bw < 0 || lx - bw > w || ly > h || ly < -30) return;
        if (lb.ay != null) {                       // leader from a small district down to its label
          var ay = oy + lb.ay * s + 3;
          if (ly - ay > 12) { ctx.beginPath(); ctx.moveTo(lx, ay); ctx.lineTo(lx, ly - 3); ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
        }
        ctx.lineWidth = 3.5; ctx.strokeStyle = C.page;
        ctx.font = '700 16px ' + C.fontRead; ctx.strokeText(lb.name, lx, ly); ctx.fillStyle = C.ink; ctx.fillText(lb.name, lx, ly);
        if (lb.sub) { ctx.font = '11px ' + C.fontUI; ctx.strokeText(lb.sub, lx, ly + 17); ctx.fillStyle = C.ink2; ctx.fillText(lb.sub, lx, ly + 17); }
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      this.rowTags.forEach(function (rt) {
        var tx = ox + rt.x * s, ty = oy + rt.y * s - 9;
        if (ty < 12 || ty > h) return;
        ctx.font = '600 12px ' + C.fontUI; ctx.lineWidth = 3.5; ctx.strokeStyle = C.page;
        var txt = rt.text;
        ctx.strokeText(txt, tx, ty); ctx.fillStyle = C.ink3; ctx.fillText(txt, tx, ty);
      });
    }
  };

  World.prototype.pick = function (cx, cy) {
    var L = this.L; if (!L) return null;
    var s = this.cam.s, wx = this.cam.x + (cx - this.w / 2) / s, wy = this.cam.y + (cy - this.h / 2) / s, i;
    for (i = 0; i < L.districts.length; i++) {
      var d = L.districts[i], dx = wx - d.x, dy = wy - d.y;
      if (dx * dx + dy * dy <= d.r * d.r) {
        if (!d.micro) {
          var best = -1, bd = Infinity;
          for (var f = d.f0; f < d.f0 + d.nF; f++) { var ff = L.firms[f], ex = wx - ff.x, ey = wy - ff.y, e2 = ex * ex + ey * ey; if (e2 < bd) { bd = e2; best = f; } }
          if (best >= 0 && bd <= Math.pow(L.firms[best].r + 0.6, 2)) return { kind: 'firm', gi: d.gi, ri: d.ri, fi: best, firm: L.firms[best] };
        }
        return { kind: 'district', gi: d.gi, ri: d.ri };
      }
    }
    for (i = 0; i < L.pools.length; i++) {
      var p = L.pools[i];
      if (wx >= p.x - 2 && wx <= p.x + p.w + 2 && wy >= p.y - 2 && wy <= p.y + p.h + 2) return { kind: p.kind, n: p.n };
    }
    return null;
  };

  World.prototype._bind = function () {
    var self = this, cv = this.cv, ptrs = {}, drag = null, pinch = 0, moved = false;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ } ptrs[e.pointerId] = pos(e); moved = false;
      var ids = Object.keys(ptrs);
      if (ids.length === 1) drag = { p: pos(e), cx: self.camT.x, cy: self.camT.y };
      else if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null; }
      cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e), ids = Object.keys(ptrs);
      if (ptrs[e.pointerId]) ptrs[e.pointerId] = p;
      if (ids.length === 2 && pinch) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d > 0) { self.zoomBy(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); self.cam.s = self.camT.s; self.cam.x = self.camT.x; self.cam.y = self.camT.y; pinch = d; }
        return;
      }
      if (drag) {
        var dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (moved) {
          self.camT.x = drag.cx - dx / self.camT.s; self.camT.y = drag.cy - dy / self.camT.s;
          self.cam.x = self.camT.x; self.cam.y = self.camT.y; self.userCam = true; self.kick();
          if (self.cb.onHover) self.cb.onHover(null);
        }
        return;
      }
      var hit = self.pick(p[0], p[1]);
      var same = hit && self.hover && hit.kind === self.hover.kind && hit.gi === self.hover.gi && hit.fi === self.hover.fi;
      if (!same) { self.hover = hit; self.kick(); }
      if (self.cb.onHover) self.cb.onHover(hit, e.clientX, e.clientY);
    });
    function up(e) {
      delete ptrs[e.pointerId]; pinch = 0; drag = null; cv.classList.remove('dragging');
      if (!moved && e.type === 'pointerup' && self.cb.onPick) { var p = pos(e); self.cb.onPick(self.pick(p[0], p[1])); }
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', function () { if (self.hover) { self.hover = null; self.kick(); } if (self.cb.onHover) self.cb.onHover(null); });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pos(e), f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      self.zoomBy(f, p[0], p[1]);
    }, { passive: false });
    cv.addEventListener('dblclick', function () { self.fit(); });
  };

  root.OIWorld = { World: World, layout: layoutWorld };
})(typeof globalThis !== 'undefined' ? globalThis : this);
