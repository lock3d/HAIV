/* Readouts (right rail) and the strip-chart recorder under the stage. */
(function (root) {
  'use strict';
  var OI = root.OI, A = root.OIApp, doc = document;
  var el = A.el, sv = A.sv, $ = A.$, clamp = A.clamp, F = A.fmt;

  function ticks(lo, hi, n) {
    var span = hi - lo; if (!(span > 0)) return [lo];
    var step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = [], v = Math.ceil(lo / step - 1e-9) * step;
    for (; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function tickText(v) { return Math.abs(v) >= 1000 ? F.compact(v) : String(+v.toFixed(2)); }

  // composition as a thin segmented bar (2px surface gaps, rounded ends)
  A.mixBar = function (st, rc) {
    var bar = el('div', { class: 'mixbar bar', role: 'img', 'aria-label': 'Composition' });
    st.roles.forEach(function (r, i) { if (rc.sRole[i] > 0.0005) bar.appendChild(el('i', { style: 'flex:' + rc.sRole[i].toFixed(4) + ' 1 0;background:' + A.roleVar(r), title: r.name + ' ' + F.pct(rc.sRole[i]) })); });
    if (rc.sAI > 0.0005) bar.appendChild(el('i', { style: 'flex:' + rc.sAI.toFixed(4) + ' 1 0;background:var(--c-ai);box-shadow:inset 0 0 0 1px var(--c-ai-edge)', title: 'AI ' + F.pct(rc.sAI) }));
    return bar;
  };

  // each readout is a group like the parameter groups: tinted header, chevron, line icon, open or closed
  var CARD_ICON = {
    'card-map': 'M2.5 2v11.5H14M5 9.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0M8.5 6a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 10a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'card-firms': 'M5 2.5h6L14 8l-3 5.5H5L2 8z',
    'card-wages': 'M2 4.5h12v7H2zM9.6 8a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0M4 6.5v3M12 6.5v3',
    'card-scale': 'M2 13.5h12M2.5 12C5 4.5 7 3.5 8 3.5s3 1 5.5 8.5M8 3.5v10',
    'card-compare': 'M2.5 6h4v7.5h-4zM9.5 3h4v10.5h-4z',
    'card-league': 'M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h1M2.5 8h1M2.5 12h1'
  };
  var cardOpen = { 'card-map': true };   // the panel opens on its first group; the rest wait closed
  // a chart is drawn at the width it is shown at, so its text and pointer positions are true to size
  function chartW(svg) { return Math.max(220, Math.round(svg.getBoundingClientRect().width) || 0); }
  function card(id, title, sub) {
    var body = el('div', { class: 'card-body', id: id + '-body' });
    var c = el('details', { class: 'grp card', id: id }, [
      el('summary', null, [el('i', { class: 'tw' }), CARD_ICON[id] ? sv('svg', { class: 'gico', viewBox: '0 0 16 16', 'aria-hidden': 'true' }, sv('path', { d: CARD_ICON[id] })) : null, el('h3', { class: 'gname', text: title }), el('span', { class: 'gsum', id: id + '-sum' })]),
      body
    ]);
    c.open = !!cardOpen[id];
    // charts measure themselves, so a group that opens is drawn again at its real width
    c.addEventListener('toggle', function () { cardOpen[id] = c.open; if (c.open && A.onResize) A.onResize(); });
    if (sub) body.appendChild(el('p', { class: 'sub', text: sub }));
    return { el: c, body: body };
  }

  // ───────────────────────── capability map ─────────────────────────
  var mapMode = 'cc', mapSvg = null, mapG = null, mapDrag = false;
  function buildMap() {
    var seg = el('div', { class: 'seg wide', role: 'group', 'aria-label': 'Axes' }, [
      el('button', { id: 'map-cc', 'aria-pressed': 'true', text: 'Coordination', onclick: function () { mapMode = 'cc'; renderMap(); } }),
      el('button', { id: 'map-ss', 'aria-pressed': 'false', text: 'Skills', onclick: function () { mapMode = 'ss'; renderMap(); } })
    ]);
    var c = card('card-map', 'Capability space');
    c.body.appendChild(seg);
    mapSvg = sv('svg', { class: 'drag', role: 'img', 'aria-label': 'Capabilities of people, firms and the AI. Drag the AI square, or use the AI sliders.' });
    c.body.appendChild(mapSvg);
    c.body.appendChild(el('p', { class: 'sub cap', id: 'map-cap' }));
    // a pointer position in the drawing's own units, whatever size the chart is shown at
    function at(e) {
      var r = mapSvg.getBoundingClientRect(), vb = mapSvg.viewBox.baseVal, k = vb && vb.width ? Math.min(r.width / vb.width, r.height / vb.height) : 1;
      if (!(k > 0)) k = 1;
      var w = vb && vb.width ? vb.width * k : r.width, h = vb && vb.height ? vb.height * k : r.height;
      return [(e.clientX - r.left - (r.width - w) / 2) / k, (e.clientY - r.top - (r.height - h) / 2) / k];
    }
    function move(e) {
      if (!mapG) return;
      var p = at(e), st = A.state(), x = mapG.ix(p[0]), y = mapG.iy(p[1]);
      if (mapMode === 'cc') {
        var L = OI.cesL(st.ai.y1, st.ai.y2, st.rho), k = L > 0 ? clamp(x, 0.2, 15) / L : 1;
        st.ai.y1 = clamp(+(st.ai.y1 * k).toFixed(3), 0.2, 15); st.ai.y2 = clamp(+(st.ai.y2 * k).toFixed(3), 0.2, 15);
        st.ai.ys = clamp(Math.round(y * 200) / 200, 0, 1.6);
      } else {
        st.ai.y1 = clamp(Math.round(x * 20) / 20, 0.2, 15); st.ai.y2 = clamp(Math.round(y * 20) / 20, 0.2, 15);
        st.lockAI = Math.abs(st.ai.y1 - st.ai.y2) < 1e-9;
      }
      st.viewA = false; A.syncAll(); A.requestSolve(true);
    }
    mapSvg.addEventListener('pointerdown', function (e) { A.stopPlay(); mapDrag = true; try { mapSvg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ } move(e); });
    mapSvg.addEventListener('pointermove', function (e) { if (mapDrag) move(e); });
    function end() { mapDrag = false; }
    mapSvg.addEventListener('pointerup', end); mapSvg.addEventListener('pointercancel', end);
    return c.el;
  }
  function hull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }), lo = [], up = [], i;
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    for (i = 0; i < p.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop(); lo.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop(); up.push(p[i]); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  function renderMap() {
    var sh = A.shown(); if (!sh.res || !mapSvg) return;
    var st = sh.st, res = sh.res, P = res.P, cls = res.regime, cc = mapMode === 'cc';
    $('map-cc').setAttribute('aria-pressed', String(cc)); $('map-ss').setAttribute('aria-pressed', String(!cc));
    var W = chartW(mapSvg), H = 216, m = { l: 34, r: 12, t: 12, b: 30 };
    mapSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); mapSvg.setAttribute('height', H);
    mapSvg.textContent = '';
    var roles = [], i;
    P.roles.forEach(function (r, k) { if (r.n > 0) roles.push({ r: r, k: k, L: OI.cesL(r.y1, r.y2, P.rho) }); });
    var ai = P.ai, hasAI = ai.cap > 0, LM = OI.cesL(ai.y1, ai.y2, P.rho), recs = res.recipes.filter(function (rc) { return rc.share > 0.02 || rc.x > 1; });
    var xs = [], ys = [];
    if (cc) {
      roles.forEach(function (o) { xs.push(o.L, Math.max(o.r.y1, o.r.y2)); ys.push(o.r.ys); });
      if (hasAI) { xs.push(LM); ys.push(ai.ys); }
      ys.push(1);
    } else {
      roles.forEach(function (o) { xs.push(o.r.y1); ys.push(o.r.y2); });
      if (hasAI) { xs.push(ai.y1); ys.push(ai.y2); }
    }
    var xmax = Math.max.apply(null, xs.concat([1])) * 1.16, ymax, ymin;
    if (cc) { ymin = Math.max(0, Math.floor((Math.min.apply(null, ys) - 0.08) * 10) / 10); ymax = Math.max(1.12, Math.max.apply(null, ys) + 0.08); }
    else { ymin = 0; ymax = Math.max.apply(null, ys.concat([1])) * 1.16; xmax = ymax = Math.max(xmax, ymax); }
    if (ticks(ymin, ymax, 4).some(function (v) { return tickText(v).length > 3; })) m.l = 42;   // two-decimal ticks need room beside the axis title
    var x0 = m.l, x1 = W - m.r, y0 = H - m.b, y1 = m.t;
    function X(v) { return x0 + (x1 - x0) * v / xmax; }
    function Y(v) { return y0 + (y1 - y0) * (v - ymin) / (ymax - ymin); }
    mapG = { ix: function (px) { return (px - x0) / (x1 - x0) * xmax; }, iy: function (py) { return ymin + (py - y0) / (y1 - y0) * (ymax - ymin); } };
    var g = mapSvg;
    function line(xa, ya, xb, yb, col, wdt) { g.appendChild(sv('line', { x1: xa, y1: ya, x2: xb, y2: yb, stroke: col || 'var(--hair)', 'stroke-width': wdt || 1 })); }
    function text(x, y, t, cls2, anchor) { g.appendChild(sv('text', { x: x, y: y, class: cls2 || '', 'text-anchor': anchor || 'start', text: t })); }
    ticks(0, xmax, 5).forEach(function (v) { line(X(v), y0, X(v), y0 + 3, 'var(--hair-2)'); text(X(v), y0 + 13, tickText(v), '', 'middle'); });
    ticks(ymin, ymax, 4).forEach(function (v) { line(x0, Y(v), x1, Y(v)); text(x0 - 5, Y(v) + 3, tickText(v), '', 'end'); });
    line(x0, y0, x1, y0, 'var(--hair-2)');
    text((x0 + x1) / 2, H - 3, cc ? 'task competence L' : 'task skill 1', 'tag', 'middle');
    g.appendChild(sv('text', { x: 9, y: (y0 + y1) / 2, class: 'tag', 'text-anchor': 'middle', transform: 'rotate(-90 9 ' + (y0 + y1) / 2 + ')', text: cc ? 'coordination' : 'task skill 2' }));
    if (cc && (roles.length || hasAI)) {
      // regime borders (paper Fig. 3 and 13): the scale threshold and the best human skill
      line(x0, Y(1), x1, Y(1), 'var(--ink-3)');
      if (roles.length && hasAI) {
        var best = Math.max(cls.max1 || 0, cls.max2 || 0);
        if (best < xmax) { var nearR = X(best) > x1 - 92; line(X(best), y0, X(best), y1, 'var(--ink-3)'); g.appendChild(sv('text', { x: X(best) + (nearR ? -4 : 4), y: y0 - 5, class: 'tag', 'text-anchor': nearR ? 'end' : 'start', text: 'best human skill' })); }
        if (cls.Lbar != null) {
          var ax = X(cls.Lbar), ay = Y(clamp(cls.zbar, ymin, ymax));
          line(ax - 4, ay, ax + 4, ay, 'var(--ink-2)', 1.2); line(ax, ay - 4, ax, ay + 4, 'var(--ink-2)', 1.2);
        }
      }
      text(x1 - 2, Y(1) - 4, 'scale threshold', 'tag thr', 'end');   // after the lines, so its halo keeps the skill line out of it
    } else {
      // capability envelope and iso-competence curves (paper Fig. 1a)
      if (roles.length >= 2) {
        var hp = hull(roles.map(function (o) { return [o.r.y1, o.r.y2]; }));
        g.appendChild(sv('polygon', { points: hp.map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' '), fill: 'var(--veil)', stroke: 'var(--ink-3)', 'stroke-width': 1 }));
      }
      var levels = [];
      recs.forEach(function (rc) { if (rc.sAI < 0.9995) levels.push(rc.L); });
      if (hasAI) levels.push(LM);
      levels.sort(function (a, b) { return a - b; });
      levels = levels.filter(function (v, k) { return v > 0 && (k === 0 || v - levels[k - 1] > xmax * 0.04); }).slice(-4);
      var aiLx = hasAI ? X(ai.y1) : -99, aiLy = hasAI ? Y(clamp(ai.y2, ymin, ymax)) : -99;   // curve labels keep clear of the AI's label
      levels.forEach(function (c) {
        var d = '', started = false, rho = P.rho;
        for (i = 0; i <= 60; i++) {
          var a = xmax * (0.004 + i / 60), b;
          if (Math.abs(rho) < 1e-6) b = c * c / a;
          else { var inner = 2 * Math.pow(c, rho) - Math.pow(a, rho); if (!(inner > 0)) continue; b = Math.pow(inner, 1 / rho); }
          if (!(b > 0) || b > ymax * 1.5) { started = false; continue; }
          d += (started ? 'L' : 'M') + X(a).toFixed(1) + ' ' + Y(Math.min(b, ymax * 1.5)).toFixed(1); started = true;
        }
        if (d) g.appendChild(sv('path', { d: d, fill: 'none', stroke: 'var(--hair-2)', 'stroke-width': 1, 'clip-path': 'none' }));
        if (c < xmax * 0.94 && !(Math.abs(X(c) + 4 - aiLx) < 44 && Math.abs(Y(c) - 4 - aiLy) < 18)) text(X(c) + 4, Y(c) - 4, 'L ' + tickText(+c.toFixed(2)), '', 'start');
      });
    }
    // firm types, in the skills view: what the organisation reaches (mosaic intelligence)
    var marks = [];
    if (!cc) recs.forEach(function (rc) {
      var px = X(rc.y1), py = Y(clamp(rc.y2, ymin, ymax)), s = 4.5;
      marks.push([px, py]);
      g.appendChild(sv('path', { d: 'M' + px + ' ' + (py - s) + 'L' + (px + s) + ' ' + py + 'L' + px + ' ' + (py + s) + 'L' + (px - s) + ' ' + py + 'Z', fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 1.3 }));
    });
    // roles that land on the same spot share one label and sit side by side
    var spots = [];
    roles.forEach(function (o) {
      var px = X(cc ? o.L : o.r.y1), py = Y(clamp(cc ? o.r.ys : o.r.y2, ymin, ymax)), rr = clamp(2.5 + Math.sqrt(o.r.n) * 0.28, 4, 9), hit = null;
      spots.forEach(function (sp) { if (Math.abs(sp.x - px) < 9 && Math.abs(sp.y - py) < 9) hit = sp; });
      if (!hit) { hit = { x: px, y: py, items: [], r: rr }; spots.push(hit); }
      hit.items.push({ o: o, r: rr }); if (rr > hit.r) hit.r = rr;
    });
    var axp = hasAI ? X(cc ? LM : ai.y1) : -99, ayp = hasAI ? Y(clamp(cc ? ai.ys : ai.y2, ymin, ymax)) : -99;
    spots.forEach(function (sp) {
      var n = sp.items.length, wdt = 0;
      sp.items.forEach(function (it, q) {
        var cx = sp.x + (n > 1 ? (q - (n - 1) / 2) * (it.r * 1.5) : 0);
        g.appendChild(sv('circle', { cx: cx, cy: sp.y, r: it.r, fill: A.roleVar(st.roles[it.o.k]), stroke: 'var(--surface)', 'stroke-width': 2 }));
        wdt = cx + it.r - sp.x;
      });
      if (roles.length <= 5) {
        var below = hasAI && Math.abs(axp - sp.x) < 60 && ayp <= sp.y + 4 && sp.y - ayp < 22;
        var names = sp.items.map(function (it) { return st.roles[it.o.k].name; }).join(', '); if (names.length > 26) names = names.slice(0, 25) + '…';
        var right = sp.x + wdt + 6 + names.length * 5.9 < x1;
        text(sp.x + (right ? wdt + 5 : -wdt - 5), sp.y + (below ? 12 : 3.5), names, '', right ? 'start' : 'end');
      }
    });
    // the scale-threshold tag leaves any spot where the AI square or a role dot would cover it
    var thr = g.querySelector('text.thr');
    if (thr) {
      var dots = spots.map(function (sp) { return [sp.x - sp.r - 4, sp.y - sp.r, sp.x + sp.r * 2.5, sp.y + sp.r]; });
      if (hasAI) dots.push([axp - 7, ayp - 7, axp + 7, ayp + 7]);
      var tries = [[x1 - 2, Y(1) - 4, 'end'], [x0 + 4, Y(1) - 4, 'start'], [x1 - 2, Y(1) + 11, 'end'], [x0 + 4, Y(1) + 11, 'start']];
      for (var tI = 0; tI < tries.length; tI++) {
        thr.setAttribute('x', tries[tI][0]); thr.setAttribute('y', tries[tI][1]); thr.setAttribute('text-anchor', tries[tI][2]);
        var tb = thr.getBBox();
        if (!dots.some(function (d) { return tb.x < d[2] && tb.x + tb.width > d[0] && tb.y < d[3] && tb.y + tb.height > d[1]; })) break;
        if (tI === tries.length - 1) { thr.setAttribute('x', x1 - 2); thr.setAttribute('y', Y(1) - 4); thr.setAttribute('text-anchor', 'end'); }
      }
    }
    if (hasAI) {
      g.appendChild(sv('rect', { x: axp - 5.5, y: ayp - 5.5, width: 11, height: 11, fill: 'var(--c-ai)', stroke: 'var(--c-ai-edge)', 'stroke-width': 1.5 }));
      // the AI's label takes the first place where it covers no other label, line label or diamond
      var taken = [].slice.call(g.querySelectorAll('text')).map(function (t) { var b = t.getBBox(); return [b.x - 2, b.y - 1, b.x + b.width + 2, b.y + b.height + 1]; });
      marks.forEach(function (q) { taken.push([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5]); });
      var aiLab = sv('text', { class: 'strong', text: 'AI' }); g.appendChild(aiLab);
      var spots2 = [[10, -7, 'start'], [-10, -7, 'end'], [10, 15, 'start'], [-10, 15, 'end'], [0, -12, 'middle'], [0, 22, 'middle']];
      for (var sIx = 0; sIx < spots2.length; sIx++) {
        var sp2 = spots2[sIx];
        aiLab.setAttribute('x', axp + sp2[0]); aiLab.setAttribute('y', ayp + sp2[1]); aiLab.setAttribute('text-anchor', sp2[2]);
        var bb = aiLab.getBBox(), box2 = [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height];
        var inside = box2[0] >= x0 - 2 && box2[2] <= W - 2 && box2[1] >= 0 && box2[3] <= H;
        var clash = taken.some(function (t) { return box2[0] < t[2] && box2[2] > t[0] && box2[1] < t[3] && box2[3] > t[1]; });
        if (inside && !clash) break;
        if (sIx === spots2.length - 1) { aiLab.setAttribute('x', axp + 10); aiLab.setAttribute('y', ayp - 7); aiLab.setAttribute('text-anchor', 'start'); }
      }
    }
    if (!roles.length && !hasAI) text((x0 + x1) / 2, (y0 + y1) / 2, 'Nobody here yet: add people or an AI fleet', 'strong', 'middle');
    $('map-cap').textContent = cc
      ? 'Dots are roles and the square is the AI (drag it). Above the scale threshold, output per agent keeps rising as a firm grows; right of the best human skill, the AI out-skills every person.'
      : 'Dots are roles, diamonds are the firms they form, the square is the AI (drag it). The shaded area holds every mix of skills a human team can assemble, so a team can sit far from all its members: that is mosaic intelligence. Curves join skill pairs of equal competence.';
  }

  // ───────────────────────── firm types (table twin of the stage) ─────────────────────────
  var hlRecipe = -1, openRecipes = {};
  function renderFirms() {
    var sh = A.shown(), body = $('card-firms-body'); if (!sh.res || !body) return;
    var st = sh.st, res = sh.res, real = sh.real;
    body.textContent = '';
    if (!res.recipes.length) { body.appendChild(el('p', { class: 'sub', text: 'No firm operates with these settings.' })); return; }
    var multi = res.markets.length > 1, names = A.recipeNames(st, res, real);
    var tb = el('tbody');
    res.recipes.forEach(function (rc, ri) {
      var gi = -1; real.groups.forEach(function (x, k) { if (x.ri === ri) gi = k; });
      var open = !!openRecipes[ri], did = 'firm-detail-' + ri;
      // the name is a real button: details open for keyboard, touch and screen readers alike
      var btn = el('button', { class: 'rowbtn', 'aria-expanded': String(open), 'aria-controls': did }, [el('i', { class: 'tw' }), el('span', { text: names[ri] })]);
      function toggle() { openRecipes[ri] = !openRecipes[ri]; hlRecipe = ri; renderFirms(); var nb = doc.querySelector('[aria-controls="' + did + '"]'); if (nb) nb.focus(); }
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
      var tr = el('tr', { class: 'main click' + (ri === hlRecipe ? ' hl' : '') + (open ? ' open' : '') }, [
        el('td', null, [btn, multi ? el('div', { class: 'rowsub', text: (res.markets[rc.mk].name || '') }) : null, A.mixBar(st, rc), el('div', { class: 'rowsub', text: F.pct(1 - rc.sAI) + ' human, ' + OI.STATE_NAMES[rc.st] })]),
        el('td', { text: rc.m > 0 ? F.compact(rc.n) : '–' }),
        el('td', { text: rc.m > 0 ? F.size(rc.m) : 'any' }),
        el('td', { text: F.compact(rc.a) }),
        el('td', { text: F.pct(rc.share) })
      ]);
      tr.addEventListener('click', toggle);
      tb.appendChild(tr);
      if (open) {
        var find = gi >= 0 ? el('button', { class: 'linkbtn', text: 'Find these firms on the stage', onclick: function () { A.world.focus(gi); } }) : null;
        tb.appendChild(el('tr', { class: 'detail' + (ri === hlRecipe ? ' hl' : ''), id: did }, el('td', { colspan: 5 }, [A.kvList(A.firmFacts(res.P, rc)), find])));
      }
    });
    body.appendChild(el('div', { class: 'tscroll' }, el('table', { class: 't' }, [
      el('thead', null, el('tr', null, [el('th', { text: 'Firm type' }), el('th', { text: 'Firms' }), el('th', { text: 'Size' }), el('th', { text: 'Per agent', title: 'Output per agent' }), el('th', { text: 'Share', title: multi ? 'Share of its market’s output' : 'Share of output' })])), tb
    ])));
    body.appendChild(el('p', { class: 'sub cap', text: 'Select a firm type for its coordination, preferred size and what it pays for each capability.' }));
  }
  A.highlightRecipe = function (ri) { hlRecipe = ri; renderFirms(); };

  // ───────────────────────── scale curves (paper Fig. 1b) ─────────────────────────
  function renderScale() {
    var sh = A.shown(), body = $('card-scale-body'); if (!sh.res || !body) return;
    var st = sh.st, res = sh.res, P = res.P;
    var svg = body.querySelector('svg') || body.insertBefore(sv('svg', { role: 'img', 'aria-label': 'Output per agent against firm size for each firm type' }), body.firstChild);
    svg.textContent = '';
    var W = chartW(svg), H = 168, m = { l: 34, r: 12, t: 12, b: 28 };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('height', H);
    var recs = res.recipes.slice().sort(function (a, b) { return b.out - a.out; }).slice(0, 4);
    var none = body.querySelector('.sub.none'), oldCap = body.querySelector('.sub.cap');
    if (!recs.length) {                                  // nothing to plot: say so instead of leaving a blank card
      svg.setAttribute('height', 0); if (oldCap) oldCap.remove();
      if (!none) body.appendChild(el('p', { class: 'sub none', text: 'No firms yet. Once something is produced, this shows output per agent against firm size for each firm type.' }));
      return;
    }
    if (none) none.remove();
    var maxM = 10, minM = 1;
    recs.forEach(function (rc) { if (rc.m > maxM) maxM = rc.m; if (rc.m > 0 && rc.m < minM) minM = rc.m; if (isFinite(rc.mPref) && rc.mPref > maxM) maxM = rc.mPref; });
    var lo = Math.log10(Math.max(0.1, minM * 0.5)), hi = Math.log10(Math.min(40000, Math.max(30, maxM * 3))), N = 70, ymax = 0, curves = [];
    recs.forEach(function (rc) {
      var pts = [];
      for (var i = 0; i <= N; i++) { var mm = Math.pow(10, lo + (hi - lo) * i / N), a = P.constReturns ? rc.L : rc.L * (rc.ic ? rc.ic.H : 1) * OI.gScale(mm, rc.z, P.phi); pts.push([mm, a]); if (a > ymax) ymax = a; }
      if (rc.a > ymax) ymax = rc.a;
      curves.push({ rc: rc, pts: pts });
    });
    ymax *= 1.12;
    var x0 = m.l, x1 = W - m.r, y0 = H - m.b, y1 = m.t;
    function X(v) { return x0 + (x1 - x0) * (Math.log10(v) - lo) / (hi - lo); }
    function Y(v) { return y0 + (y1 - y0) * v / ymax; }
    ticks(0, ymax, 4).forEach(function (v) { svg.appendChild(sv('line', { x1: x0, y1: Y(v), x2: x1, y2: Y(v), stroke: 'var(--hair)' })); svg.appendChild(sv('text', { x: x0 - 5, y: Y(v) + 3, 'text-anchor': 'end', text: tickText(v) })); });
    for (var e = Math.ceil(lo); e <= Math.floor(hi); e++) { var xv = Math.pow(10, e); svg.appendChild(sv('line', { x1: X(xv), y1: y0, x2: X(xv), y2: y0 + 3, stroke: 'var(--hair-2)' })); svg.appendChild(sv('text', { x: X(xv), y: y0 + 13, 'text-anchor': 'middle', text: xv >= 1000 ? (xv / 1000) + 'K' : String(xv) })); }
    svg.appendChild(sv('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: 'var(--hair-2)' }));
    svg.appendChild(sv('text', { x: (x0 + x1) / 2, y: H - 2, class: 'tag', 'text-anchor': 'middle', text: 'firm size (agents, log scale)' }));
    var used = [];
    curves.forEach(function (c) {
      var rc = c.rc, col = rc.sAI > 0.9995 ? 'var(--c-ai-edge)' : (rc.sAI < 0.0005 ? 'var(--ink)' : 'var(--ink-3)');
      svg.appendChild(sv('path', { d: c.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(''), fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (isFinite(rc.mPref) && rc.mPref > 0 && Math.log10(rc.mPref) <= hi && !P.constReturns) {
        var px = X(rc.mPref), py = Y(rc.L * (rc.ic ? rc.ic.H : 1) * OI.gScale(rc.mPref, rc.z, P.phi));
        svg.appendChild(sv('line', { x1: px, y1: py - 6, x2: px, y2: py + 6, stroke: col, 'stroke-width': 1.5 }));
      }
      if (rc.m > 0) {
        var ox = X(clamp(rc.m, Math.pow(10, lo), Math.pow(10, hi))), oy = Y(rc.a), ly = oy - 8;
        svg.appendChild(sv('circle', { cx: ox, cy: oy, r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2 }));
        used.forEach(function (u) { if (Math.abs(u[0] - ox) < 70 && Math.abs(u[1] - ly) < 11) ly = u[1] + 12 + (oy - 8 - u[1] > 0 ? 6 : 0); });
        used.push([ox, ly]);
        var right = ox < x1 - 90;
        svg.appendChild(sv('text', { x: ox + (right ? 7 : -7), y: ly, 'text-anchor': right ? 'start' : 'end', class: 'strong', text: A.recipeName(st, rc) }));
      }
    });
    var cap = body.querySelector('.sub.cap') || body.appendChild(el('p', { class: 'sub cap' }));
    var any = recs.some(function (rc) { return !isFinite(rc.mPref); });
    cap.textContent = P.constReturns ? 'Constant returns: output per agent does not depend on firm size.'
      : 'Dots mark each firm type’s size; ticks mark its preferred size, the ceiling set by coordination.' + (any ? ' A curve with no tick has no ceiling: it grows until the market is full.' : '');
  }

  // ───────────────────────── wages ─────────────────────────
  function renderWages() {
    var sh = A.shown(), body = $('card-wages-body'); if (!sh.res || !body) return;
    var st = sh.st, res = sh.res, real = sh.real, rank = sh.rank, P = res.P;
    body.textContent = '';
    var max = Math.max(P.w, P.ai.cap > 0 ? P.r : 0), spread = [], any = false;
    st.roles.forEach(function (r, i) {
      var w = res.wages[i], lo = w, hi = w;
      if (rank && rank[i] && P.roles[i].n > 0) {
        var emp = Math.round(P.roles[i].n) - real.unemployed[i], ws = [];
        for (var k = 0; k < emp; k++) ws.push(Math.max(P.w, w + rank[i].score[rank[i].order[k]]));
        if (ws.length) { ws.sort(function (a, b) { return a - b; }); lo = ws[Math.floor(0.1 * (ws.length - 1))]; hi = ws[Math.ceil(0.9 * (ws.length - 1))]; }
      }
      spread.push([lo, hi]); if (hi > max) max = hi; if (w > max) max = w;
    });
    max *= 1.08;
    var grid = el('div', { class: 'wgrid' });
    st.roles.forEach(function (r, i) {
      if (!(P.roles[i].n > 0)) return;
      any = true;
      var w = res.wages[i], emp = res.employed[i], n = P.roles[i].n, track = el('div', { class: 'wtrack' });
      track.appendChild(el('div', { class: 'wb', style: 'width:' + (100 * w / max).toFixed(2) + '%;background:' + A.roleVar(r) + (emp < 0.5 ? ';opacity:.4' : '') }));
      if (spread[i][1] - spread[i][0] > 1e-6) track.appendChild(el('div', { class: 'wr', title: 'Middle 80% of individual pay', style: 'left:' + (100 * spread[i][0] / max).toFixed(2) + '%;width:' + (100 * (spread[i][1] - spread[i][0]) / max).toFixed(2) + '%;background:' + A.roleVar(r) }));
      track.appendChild(el('div', { class: 'wref', style: 'left:' + (100 * P.w / max).toFixed(2) + '%' }));
      if (P.ai.cap > 0) track.appendChild(el('div', { class: 'wref', style: 'left:' + (100 * P.r / max).toFixed(2) + '%;background:var(--c-ai-edge)' }));
      grid.appendChild(el('div', { class: 'wn', title: r.name }, [el('i', { style: 'background:' + A.roleVar(r) }), el('span', { text: r.name })]));
      grid.appendChild(track);
      grid.appendChild(el('div', { class: 'wval num', text: F.money(w) }));
      grid.appendChild(el('div', { class: 'rowsub wsub', text: F.whole(emp) + ' of ' + F.whole(n) + ' in firms' + (emp < n - 0.5 && emp > 0.5 ? ', so pay sits at the outside option' : emp <= 0.5 ? ': all take the outside option' : '')
        + (res.lead && res.lead.role === i && emp > 0.5 ? '. ' + F.whole(res.lead.leading) + (Math.round(res.lead.leading) === 1 ? ' leads a firm' : ' lead a firm') + (res.lead.demoted > 0.5 ? ', ' + F.whole(res.lead.demoted) + (Math.round(res.lead.demoted) === 1 ? ' works on as a coordinator' : ' work on as coordinators') : '') : '') }));
    });
    if (!any) { body.appendChild(el('p', { class: 'sub', text: 'There are no people in this scenario, so there are no wages to show.' })); return; }
    var ax = el('div', { class: 'waxis' });
    var p1 = 100 * P.w / max, p2 = 100 * P.r / max, close = Math.abs(p1 - p2) < 34;
    ax.appendChild(el('span', { style: 'left:' + p1.toFixed(1) + '%', text: 'outside ' + F.money(P.w) }));
    if (P.ai.cap > 0) ax.appendChild(el('span', { style: 'left:' + p2.toFixed(1) + '%;top:' + (close ? 16 : 2) + 'px', text: 'one AI copy ' + F.money(P.r) }));
    ax.style.height = close && P.ai.cap > 0 ? '32px' : '16px';
    grid.appendChild(ax);
    body.appendChild(grid);
    body.appendChild(el('p', { class: 'sub cap', text: 'A wage is what one more person in that role would add to total surplus. It rises above the outside option only while everyone in the role is employed.' + (st.sigma > 0 ? ' The pale band is the middle 80% of individuals.' : '') }));
  }

  // ───────────────────────── structure league ─────────────────────────
  var LEAGUE = [
    { id: 'free', name: 'Free equilibrium', sub: 'firms choose size and mix', rules: {} },
    { id: 'nomix', name: 'People and AI in separate firms', rules: { mixed: false } },
    { id: 'silo', name: 'Single-role firms', sub: 'no mosaic teams', rules: { mosaic: false } },
    { id: 'cap', name: 'No firm above 10 agents', rules: { size: 'cap', sizeValue: 10 } },
    { id: 'fixed', name: 'Every firm has 50 agents', rules: { size: 'fixed', sizeValue: 50 } },
    { id: 'solo', name: 'Everyone works alone', rules: { size: 'solo' } },
    { id: 'one', name: 'One organisation', rules: { size: 'single' } },
    { id: 'loop', name: 'Every firm at least 30% human', rules: { minHuman: 0.3 } },
    { id: 'noai', name: 'No AI at all', rules: { minHuman: 1 } }
  ];
  var BASE_RULES = { size: 'free', sizeValue: 50, mixed: true, mosaic: true, minHuman: 0 };
  function fullRules(r) { var o = {}, k; for (k in BASE_RULES) o[k] = BASE_RULES[k]; for (k in r) o[k] = r[k]; return o; }
  function sameRules(a, b) { return a.size === b.size && (a.size === 'fixed' || a.size === 'cap' ? Math.round(a.sizeValue) === Math.round(b.sizeValue) : true) && a.mixed === b.mixed && a.mosaic === b.mosaic && Math.abs(a.minHuman - b.minHuman) < 1e-9; }
  var league = { key: '', rows: [], timer: 0 };
  function leagueKey() { return JSON.stringify(A.toParams(A.state(), { rules: BASE_RULES })); }
  function runLeague() {
    var key = leagueKey(); if (league.key === key && league.rows.length === LEAGUE.length) { renderLeague(); return; }
    league.key = key; league.rows = []; clearTimeout(league.timer);
    var i = 0, st = A.state();
    (function next() {
      if (league.key !== key || i >= LEAGUE.length) return;
      var L = LEAGUE[i++], res;
      try { res = OI.solve(A.toParams(st, { rules: fullRules(L.rules) }), { fast: true }); } catch (e) { res = null; }
      if (res) league.rows.push({ L: L, m: A.metrics(res, st) });
      renderLeague();
      league.timer = setTimeout(next, 0);
    })();
  }
  function renderLeague() {
    var body = $('card-league-body'); if (!body) return;
    var fe = doc.activeElement, keep = fe && body.contains(fe) ? fe.getAttribute('data-id') : null;   // the table is rebuilt: keep the keyboard focus on its row
    body.textContent = '';
    var st = A.state(), free = null;
    league.rows.forEach(function (r) { if (r.L.id === 'free') free = r; });
    // nothing can beat the free equilibrium; ties keep the listed order
    var rows = league.rows.slice().sort(function (a, b) {
      var wa = free ? Math.min(a.m.W, free.m.W) : a.m.W, wb = free ? Math.min(b.m.W, free.m.W) : b.m.W;
      if (Math.abs(wa - wb) > 5e-4 * Math.max(Math.abs(wa), Math.abs(wb), 1e-9)) return wb - wa;
      return LEAGUE.indexOf(a.L) - LEAGUE.indexOf(b.L);
    });
    var max = 0; rows.forEach(function (r) { if (r.m.W > max) max = r.m.W; });
    var tb = el('tbody');
    rows.forEach(function (r) {
      var cur = sameRules(fullRules(r.L.rules), st.rules);
      var pick = el('button', { class: 'rowbtn', 'data-id': r.L.id, 'aria-pressed': String(cur), title: cur ? 'This structure is in use' : 'Apply this structure', text: r.L.name + (cur ? ' (in use)' : '') });
      var tr = el('tr', { class: 'click' + (cur ? ' hl' : '') }, [
        el('td', null, [pick, el('div', { class: 'lbar ' + (cur ? 'cur' : 'oth'), style: 'width:' + (max > 0 ? Math.max(0, 100 * r.m.W / max) : 0).toFixed(1) + '%' })]),
        el('td', { text: F.compact(r.m.W) }), el('td', { text: r.m.H ? F.pct(r.m.emp / r.m.H) : '–' }), el('td', { text: r.m.H ? F.money(r.m.wage) : '–' })
      ]);
      function go() { A.stopPlay(); st.rules = fullRules(r.L.rules); st.viewA = false; A.syncAll(); A.requestSolve(false); }
      tr.addEventListener('click', go);
      tb.appendChild(tr);
    });
    body.appendChild(el('p', { class: 'sub', text: 'The same people, AI and market under each organisation rule, ranked by total surplus. Select a row to apply it.' }));
    body.appendChild(el('div', { class: 'tscroll' }, el('table', { class: 't' }, [el('thead', null, el('tr', null, [el('th', { text: 'Structure' }), el('th', { text: 'Surplus' }), el('th', { text: 'In firms' }), el('th', { text: 'Wage' })])), tb])));
    if (league.rows.length < LEAGUE.length) body.appendChild(el('p', { class: 'sub cap', text: 'Working out ' + (LEAGUE.length - league.rows.length) + ' more…' }));
    if (keep) { var again = body.querySelector('[data-id="' + keep + '"]'); if (again) again.focus(); }
  }

  // ───────────────────────── compare with the pin ─────────────────────────
  function renderCompare() {
    var c = $('card-compare'), pin = A.pin(), res = A.result(); if (!c) return;
    if (pin && c.hidden) c.open = true;   // pinning asks for the comparison, so its group opens with it
    c.hidden = !pin; if (!pin || !res) return;
    var body = $('card-compare-body'), st = A.state(); body.textContent = '';
    var a = A.metrics(pin.res, pin.st), b = A.metrics(res, st), tb = el('tbody');
    function row(name, va, vb, fmt, better) {
      var d = A.delta(vb, va, better);
      tb.appendChild(el('tr', null, [el('td', { text: name }), el('td', { text: fmt(va) }), el('td', { text: fmt(vb) }), el('td', null, d ? [d.textContent.replace(' vs A', '').replace('same as A', '=')].map(function (t) { return el('span', { class: d.className, text: t }); }) : '')]));
    }
    row('Output', a.Q, b.Q, F.compact, true); row('Price', a.P, b.P, F.price, null); row('Total surplus', a.W, b.W, F.compact, true);
    row('Buyers’ surplus', a.CS, b.CS, F.compact, true); row('People’s premium', a.rents, b.rents, F.compact, true);
    row('People in firms', a.emp, b.emp, F.whole, true); row('Mean wage', a.wage, b.wage, F.money, true);
    st.roles.forEach(function (r, i) { var wa = pin.st.roles[i] && pin.st.roles[i].name === r.name ? pin.res.wages[i] : null; if (wa != null) row(r.name + ' wage', wa, res.wages[i], F.money, true); });
    row('AI in use', a.ai, b.ai, F.whole, null); row('Firms', a.firms, b.firms, function (v) { return F.compact(Math.round(v)); }, null);
    row('Largest firm', a.largest, b.largest, F.size, null); row('Concentration', a.hhi, b.hhi, function (v) { return F.grp(v, 3); }, null);
    body.appendChild(el('div', { class: 'tscroll' }, el('table', { class: 't' }, [el('thead', null, el('tr', null, [el('th', { text: 'Measure' }), el('th', { text: 'A pinned' }), el('th', { text: 'Now' }), el('th', { text: 'Change' })])), tb])));
    body.appendChild(el('p', { class: 'sub cap', text: 'Use the switch on the stage to watch people and AI move between A and now.' }));
  }

  // ───────────────────────── strip-chart recorder ─────────────────────────
  var PATH = { key: '', n: 40, data: [], hover: null, timer: 0 }, stripDrag = false;
  function pathKey() { var st = A.state(); return JSON.stringify([A.toParams(st, { ai: { y1: 1, y2: 1, ys: 1 } }), st.path]); }
  function summary(res, st) {
    var m = A.metrics(res, st);
    return { Q: m.Q, P: m.P, W: m.W, emp: res.employed.slice(), empT: m.emp, H: m.H, wages: res.wages.slice(), wage: m.wage, largest: m.largest, hhi: m.hhi, ai: m.ai, cap: m.cap, firms: m.firms };
  }
  function runPath() {
    var key = pathKey(); if (PATH.key === key) return;
    PATH.key = key; PATH.data = []; clearTimeout(PATH.timer);
    var st = A.state(), n = PATH.n, order = [], i;
    // coarse to fine, so the curves appear at once and then sharpen
    [8, 4, 2, 1].forEach(function (step) { for (i = 0; i <= n; i += step) if (order.indexOf(i) < 0) order.push(i); });
    var q = 0;
    (function next() {
      if (PATH.key !== key) return;
      var t0 = Date.now();
      while (q < order.length && Date.now() - t0 < 24) {
        var k = order[q++];
        try { PATH.data[k] = summary(OI.solve(A.toParams(st, { ai: A.lerpPath(st.path, k / n) })), st); } catch (e) { PATH.data[k] = null; }
      }
      renderStrips();
      if (q < order.length) PATH.timer = setTimeout(next, 0);
    })();
  }
  var STRIPS = [
    { id: 'jobs', title: 'In firms', multi: 'emp', fmt: F.whole, head: function (d) { return F.whole(d.empT) + ' / ' + F.whole(d.H); } },
    { id: 'wages', title: 'Wages', multi: 'wages', fmt: F.money, head: function (d) { return d.H ? 'mean ' + F.money(d.wage) : 'no people'; }, ref: function (st) { return [{ v: st.wOut, t: 'outside option' }]; } },
    { id: 'ai', title: 'AI in use', key: 'ai', color: 'var(--c-ai)', edge: 'var(--c-ai-edge)', fmt: F.whole, head: function (d) { return F.whole(d.ai); }, ref: function (st) { return st.aiCap ? [{ v: st.aiCap, t: 'fleet' }] : []; } },
    { id: 'largest', title: 'Largest firm', key: 'largest', log: true, fmt: F.size, head: function (d) { return F.size(d.largest); } },
    { id: 'hhi', title: 'Concentration', key: 'hhi', fixed: [0, 1], fmt: function (v) { return F.grp(v, 2); }, head: function (d) { return F.grp(d.hhi, d.hhi < 0.1 ? 3 : 2); } },
    { id: 'price', title: 'Price', key: 'P', fmt: F.price, head: function (d) { return F.price(d.P); } },
    { id: 'output', title: 'Output', key: 'Q', fmt: F.compact, head: function (d) { return F.compact(d.Q); } },
    { id: 'surplus', title: 'Surplus', key: 'W', fmt: F.compact, head: function (d) { return F.compact(d.W); } }
  ];
  function buildStrips() {
    var box = $('strips'); box.textContent = '';
    // the first four charts always show; the second row folds away behind one toggle, remembered per browser
    var rows = [el('div', { class: 'strip-row' }), el('div', { class: 'strip-row', id: 'stripsMore' })], more = false;
    try { more = root.localStorage.getItem('hive-more-charts') === '1'; } catch (e) { /* storage is optional */ }
    var tog = el('button', { class: 'strip-more', type: 'button', 'aria-expanded': String(more), 'aria-controls': 'stripsMore' }, [
      el('i', { class: 'tw', 'aria-hidden': 'true' }), el('span', { class: 'gname', text: 'More charts' }),
      el('span', { class: 'gsum', text: STRIPS.slice(4).map(function (sp) { return sp.title; }).join(', ') })
    ]);
    rows[1].hidden = !more;
    tog.addEventListener('click', function () {
      more = !more; rows[1].hidden = !more; tog.setAttribute('aria-expanded', String(more));
      try { root.localStorage.setItem('hive-more-charts', more ? '1' : '0'); } catch (e) { /* storage is optional */ }
      if (more) renderStrips();
    });
    box.appendChild(rows[0]); box.appendChild(tog); box.appendChild(rows[1]);
    STRIPS.forEach(function (sp, k) {
      sp.head_el = el('span', { class: 'strip-val' }); sp.svg = sv('svg', { role: 'img', 'aria-label': sp.title + ' along the AI progress path' }); sp.keys = el('div', { class: 'keys' });
      rows[k < 4 ? 0 : 1].appendChild(el('div', { class: 'strip' }, [el('div', { class: 'strip-head' }, [el('h3', { text: sp.title }), sp.head_el]), sp.svg, sp.keys]));
      function frac(e) { var r = sp.svg.getBoundingClientRect(); return clamp((e.clientX - r.left - 4) / Math.max(1, r.width - 10), 0, 1); }
      sp.svg.addEventListener('pointerdown', function (e) { A.stopPlay(); stripDrag = true; try { sp.svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ } A.setT(frac(e)); });
      sp.svg.addEventListener('pointermove', function (e) { var f = frac(e); PATH.hover = Math.round(f * PATH.n); if (stripDrag) A.setT(f); else renderStrips(); });
      function up() { stripDrag = false; }
      sp.svg.addEventListener('pointerup', up); sp.svg.addEventListener('pointercancel', up);
      sp.svg.addEventListener('pointerleave', function () { if (!stripDrag) { PATH.hover = null; renderStrips(); } });
    });
  }
  function renderStrips() {
    var st = A.state(); if (!st || !STRIPS[0].svg) return;
    if ($('app').getAttribute('data-dock') === 'closed') return;
    var n = PATH.n, D = PATH.data, cur = clamp(Math.round(st.t * n), 0, n), at = PATH.hover != null ? PATH.hover : cur;
    STRIPS.forEach(function (sp) {
      var svg = sp.svg, W = Math.max(120, svg.clientWidth || 160), H = svg.clientHeight || 92, ml = 4, mr = 6, mt = 14, mb = 5;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.textContent = '';
      var series = sp.multi ? st.roles.map(function (r, i) { return { name: r.name, color: A.roleVar(r), get: function (d) { return d[sp.multi][i]; } }; })
        : [{ name: sp.title, color: sp.color || 'var(--ink)', edge: sp.edge, get: function (d) { return d[sp.key]; } }];
      var refs = sp.ref ? sp.ref(st) : [], lo = Infinity, hi = -Infinity, i, s;
      for (i = 0; i <= n; i++) if (D[i]) series.forEach(function (se) { var v = se.get(D[i]); if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      refs.forEach(function (r) { if (r.v > hi) hi = r.v; if (r.v < lo) lo = r.v; });
      if (lo === Infinity) { lo = 0; hi = 1; }
      if (sp.fixed) { lo = sp.fixed[0]; hi = sp.fixed[1]; }
      else if (sp.log) { lo = Math.max(0.5, lo * 0.8); hi = Math.max(lo * 2, hi * 1.25); }
      else { lo = 0; hi = hi > 0 ? hi * 1.1 : 1; }
      function X(k) { return ml + (W - ml - mr) * k / n; }
      function Y(v) { var f = sp.log ? (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo); return H - mb - (H - mt - mb) * clamp(f, 0, 1); }
      svg.appendChild(sv('line', { x1: ml, y1: H - mb, x2: W - mr, y2: H - mb, stroke: 'var(--hair-2)' }));
      svg.appendChild(sv('line', { x1: ml, y1: mt, x2: W - mr, y2: mt, stroke: 'var(--hair)' }));
      // labels go on after the lines, so their halo keeps every line from running through them
      var tx = [sv('text', { x: ml, y: mt - 3, text: sp.fmt(hi) })], keyRefs = [];
      if (sp.log) {   // the floor label goes to whichever end the line has left
        var v0 = null, v1 = null;
        for (i = 0; i <= n; i++) if (D[i]) { var vv = series[0].get(D[i]); if (vv != null && isFinite(vv)) { if (v0 == null) v0 = vv; v1 = vv; } }
        var atR = v1 != null && v1 > v0;
        tx.push(sv('text', { x: atR ? W - mr : ml + 8, y: H - mb - 3, 'text-anchor': atR ? 'end' : 'start', text: sp.fmt(lo) }));
      }
      refs.forEach(function (r) {
        svg.appendChild(sv('line', { x1: ml, y1: Y(r.v), x2: W - mr, y2: Y(r.v), stroke: 'var(--ink-3)' }));
        // a reference label sits at whichever end leaves the most room between it and the lines
        var span = Math.ceil(n * (r.t.length * 5.6 + 10) / Math.max(1, W - ml - mr));
        var gap = function (k0, k1) { var g2 = Infinity; for (var k = Math.max(0, k0); k <= Math.min(n, k1); k++) if (D[k]) series.forEach(function (se) { var vv = se.get(D[k]); if (vv != null && isFinite(vv)) g2 = Math.min(g2, Math.abs(Y(vv) - Y(r.v))); }); return g2; };
        var gL = gap(0, span), gR = gap(n - span, n), refL = gL > gR + 2;
        if (Math.max(gL, gR) < 13) { keyRefs.push(r); return; }   // no room above the line at either end: the label moves to the key below
        tx.push(sv('text', { x: refL ? ml + 8 : W - mr, y: Y(r.v) - 3, 'text-anchor': refL ? 'start' : 'end', class: 'tag', text: r.t }));
      });
      series.forEach(function (se) {
        var d = '', pen = false;
        for (i = 0; i <= n; i++) { if (!D[i]) continue; var v = se.get(D[i]); if (v == null || !isFinite(v)) { pen = false; continue; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }
        if (d && se.edge) svg.appendChild(sv('path', { d: d, fill: 'none', stroke: se.edge, 'stroke-width': 4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));   // a lime line keeps an olive edge on light grounds
        if (d) svg.appendChild(sv('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      });
      if (PATH.hover != null && PATH.hover !== cur) svg.appendChild(sv('line', { x1: X(PATH.hover), y1: mt, x2: X(PATH.hover), y2: H - mb, stroke: 'var(--ink-3)' }));
      var on = st.onPath !== false || PATH.hover != null;
      if (st.onPath !== false) svg.appendChild(sv('line', { x1: X(st.t * n), y1: mt - 4, x2: X(st.t * n), y2: H - mb, stroke: 'var(--ink)', 'stroke-width': 1 }));
      tx.forEach(function (t) { svg.appendChild(t); });
      if (D[at] && on) series.forEach(function (se) { var v = se.get(D[at]); if (v != null && isFinite(v)) svg.appendChild(sv('circle', { cx: X(at), cy: Y(v), r: 3.5, fill: se.color, stroke: se.edge || 'var(--surface)', 'stroke-width': 2 })); });
      sp.head_el.textContent = !on ? '' : (D[at] ? sp.head(D[at]) : '…');
      sp.keys.textContent = '';
      if (sp.multi) series.forEach(function (se) { sp.keys.appendChild(el('span', null, [el('i', { style: 'background:' + se.color }), se.name + (D[at] && on ? ' ' + sp.fmt(se.get(D[at])) : '')])); });
      keyRefs.forEach(function (r) { sp.keys.appendChild(el('span', null, [el('i', { style: 'background:var(--ink-3);height:1px' }), r.t + ' ' + sp.fmt(r.v)])); });
    });
  }
  A.renderStrips = renderStrips;

  function pathSummary() {
    var p = A.state().path, parts = [];
    function ch(a, b) { return Math.abs(a - b) > 1e-9; }
    if (ch(p.from.y1, p.to.y1) || ch(p.from.y2, p.to.y2)) {
      if (!ch(p.from.y1, p.from.y2) && !ch(p.to.y1, p.to.y2)) parts.push('task skills ' + F.grp(p.from.y1, 2) + ' → ' + F.grp(p.to.y1, 2));
      else { if (ch(p.from.y1, p.to.y1)) parts.push('skill 1 ' + F.grp(p.from.y1, 2) + ' → ' + F.grp(p.to.y1, 2)); if (ch(p.from.y2, p.to.y2)) parts.push('skill 2 ' + F.grp(p.from.y2, 2) + ' → ' + F.grp(p.to.y2, 2)); }
    }
    if (ch(p.from.ys, p.to.ys)) parts.push('coordination ' + F.grp(p.from.ys, 2) + ' → ' + F.grp(p.to.ys, 2));
    var ps = $('pathsum'); ps.textContent = parts.length ? 'AI ' + parts.join(', ') : 'Start and end are the same: edit the path';
    ps.title = ps.textContent;   // the bar may cut the summary short; the whole of it is a hover away
  }
  function buildPathEdit() {
    var box = $('pathEdit'), st = A.state(); box.textContent = '';
    [['y1', 'Task skill 1', 0.2, 15], ['y2', 'Task skill 2', 0.2, 15], ['ys', 'Coordination', 0, 1.6]].forEach(function (f) {
      function inp(side) {
        // a text field with a decimal keypad, like the other value fields: a number field would show 1.685 as "1,685" in many locales
        var i = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id: 'pe-' + f[0] + '-' + side, value: +st.path[side][f[0]].toFixed(4), 'aria-label': f[1] + (side === 'from' ? ' at the start' : ' at the end') + ', from ' + f[2] + ' to ' + f[3] });
        i.addEventListener('change', function () { var v = parseFloat(String(i.value).replace(/\s/g, '').replace(',', '.')); if (isNaN(v)) v = st.path[side][f[0]]; st.path[side][f[0]] = clamp(v, f[2], f[3]); i.value = +st.path[side][f[0]].toFixed(4); pathChanged(); });
        return i;
      }
      box.appendChild(el('div', { class: 'pe' }, [el('span', { text: f[1] }), inp('from'), el('span', { text: '→' }), inp('to')]));
    });
    function use(side) { return function () { st.path[side] = { y1: st.ai.y1, y2: st.ai.y2, ys: st.ai.ys }; buildPathEdit(); pathChanged(); }; }
    box.appendChild(el('div', { class: 'pe-actions' }, [
      el('button', { class: 'linkbtn', text: 'Start from the current AI', onclick: use('from') }),
      el('button', { class: 'linkbtn', text: 'End at the current AI', onclick: use('to') }),
      el('button', { class: 'linkbtn', text: 'Swap start and end', onclick: function () { var a = st.path.from; st.path.from = st.path.to; st.path.to = a; buildPathEdit(); pathChanged(); } })
    ]));
  }
  function pathChanged() { pathSummary(); runPath(); renderStrips(); }

  // ───────────────────────── wiring ─────────────────────────
  // Background work waits for a pause in the input, but work already waiting for the same
  // inputs is not pushed back again, so the charts still arrive while AI progress is playing.
  var pathWait = { key: null, timer: 0 }, leagueWait = { key: null, timer: 0 };
  function later(wait, key, done, run) {
    if (key === done || key === wait.key) return;
    clearTimeout(wait.timer); wait.key = key;
    wait.timer = setTimeout(function () { wait.key = null; run(); }, 300);
  }
  A.renderPanels = function () {
    renderMap(); renderFirms(); renderScale(); renderWages(); renderCompare(); renderLeague();
    later(pathWait, pathKey(), PATH.key, runPath);
    later(leagueWait, leagueKey(), league.key, runLeague);
  };
  A.onSettled = function () { /* secondary work is already scheduled by renderPanels */ };
  A.onScene = function () { hlRecipe = -1; openRecipes = {}; PATH.hover = null; buildPathEdit(); pathSummary(); };
  A.onResize = function () {
    var res = A.result(), st = A.state();
    if (res && st && res.P.roles.length !== st.roles.length) return;   // a role was just added or removed: the next result redraws everything
    renderStrips(); renderMap(); renderScale();
  };
  A.initPanels = function () {
    var rail = $('rail');
    rail.appendChild(el('div', { class: 'rack-head' }, [el('span', { class: 'lbl', text: 'Readouts' })]));
    rail.appendChild(buildMap());
    rail.appendChild(card('card-firms', 'Firm types').el);
    rail.appendChild(card('card-wages', 'Wages by role').el);
    rail.appendChild(card('card-scale', 'Why firms are that size').el);
    var cmp = card('card-compare', 'A pinned against now'); cmp.el.hidden = true; rail.appendChild(cmp.el);
    rail.appendChild(card('card-league', 'Structure league').el);
    buildStrips(); buildPathEdit(); pathSummary();
    $('pathBtn').addEventListener('click', function () { var pe = $('pathEdit'); pe.hidden = !pe.hidden; this.setAttribute('aria-expanded', String(!pe.hidden)); });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
