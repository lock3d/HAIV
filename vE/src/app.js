/* Sandbox application: state, controls, solving, stage glue and headline numbers. */
(function (root) {
  'use strict';
  var OI = root.OI, SCENES = root.OI_SCENES, WorldNS = root.OIWorld, doc = document;
  var A = root.OIApp = {};                       // shared with panels.js

  // ───────────────────────── small helpers ─────────────────────────
  function $(id) { return doc.getElementById(id); }
  function make(ns, tag, attrs, kids) {
    var e = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.setAttribute('class', v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
    });
    return e;
  }
  function el(tag, attrs, kids) { return make(null, tag, attrs, kids); }
  function sv(tag, attrs, kids) { return make('http://www.w3.org/2000/svg', tag, attrs, kids); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function grp(v, d) { return Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
  function compact(v) {
    var a = Math.abs(v);
    if (!isFinite(v)) return '∞';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    if (a >= 100) return grp(v, 0);
    if (a >= 10) return grp(v, 1);
    return grp(v, 2);
  }
  function money(v) { var a = Math.abs(v); return a >= 100 ? grp(v, 0) : a >= 10 ? grp(v, 1) : a >= 0.1 ? grp(v, 2) : a >= 0.01 || !(a > 0) ? grp(v, 3) : tiny(v); }
  // a small price is still a price: below a thousandth it keeps two significant digits instead of rounding to zero
  function tiny(v) { return v.toFixed(Math.min(12, 1 - Math.floor(Math.log10(Math.abs(v))))); }
  function price(v) { var a = Math.abs(v); return a >= 10 ? grp(v, 1) : a >= 1 ? grp(v, 2) : a >= 0.1 ? grp(v, 3) : a >= 0.001 || !(a > 0) ? grp(v, 4) : tiny(v); }
  function size(m) { return !isFinite(m) ? '∞' : m >= 100 ? grp(m, 0) : m >= 10 ? grp(m, 1) : grp(m, 1); }
  function pct(v) {
    var p = v * 100, t = (p > 0 && p < 1) || (p > 99 && p < 100) ? p.toFixed(1) : p.toFixed(0);
    if (t === '100.0') t = '100'; if (t === '0.0') t = p > 0 ? '<0.1' : '0';
    return t + '%';
  }
  function whole(v) { return grp(Math.round(v), 0); }
  A.fmt = { compact: compact, money: money, price: price, size: size, pct: pct, whole: whole, grp: grp };
  A.el = el; A.sv = sv; A.$ = $; A.clamp = clamp;

  // ───────────────────────── state ─────────────────────────
  var COLOR_SLOTS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];   // colour slots, in the order new roles take them
  var BASE = {
    jag: 1, sigma: 0, seed: 7, constReturns: false, lockAI: true,
    rules: { size: 'free', sizeValue: 50, mixed: true, mosaic: true, minHuman: 0 },
    trust: { on: false, level: 0.3 },            // an extension: off is the paper's model
    inter: { on: false, goods: 0.5, services: 0.6, ip: 0.5 },   // an extension: links between firms
    view: { labels: true, speed: 1 }
  };
  var ST = null;                                 // the live scenario
  A.state = function () { return ST; };

  function headcounts(st) {
    var tot = 0, i; st.roles.forEach(function (r) { tot += Math.max(0, r.share); });
    if (!(tot > 0)) return st.roles.map(function () { return 0; });
    var raw = st.roles.map(function (r) { return st.humans * Math.max(0, r.share) / tot; });
    var out = raw.map(Math.floor), left = st.humans - out.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (v, k) { return [v - out[k], k]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; })
      .slice(0, left).forEach(function (p) { out[p[1]]++; });
    return out;
  }
  // jaggedness scales how far a role's two skills sit from their own average
  function effRole(st, r) {
    var mu = (r.y1 + r.y2) / 2;
    return { y1: Math.max(0.05, mu + st.jag * (r.y1 - mu)), y2: Math.max(0.05, mu + st.jag * (r.y2 - mu)), ys: r.ys };
  }
  function toParams(st, o) {
    o = o || {};
    var n = headcounts(st), ai = o.ai || st.ai, markets = [{ P0: st.mk.P0, S: st.mk.S, name: st.niche.on ? 'Deep market' : 'Market' }];
    if (st.niche.on) markets.push({ P0: st.niche.P0, S: st.niche.S, name: 'Niche market' });
    return {
      roles: st.roles.map(function (r, i) { var e = effRole(st, r); return { name: r.name, n: n[i], y1: e.y1, y2: e.y2, ys: e.ys, lead: !!r.lead, demoteYs: r.demoteYs == null ? 0.97 : r.demoteYs }; }),
      ai: { cap: st.aiCap, y1: ai.y1, y2: ai.y2, ys: ai.ys }, w: st.wOut, r: st.r, rho: st.rho, phi: st.phi,
      constReturns: st.constReturns, markets: markets, rules: o.rules || st.rules,
      trust: st.trust && st.trust.on ? { on: true, level: st.trust.level } : null,
      inter: st.inter && st.inter.on ? { on: true, goods: st.inter.goods, services: st.inter.services, ip: st.inter.ip } : null
    };
  }
  // where trust stands against what the AI warrants; `t` is null when there is nobody, or no AI, to trust
  function trustInfo(st, ai) {
    var P = toParams(st, ai ? { ai: ai } : null); P.trust = { on: true, level: st.trust ? st.trust.level : 0.5 };
    return { on: !!(st.trust && st.trust.on), t: OI.normalize(P).trust };
  }
  A.headcounts = headcounts; A.effRole = effRole; A.toParams = toParams; A.trustInfo = trustInfo;

  function lerpPath(p, t) {
    return { y1: p.from.y1 + (p.to.y1 - p.from.y1) * t, y2: p.from.y2 + (p.to.y2 - p.from.y2) * t, ys: p.from.ys + (p.to.ys - p.from.ys) * t };
  }
  function defaultPath(st) {
    return {
      from: { y1: st.ai.y1, y2: st.ai.y2, ys: st.ai.ys },
      to: { y1: Math.min(15, +(st.ai.y1 * 1.6 + 0.5).toFixed(2)), y2: Math.min(15, +(st.ai.y2 * 1.6 + 0.5).toFixed(2)), ys: Math.min(1.6, +Math.max(st.ai.ys + 0.25, 1.06).toFixed(2)) }
    };
  }
  function matchT(st) {                          // where the current AI sits on the path, if it sits on it
    var p = st.path, best = null;
    ['y1', 'y2', 'ys'].forEach(function (k) { var d = p.to[k] - p.from[k]; if (Math.abs(d) > 1e-9 && best == null) best = (st.ai[k] - p.from[k]) / d; });
    if (best == null) return null;
    best = clamp(best, 0, 1);
    var a = lerpPath(p, best);
    return Math.abs(a.y1 - st.ai.y1) + Math.abs(a.y2 - st.ai.y2) + Math.abs(a.ys - st.ai.ys) < 1e-6 ? best : null;
  }
  A.lerpPath = lerpPath;

  function loadScene(id) {
    var sc = SCENES.filter(function (s) { return s.id === id; })[0] || SCENES[0];
    var view = ST ? ST.view : null;
    ST = clone(BASE); var p = clone(sc.params), k;
    for (k in p) ST[k] = p[k];
    if (view) ST.view = view;
    ST.sceneId = sc.id;
    ST.lockAI = Math.abs(ST.ai.y1 - ST.ai.y2) < 1e-9;
    ST.path = sc.path ? clone(sc.path) : defaultPath(ST);
    var t = matchT(ST); ST.t = t == null ? 0 : t;
    ST.viewA = false; ST.noteOpen = true;
  }

  // ───────────────────────── individuals (extension) ─────────────────────────
  function h32(a, b, c, d) {
    var x = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
    x = (x ^ (x >>> 13)) * 1274126177 | 0; x = (x ^ (x >>> 16)) * 2246822519 | 0;
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  }
  function gauss(seed, r, k, d) {
    var u = Math.max(1e-9, h32(seed, r, k, d * 2 + 1)), v = h32(seed, r, k, d * 2 + 2);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  var indCache = { key: '', data: null };
  function individuals(st) {
    var n = headcounts(st), key = JSON.stringify([st.seed, st.sigma, st.jag, n, st.roles.map(function (r) { return [r.y1, r.y2, r.ys]; })]);
    if (indCache.key === key) return indCache.data;
    var data = st.roles.map(function (r, ri) {
      var e = effRole(st, r), N = n[ri], d1 = new Float32Array(N), d2 = new Float32Array(N), d3 = new Float32Array(N), s = st.sigma, m1 = 0, m2 = 0, m3 = 0, k;
      for (k = 0; k < N; k++) {
        d1[k] = e.y1 * (Math.exp(s * gauss(st.seed, ri, k, 0)) - 1); d2[k] = e.y2 * (Math.exp(s * gauss(st.seed, ri, k, 1)) - 1); d3[k] = 0.25 * s * gauss(st.seed, ri, k, 2);
        m1 += d1[k]; m2 += d2[k]; m3 += d3[k];
      }
      for (k = 0; k < N; k++) { d1[k] -= m1 / N; d2[k] -= m2 / N; d3[k] -= m3 / N; }   // the role's mean stays exactly as set
      return { d1: d1, d2: d2, d3: d3 };
    });
    indCache = { key: key, data: data };
    return data;
  }
  // who is seated first: people ranked by what their employer would bid for them (paper, Theorem 2)
  function ranking(st, res) {
    if (!(st.sigma > 0)) return null;
    var ind = individuals(st), P = res.P;
    return st.roles.map(function (r, ri) {
      var best = null, bx = 0;
      res.recipes.forEach(function (rc) { var x = rc.x * rc.sRole[ri]; if (x > bx) { bx = x; best = rc; } });
      var b = best ? OI.capPrices(P, best) : { y1: 0.5, y2: 0.5, ys: 0 };
      var d = ind[ri], N = d.d1.length, score = new Float32Array(N), idx = new Array(N), k;
      for (k = 0; k < N; k++) { score[k] = b.y1 * d.d1[k] + b.y2 * d.d2[k] + b.ys * d.d3[k]; idx[k] = k; }
      idx.sort(function (u, v) { return score[v] - score[u] || u - v; });
      return { order: idx, score: score };
    });
  }
  A.ranking = ranking;

  // ───────────────────────── solving ─────────────────────────
  var R = null, REAL = null, RANK = null, PIN = null, pendingSolve = false, wantFast = false, idleTimer = 0, solveSeq = 0;
  A.result = function () { return R; }; A.real = function () { return REAL; }; A.pin = function () { return PIN; }; A.rank = function () { return RANK; };

  var lastFullMs = 0, failing = false, liveTimer = 0;
  // an upstream failure must never leave silently stale numbers: say so, and offer the way back
  function solveFailed() {
    failing = true; clearTimeout(idleTimer);
    var box = $('solveAlert'); box.textContent = '';
    box.appendChild(el('div', null, [
      el('p', null, [el('strong', { text: 'These settings could not be solved. ' }), 'The stage and the numbers still show the last settings that worked.']),
      el('button', { class: 'btn', text: 'Reset scene', onclick: function () { selectScene(ST.sceneId); } })
    ]));
    box.hidden = false; $('kpis').classList.add('stale'); $('stage').classList.add('has-alert');
  }
  function solveOk() { if (!failing) return; failing = false; $('solveAlert').hidden = true; $('kpis').classList.remove('stale'); $('stage').classList.remove('has-alert'); }
  // screen readers hear the new result once the controls have come to rest
  function announceResult() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (!R) return;
      var m = metrics(R, ST);
      $('live').textContent = R.empty ? emptyInfo(R).t + '. ' + emptyInfo(R).p
        : 'Output ' + compact(m.Q) + ' at price ' + price(m.P) + '. ' + whole(m.emp) + ' of ' + whole(m.H) + ' people in firms, mean wage ' + money(m.wage) + '. '
          + whole(m.ai) + ' AI copies in use. ' + whole(m.firms) + ' firms, the largest with ' + size(m.largest) + ' agents.'
          + (R.P.trust ? ' Trust ' + grp(R.P.trust.level, 2) + ', warranted ' + grp(R.P.trust.warranted, 2) + '.' : '')
          + (R.P.inter ? ' ' + interText(ST, R, REAL) : '');
    }, 700);
  }
  function runSolve(fast) {
    var P = toParams(ST), res;
    if (fast && lastFullMs < 48) fast = false;       // a full solve is quick enough to run while dragging
    try { res = OI.solve(P, { fast: fast }); } catch (err) { if (root.console) console.error(err); solveFailed(); return; }
    solveOk();
    if (!fast) lastFullMs = res.ms;
    R = res; REAL = OI.realize(R); RANK = ranking(ST, R); solveSeq++;
    afterSolve();
    clearTimeout(idleTimer);
    if (fast) idleTimer = setTimeout(function () { runSolve(false); }, 240);
    else { announceResult(); if (A.onSettled) A.onSettled(); }
  }
  function requestSolve(fast) {
    wantFast = !!fast;
    if (pendingSolve) return;
    pendingSolve = true;
    root.requestAnimationFrame(function () { pendingSolve = false; runSolve(wantFast); });
  }
  A.requestSolve = requestSolve;

  // ───────────────────────── colours and theme ─────────────────────────
  function cssVar(n, at) { return getComputedStyle(at || doc.documentElement).getPropertyValue(n).trim(); }
  function roleVar(r) { return 'var(--c-' + r.color + ')'; }
  A.roleVar = roleVar;
  function worldColors(st) {
    var g = $('stage'), v = function (n) { return cssVar(n, g); };   // the stage is the glass: its own tokens
    return {
      types: st.roles.map(function (r) { return v('--c-' + r.color); }).concat([v('--c-ai')]),
      aiEdge: v('--c-ai-edge'),
      co: st.roles.some(function (r) { return r.lead && r.color === 'r3'; }) ? v('--ink') : v('--c-r3'),   // former leaders take the coordinators' colour
      veil: v('--veil'), ring: v('--line'), hair2: v('--hair-2'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
      surface: v('--surface'), page: v('--page'), fontUI: v('--font-ui'), fontLabel: v('--font-ui'), fontRead: v('--font-read')
    };
  }
  var THEMES = ['auto', 'light', 'dark'], theme = 'auto';
  function applyTheme(t) {
    theme = t;
    if (t === 'auto') doc.documentElement.removeAttribute('data-theme'); else doc.documentElement.setAttribute('data-theme', t);
    $('themeBtn').title = 'Theme: ' + t;
    try { root.localStorage.setItem('oi-theme', t); } catch (e) { /* storage is optional */ }
    if (world && ST) { world.setColors(worldColors(shown().st)); }
  }

  // one sentence on what trust is doing in this scenario
  function trustText(i) {
    if (!i.on) return 'Off: the paper’s model, where people and AI work together without friction.';
    if (!i.t) return 'Trust needs both people and an AI fleet. With one of them missing it changes nothing.';
    var g = i.t.gap, q = grp(i.t.warranted, 2);
    if (Math.abs(g) < 0.005) return 'People trust the AI as much as its competence warrants (' + q + '), so the result is the paper’s.';
    if (g < 0) return 'The AI’s competence warrants ' + q + '; people trust it ' + grp(-g, 2) + ' less. Mixed teams coordinate more slowly, and people insist on being at least ' + pct(i.t.oversight) + ' of every firm.';
    return 'The AI’s competence warrants ' + q + '; people trust it ' + grp(g, 2) + ' more. Mixed teams coordinate faster, but unchecked errors cost them competence.';
  }
  A.trustText = trustText;
  // one or two sentences on what links between firms are doing in this result
  function interText(st, res, real) {
    if (!st.inter || !st.inter.on) return 'Off: the paper’s model, where firms do not work together.';
    if (st.constReturns) return 'With constant returns scale does not matter, between firms either: links change nothing.';
    if (st.rules.size === 'single') return 'One organisation has no partners: links change nothing.';
    if (!res || res.empty) return 'No firm operates, so there is nothing to link.';
    var best = null, top = null, names = real ? recipeNames(st, res, real) : null;
    res.recipes.forEach(function (rc, ri) {
      if (!rc.ic || !(rc.ic.n > 0.005)) return;
      if (!best || rc.ic.H > best.rc.ic.H) best = { rc: rc, ri: ri };
      if (!top || rc.ic.n > top.rc.ic.n) top = { rc: rc, ri: ri };
    });
    if (!best) return 'No firm links yet: what linking would add does not cover its friction. Raise goods transfers or IP licensing, or let shared services carry more coordination.';
    function nm(o) { return names && names[o.ri] ? names[o.ri] : 'Firms'; }
    var cap = top.rc.ic.st === 2 ? ', as many as there are people for' : top.rc.ic.st === 3 ? ', as many as the market holds' : '';
    return nm(top) + ' link into networks of ' + size(1 + top.rc.ic.n) + ' firms' + cap + '. '
      + (best.ri === top.ri ? 'Linking adds ' : nm(best) + ' gain most: linking adds ') + pct(best.rc.ic.H - 1) + ' to their output per agent.';
  }
  A.interText = interText;

  // ───────────────────────── controls ─────────────────────────
  var syncers = [];
  function syncAll() { for (var i = 0; i < syncers.length; i++) syncers[i](); summaries(); }
  A.syncAll = syncAll;
  function changed(fast) { ST.viewA = false; syncAll(); if (ST.onPath !== (matchT(ST) != null)) syncScrub(); requestSolve(fast); }

  function slider(o) {
    var log = !!o.log, lmin = log ? Math.log(o.min) : 0, lmax = log ? Math.log(o.max) : 0;
    var range = el('input', log ? { type: 'range', id: o.id, min: 0, max: 1000, step: 1 } : { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step });
    var num = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'ctl-val', id: o.id + '-n', 'aria-label': o.label + ', exact value' });
    function show(v) { return o.show ? o.show(v) : String(+v.toFixed(o.dec == null ? 2 : o.dec)); }
    function pos(v) { return log ? 1000 * (Math.log(clamp(v, o.min, o.max)) - lmin) / (lmax - lmin) : v; }
    var mk = o.mark ? el('i', { class: 'mark', 'data-t': o.mark.t }) : null;
    function placeMark() {                       // a reference point on the track; it may move with the scenario
      var mv = o.mark.get ? o.mark.get() : o.mark.v;
      if (mv == null || isNaN(mv)) { mk.hidden = true; return; }
      var f = clamp((mv - o.min) / (o.max - o.min), 0, 1);
      mk.hidden = false; mk.style.left = 'calc(' + (100 * f) + '% + ' + (6 - 12 * f) + 'px)'; mk.classList.toggle('lo', f < 0.15); mk.classList.toggle('hi', f > 0.85);   // centred on its mark, unless that would run off the track
    }
    function sync() {
      var v = o.get(), p = pos(v);
      if (mk) placeMark();
      range.value = p; range.setAttribute('aria-valuetext', show(v) + (o.unit ? ' ' + o.unit : ''));
      range.style.setProperty('--p', (log ? p / 10 : 100 * (clamp(v, o.min, o.max) - o.min) / (o.max - o.min)) + '%');
      if (doc.activeElement !== num) num.value = show(v);
      var dis = o.disabled ? !!o.disabled() : false; range.disabled = dis; num.disabled = dis;
    }
    range.addEventListener('input', function () {
      var v = log ? Math.exp(lmin + (lmax - lmin) * range.value / 1000) : +range.value;
      if (log) { var mag = Math.pow(10, Math.floor(Math.log10(v)) - 2); v = Math.round(v / mag) * mag; }
      if (o.int) v = Math.round(v);
      o.set(clamp(v, o.min, o.max)); changed(true);
    });
    num.addEventListener('change', function () {
      var v = parseFloat(String(num.value).replace(/\s/g, '').replace(',', '.')); if (isNaN(v)) { sync(); return; }
      if (o.int) v = Math.round(v);
      o.set(clamp(v, o.min, o.max)); changed(false);
    });
    syncers.push(sync);
    var head = el('div', { class: 'ctl-head' }, [el('label', { for: o.id }, [o.label, o.sym ? el('span', { class: 'sym', text: o.sym }) : null, o.ext ? el('span', { class: 'tag-ext', text: 'added', title: 'An extension: not part of the paper' }) : null]), num]);
    var kids = [head, el('div', { class: 'ctl-track' + (o.mark ? ' has-mark' : '') }, [range, mk])];
    if (o.hint) kids.push(el('div', { class: 'ctl-hint', text: o.hint }));
    return el('div', { class: 'ctl' }, kids);
  }
  function check(o) {
    var box = el('input', { type: 'checkbox', id: o.id });
    box.addEventListener('change', function () { o.set(box.checked); changed(false); });
    syncers.push(function () { box.checked = !!o.get(); });
    return el('div', { class: 'ctl' }, [el('label', { class: 'check', for: o.id }, [box, el('span', null, [o.label, o.ext ? el('span', { class: 'tag-ext', text: 'added', title: 'An extension: not part of the paper' }) : null])]), o.hint ? el('div', { class: 'ctl-hint', text: o.hint }) : null]);
  }
  // an on/off switch for a whole part of the model
  function toggle(o) {
    var box = el('input', { type: 'checkbox', role: 'switch', id: o.id });
    box.addEventListener('change', function () { o.set(box.checked); changed(false); });
    syncers.push(function () { box.checked = !!o.get(); });
    return el('div', { class: 'ctl' }, [el('label', { class: 'check switch', for: o.id }, [box, el('span', null, [o.label, o.ext ? el('span', { class: 'tag-ext', text: 'added', title: 'An extension: not part of the paper' }) : null])]), o.hint ? el('div', { class: 'ctl-hint', text: o.hint }) : null]);
  }
  function choice(o) {
    var s = el('select', { id: o.id }, o.options.map(function (p) { return el('option', { value: p[0], text: p[1] }); }));
    s.addEventListener('change', function () { o.set(s.value); changed(false); });
    syncers.push(function () { s.value = o.get(); });
    return el('div', { class: 'ctl' }, [el('div', { class: 'field' }, [el('label', { for: o.id, text: o.label }), s]), o.hint ? el('div', { class: 'ctl-hint', text: o.hint }) : null]);
  }
  var groupOpen = { ai: true };   // the panel opens on its first group; the rest wait closed
  var GROUP_ICON = {
    ai: 'M4.5 4.5h7v7h-7zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14M6.8 6.8h2.4v2.4H6.8z',
    people: 'M8.2 5.4a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 1 1 4.4 0M2 13.2c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8M13.1 6a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0M11.6 9.5c1.5.2 2.4 1.5 2.4 3.2',
    trust: 'M8 2l5 2v3.5c0 3.2-2.1 5.4-5 6.5c-2.9-1.1-5-3.3-5-6.5V4zM5.8 8l1.6 1.6l2.9-3.1',
    inter: 'M5.4 4.2a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M14 4.2a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M9.7 11.8a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M5.4 4.2h5.2M4.6 5.7l2.5 4.6M11.4 5.7l-2.5 4.6',
    rules: 'M6 2h4v3H6zM2 11h4v3H2zM10 11h4v3h-4zM8 5v3M4 11V8h8v3',
    market: 'M2 13.5h12M4.5 13.5V9.5M8 13.5V4.5M11.5 13.5V7.5',
    tech: 'M12.2 8a4.2 4.2 0 1 1-8.4 0a4.2 4.2 0 1 1 8.4 0M9.6 8a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5L5 5M11 11l1.5 1.5M3.5 12.5L5 11M11 5l1.5-1.5',
    view: 'M1.5 8c1.7-3 3.9-4.5 6.5-4.5S12.8 5 14.5 8c-1.7 3-3.9 4.5-6.5 4.5S3.2 11 1.5 8zM10 8a2 2 0 1 1-4 0a2 2 0 1 1 4 0'
  };
  function group(id, name, body) {
    var d = el('details', { class: 'grp', id: 'g-' + id }, [
      el('summary', null, [el('i', { class: 'tw' }), GROUP_ICON[id] ? sv('svg', { class: 'gico gico-' + id, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, sv('path', { d: GROUP_ICON[id] })) : null, el('span', { class: 'gname', text: name }), el('span', { class: 'gsum', id: 'gs-' + id })]),
      el('div', { class: 'grp-body' }, body)
    ]);
    d.open = !!groupOpen[id];
    d.addEventListener('toggle', function () { groupOpen[id] = d.open; });
    return d;
  }

  function roleCard(r, i) {
    function rs(key, label, sym, min, max, step, dec) {
      return slider({ id: 'c-r' + i + '-' + key, label: label, sym: sym, min: min, max: max, step: step, dec: dec, get: function () { return r[key]; }, set: function (v) { r[key] = v; } });
    }
    var meta = el('span', { class: 'rmeta' });
    syncers.push(function () { var c = headcounts(ST); if (c[i] == null) return; meta.textContent = whole(c[i]) + (ST.humans ? ' (' + pct(c[i] / ST.humans) + ')' : ''); });
    var name = el('input', { class: 'role-name', id: 'c-r' + i + '-name', value: r.name, maxlength: 24, 'aria-label': 'Role name' });
    var title = el('span', { class: 'rname', text: r.name });
    name.addEventListener('input', function () { r.name = name.value || 'Role ' + (i + 1); title.textContent = r.name; });
    name.addEventListener('change', function () { changed(false); });
    var rm = el('button', { class: 'linkbtn', text: 'Remove role', disabled: ST.roles.length <= 1 });
    rm.addEventListener('click', function () { ST.roles.splice(i, 1); rebuildRoles(); changed(false); });
    return el('details', { class: 'role' }, [
      el('summary', null, [el('i', { class: 'tw' }), el('i', { class: 'sw', style: 'background:' + roleVar(r) }), title, meta]),
      el('div', { class: 'role-body' }, [
        name,
        rs('share', 'Share of people', 'weight', 0, 10, 0.1, 1),
        rs('y1', 'Task skill 1', 'y₁', 0.1, 15, 0.1, 2),
        rs('y2', 'Task skill 2', 'y₂', 0.1, 15, 0.1, 2),
        rs('ys', 'Coordination', 'y*', 0, 1.6, 0.01, 2),
        check({ id: 'c-r' + i + '-lead', label: 'Leads a firm: one per firm', ext: true, get: function () { return !!r.lead; }, set: function (v) { ST.roles.forEach(function (o) { o.lead = false; }); r.lead = v; if (v && r.demoteYs == null) r.demoteYs = 0.97; },
          hint: 'Every firm with one of these people has exactly one, as its leader. When firms merge, the others work on as coordinators.' }),
        slider({ id: 'c-r' + i + '-dys', label: 'Coordination as a coordinator', sym: 'y*', min: 0, max: 1.6, step: 0.01, dec: 2, ext: true, get: function () { return r.demoteYs == null ? 0.97 : r.demoteYs; }, set: function (v) { r.demoteYs = v; }, disabled: function () { return !r.lead; } }),
        el('div', { class: 'role-foot' }, rm)
      ])
    ]);
  }
  var roleSyncStart = 0;
  function rebuildRoles() {
    var box = $('roles'); if (!box) return;
    syncers.length = roleSyncStart;               // role controls always register last
    box.textContent = '';
    ST.roles.forEach(function (r, i) { box.appendChild(roleCard(r, i)); });
    $('addRole').disabled = ST.roles.length >= 6;
  }
  function addRole() {
    var used = ST.roles.map(function (r) { return r.color; }), col = COLOR_SLOTS.filter(function (c) { return used.indexOf(c) < 0; })[0] || 'r4';
    ST.roles.push({ id: 'r' + Date.now(), name: 'Role ' + (ST.roles.length + 1), share: 2, y1: 5, y2: 5, ys: 0.8, color: col });
    rebuildRoles(); changed(false);
  }

  function buildRack() {
    var rack = $('rack'); rack.textContent = ''; syncers.length = 0;
    rack.appendChild(el('div', { class: 'rack-head' }, [
      el('span', { class: 'lbl', text: 'Parameters' }),
      el('button', { class: 'linkbtn', id: 'resetScene', text: 'Reset scene', onclick: function () { selectScene(ST.sceneId); } }),
      el('button', { class: 'btn quiet icon rack-close', id: 'rackClose', 'aria-label': 'Close the parameter panel', onclick: function () { setRack(false, true); } }, sv('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, sv('path', { d: 'M4 4l8 8M12 4l-8 8' })))
    ]));

    rack.appendChild(group('ai', 'AI', [
      slider({ id: 'c-cap', label: 'Fleet available', sym: 'copies', min: 0, max: 100000, step: 100, dec: 0, int: true, ext: true, get: function () { return ST.aiCap; }, set: function (v) { ST.aiCap = v; }, hint: 'How many copies can be rented at most. Firms rent only what pays.' }),
      slider({ id: 'c-ai1', label: 'Task skill 1', sym: 'y₁ᴹ', min: 0.2, max: 15, step: 0.05, dec: 2, get: function () { return ST.ai.y1; }, set: function (v) { ST.ai.y1 = v; if (ST.lockAI) ST.ai.y2 = v; } }),
      slider({ id: 'c-ai2', label: 'Task skill 2', sym: 'y₂ᴹ', min: 0.2, max: 15, step: 0.05, dec: 2, get: function () { return ST.ai.y2; }, set: function (v) { ST.ai.y2 = v; if (ST.lockAI) ST.ai.y1 = v; } }),
      check({ id: 'c-lock', label: 'Keep both task skills equal', get: function () { return ST.lockAI; }, set: function (v) { ST.lockAI = v; if (v) ST.ai.y2 = ST.ai.y1; } }),
      slider({ id: 'c-ais', label: 'Coordination', sym: 'y*ᴹ', min: 0, max: 1.6, step: 0.005, dec: 3, mark: { v: 1, t: 'scale threshold' }, get: function () { return ST.ai.ys; }, set: function (v) { ST.ai.ys = v; }, hint: 'Above 1, output per copy keeps rising as an AI firm grows.' }),
      slider({ id: 'c-r', label: 'Compute cost per copy', sym: 'r', min: 0.05, max: 3, step: 0.05, dec: 2, get: function () { return ST.r; }, set: function (v) { ST.r = v; } })
    ]));

    rack.appendChild(group('people', 'People', [
      slider({ id: 'c-humans', label: 'People', sym: 'headcount', min: 0, max: 1000, step: 1, dec: 0, int: true, get: function () { return ST.humans; }, set: function (v) { ST.humans = v; } }),
      el('div', { id: 'roles', style: 'display:grid;gap:6px' }),
      el('div', null, el('button', { class: 'linkbtn', id: 'addRole', text: 'Add a role', onclick: addRole })),
      slider({ id: 'c-jag', label: 'Jaggedness of skills', sym: '×', min: 0, max: 1.5, step: 0.05, dec: 2, ext: true, get: function () { return ST.jag; }, set: function (v) { ST.jag = v; }, hint: '0 makes everyone a generalist; 1 keeps each role’s skills as set. Teams of complementary specialists are the paper’s mosaic intelligence.' }),
      slider({ id: 'c-sigma', label: 'Variation between individuals', sym: 'σ', min: 0, max: 0.5, step: 0.01, dec: 2, ext: true, get: function () { return ST.sigma; }, set: function (v) { ST.sigma = v; }, hint: 'Spreads people around their role. Pay then differs person by person; the least valuable are the first outside firms.' }),
      slider({ id: 'c-wout', label: 'Outside option', sym: 'w', min: 0.05, max: 2, step: 0.01, dec: 2, get: function () { return ST.wOut; }, set: function (v) { ST.wOut = v; }, hint: 'What a person earns outside any firm. No wage can fall below it.' })
    ]));

    var trustSays = el('div', { class: 'ctl-hint', id: 'trustSays' });
    syncers.push(function () { trustSays.textContent = trustText(trustInfo(ST)); });
    rack.appendChild(group('trust', 'Trust', [
      toggle({ id: 'c-trust', label: 'People’s trust in AI decisions', ext: true, get: function () { return ST.trust.on; }, set: function (v) { ST.trust.on = v; } }),
      slider({ id: 'c-trustv', label: 'Trust', sym: '0 to 1', min: 0, max: 1, step: 0.01, dec: 2, mark: { t: 'warranted', get: function () { var i = trustInfo(ST); return i.t ? i.t.warranted : null; } },
        get: function () { return ST.trust.level; }, set: function (v) { ST.trust.level = v; }, disabled: function () { return !ST.trust.on; },
        hint: 'The share of AI decisions people act on without checking. What the AI warrants is how often its call beats the average person’s.' }),
      trustSays
    ]));

    rack.appendChild(group('inter', 'Intercompany', [
      toggle({ id: 'c-inter', label: 'Links between firms', ext: true, get: function () { return ST.inter.on; }, set: function (v) { ST.inter.on = v; },
        hint: 'Firms link into networks the way people form firms: the same scale curve, one level up. Three kinds of link feed it.' }),
      slider({ id: 'c-icg', label: 'Goods and inventory transfers', min: 0, max: 1, step: 0.01, dec: 2, get: function () { return ST.inter.goods; }, set: function (v) { ST.inter.goods = v; }, disabled: function () { return !ST.inter.on; },
        hint: 'How much of the gain from dividing work also holds across firms.' }),
      slider({ id: 'c-ics', label: 'Shared services', min: 0, max: 1, step: 0.01, dec: 2, get: function () { return ST.inter.services; }, set: function (v) { ST.inter.services = v; }, disabled: function () { return !ST.inter.on; },
        hint: 'How much of a firm’s own coordination carries across its boundary. It sets how many firms a network can hold together.' }),
      slider({ id: 'c-ici', label: 'IP licensing', min: 0, max: 1, step: 0.01, dec: 2, get: function () { return ST.inter.ip; }, set: function (v) { ST.inter.ip = v; }, disabled: function () { return !ST.inter.on; },
        hint: 'How far each task skill moves from the firm’s average toward what its best people know.' }),
      el('div', { class: 'ctl-hint', id: 'interSays' })
    ]));

    rack.appendChild(group('rules', 'Organisation rules', [
      choice({ id: 'c-size', label: 'Firm size', options: [['free', 'Chosen by firms'], ['solo', 'Everyone works alone'], ['fixed', 'Fixed size'], ['cap', 'Size limit'], ['single', 'One organisation']], get: function () { return ST.rules.size; }, set: function (v) { ST.rules.size = v; } }),
      slider({ id: 'c-sizev', label: 'Size', sym: 'agents', min: 1, max: 10000, log: true, dec: 0, get: function () { return ST.rules.sizeValue; }, set: function (v) { ST.rules.sizeValue = v; }, disabled: function () { return ST.rules.size !== 'fixed' && ST.rules.size !== 'cap'; }, show: function (v) { return String(v >= 10 ? Math.round(v) : +v.toFixed(1)); } }),
      check({ id: 'c-mixed', label: 'People and AI may share a firm', get: function () { return ST.rules.mixed; }, set: function (v) { ST.rules.mixed = v; } }),
      check({ id: 'c-mosaic', label: 'Different roles may share a firm', get: function () { return ST.rules.mosaic; }, set: function (v) { ST.rules.mosaic = v; } }),
      slider({ id: 'c-minh', label: 'Minimum human share per firm', sym: '%', min: 0, max: 100, step: 1, dec: 0, get: function () { return ST.rules.minHuman * 100; }, set: function (v) { ST.rules.minHuman = v / 100; } }),
      el('div', { class: 'ctl-hint', text: 'Rules restrict which firms may exist. The solver finds the best industry inside them, so the gap to the free equilibrium is what the structure costs.' }),
      el('div', null, el('button', { class: 'linkbtn', text: 'Clear all rules', onclick: function () { ST.rules = clone(BASE.rules); changed(false); } }))
    ]));

    rack.appendChild(group('market', 'Market', [
      slider({ id: 'c-ms', label: 'Market size', sym: 'output at price 0', min: 20, max: 1e7, log: true, get: function () { return ST.mk.S; }, set: function (v) { ST.mk.S = v; }, show: function (v) { return String(Math.round(v)); } }),
      slider({ id: 'c-p0', label: 'Top willingness to pay', sym: 'P₀', min: 0.05, max: 3, step: 0.01, dec: 2, get: function () { return ST.mk.P0; }, set: function (v) { ST.mk.P0 = v; } }),
      check({ id: 'c-niche', label: 'Add a second, niche market', get: function () { return ST.niche.on; }, set: function (v) { ST.niche.on = v; }, hint: 'A firm cannot be larger than the market it sells into, so a small market shelters small firms.' }),
      slider({ id: 'c-ns', label: 'Niche size', sym: 'output at price 0', min: 20, max: 1e6, log: true, get: function () { return ST.niche.S; }, set: function (v) { ST.niche.S = v; }, disabled: function () { return !ST.niche.on; }, show: function (v) { return String(Math.round(v)); } }),
      slider({ id: 'c-np0', label: 'Niche willingness to pay', sym: 'P₀', min: 0.05, max: 3, step: 0.01, dec: 2, get: function () { return ST.niche.P0; }, set: function (v) { ST.niche.P0 = v; }, disabled: function () { return !ST.niche.on; } })
    ]));

    rack.appendChild(group('tech', 'Technology', [
      slider({ id: 'c-rho', label: 'How well skills substitute', sym: 'ρ', min: -4, max: 0.9, step: 0.05, dec: 2, get: function () { return ST.rho; }, set: function (v) { ST.rho = v; }, hint: 'Low values make the weaker skill a bottleneck (−1 is the paper’s harmonic mean).' }),
      slider({ id: 'c-phi', label: 'Gain from dividing work', sym: 'φ', min: 0.02, max: 3, step: 0.01, dec: 2, get: function () { return ST.phi; }, set: function (v) { ST.phi = v; }, hint: 'Sets how much a team gains before coordination friction takes over.' }),
      check({ id: 'c-const', label: 'Constant returns: switch coordination off', get: function () { return ST.constReturns; }, set: function (v) { ST.constReturns = v; }, hint: 'The task-model limit: firm boundaries stop mattering.' })
    ]));

    rack.appendChild(group('view', 'View', [
      check({ id: 'c-labels', label: 'Label the firm types', get: function () { return ST.view.labels; }, set: function (v) { ST.view.labels = v; } }),
      slider({ id: 'c-speed', label: 'Animation speed', sym: '×', min: 0.3, max: 3, step: 0.1, dec: 1, get: function () { return ST.view.speed; }, set: function (v) { ST.view.speed = v; } }),
      slider({ id: 'c-seed', label: 'Random seed for individuals', sym: '#', min: 1, max: 99, step: 1, dec: 0, int: true, get: function () { return ST.seed; }, set: function (v) { ST.seed = v; } })
    ]));
    roleSyncStart = syncers.length;
    rebuildRoles();
  }

  function summaries() {
    function set(id, t) { var e = $('gs-' + id); if (e) e.textContent = t; }
    var cls = OI.classify(toParams(ST));
    set('people', whole(ST.humans) + ' in ' + ST.roles.length + (ST.roles.length === 1 ? ' role' : ' roles'));
    set('ai', ST.aiCap ? whole(ST.aiCap) + ' copies' : 'none');
    set('tech', ST.constReturns ? 'constant returns' : 'substitution ' + ST.rho + ', division gain ' + ST.phi);
    set('market', compact(ST.mk.S) + (ST.niche.on ? ' + niche ' + compact(ST.niche.S) : ''));
    var r = ST.rules, n = (r.size !== 'free' ? 1 : 0) + (r.mixed ? 0 : 1) + (r.mosaic ? 0 : 1) + (r.minHuman > 0 ? 1 : 0);
    set('rules', n ? n + (n === 1 ? ' rule on' : ' rules on') : 'none: free equilibrium');
    set('view', '');
    var ti = trustInfo(ST), tk = !ti.on ? 'off' : !ti.t ? 'idle' : Math.abs(ti.t.gap) < 0.005 ? 'ok' : ti.t.gap < 0 ? 'under' : 'over';
    set('trust', !ti.on ? 'off' : grp(ST.trust.level, 2) + ', ' + (tk === 'idle' ? 'no effect' : tk === 'ok' ? 'as warranted' : grp(Math.abs(ti.t.gap), 2) + ' ' + tk));
    var tc = $('trustChip');
    tc.hidden = !ti.on; tc.setAttribute('data-k', tk);
    if (ti.on) {
      tc.lastElementChild.textContent = '';
      tc.lastElementChild.appendChild(doc.createTextNode('Trust ' + grp(ST.trust.level, 2)));
      tc.lastElementChild.appendChild(el('span', { class: 'long', text: ({ idle: ', no effect', ok: ', as warranted', under: ', under', over: ', over' })[tk] }));
      tc.title = 'Trust is switched on, so these are not the paper’s numbers. ' + trustText(ti);
    }
    set('inter', ST.inter.on ? 'on' : 'off');
    $('interChip').hidden = !ST.inter.on;
    var chip = $('regime'); chip.setAttribute('data-k', cls.key); chip.lastElementChild.textContent = cls.label;
  }

  // ───────────────────────── stage ─────────────────────────
  var world = null;
  function shown() { return ST.viewA && PIN ? { st: PIN.st, res: PIN.res, real: PIN.real, rank: PIN.rank } : { st: ST, res: R, real: REAL, rank: RANK }; }
  A.shown = shown;

  function recipeName(st, rc, real) {
    var names = [];
    st.roles.forEach(function (r, i) { if (rc.sRole[i] > 0.004) names.push(r.name); });
    if (st.rules.size === 'single') return 'One organisation';
    var lr = -1; st.roles.forEach(function (r, i) { if (r.lead && lr < 0) lr = i; });
    if (lr >= 0 && rc.sLead > 1e-12) return rc.n <= 1.5 && rc.share > 0.5 ? 'Giant ' + st.roles[lr].name + '-led firm' : st.roles[lr].name + '-led firms';
    if (lr >= 0 && rc.sRole[lr] > 0.004 && names.length === 1 && names[0] === st.roles[lr].name && rc.sAI < 0.0005) return 'Teams of former ' + st.roles[lr].name + 's';
    var aiOnly = rc.sAI > 0.9995, humOnly = rc.sAI < 0.0005;
    if (real && real.counts) {                    // name what is actually drawn: whole people and whole copies
      var hc = 0, k2; for (k2 = 0; k2 < st.roles.length; k2++) hc += real.counts[k2];
      if (hc === 0) aiOnly = true; else if (real.counts[st.roles.length] === 0) humOnly = true;
      if (hc > 0) { names = []; st.roles.forEach(function (r, i) { if (real.counts[i] > 0) names.push(r.name); }); }
    }
    if (aiOnly) return rc.n <= 1.5 && rc.share > 0.5 ? 'Giant AI firm' : (real && real.micro ? 'AI working alone' : 'AI-only firms');
    if (humOnly) {
      if (names.length === 1) return names[0] + (real && real.micro ? ' working alone' : ' firms');
      return 'Human teams';
    }
    return 'Mixed firms';
  }
  A.recipeName = recipeName;
  // one name per firm type; types that would share a name are told apart by their leading role
  function recipeNames(st, res, real) {
    var byRi = {}; real.groups.forEach(function (g) { byRi[g.ri] = g; });
    var names = res.recipes.map(function (rc, ri) { return recipeName(st, rc, byRi[ri]); }), seen = {};
    names.forEach(function (nm, ri) { (seen[nm + '|' + res.recipes[ri].mk] = seen[nm + '|' + res.recipes[ri].mk] || []).push(ri); });
    Object.keys(seen).forEach(function (key) {
      var list = seen[key]; if (list.length < 2) return;
      list.forEach(function (ri) {
        var rc = res.recipes[ri], best = -1, bv = 0;
        st.roles.forEach(function (r, i) {
          var mine = rc.sRole[i], others = 0;
          list.forEach(function (rj) { if (rj !== ri) others = Math.max(others, res.recipes[rj].sRole[i]); });
          if (mine - others > bv) { bv = mine - others; best = i; }
        });
        if (best >= 0) names[ri] += ' with ' + st.roles[best].name.toLowerCase();
      });
    });
    return names;
  }
  A.recipeNames = recipeNames;
  // nLead: how many of the leading role in these counts actually lead (the rest work as coordinators)
  function mixText(st, c, nLead) {
    var parts = [];
    st.roles.forEach(function (r, i) {
      if (!c[i]) return;
      if (r.lead && nLead != null) { if (nLead > 0) parts.push(r.name + ' ' + whole(Math.min(nLead, c[i]))); if (c[i] - nLead > 0) parts.push('Coordinators ' + whole(c[i] - nLead)); }
      else parts.push(r.name + ' ' + whole(c[i]));
    });
    if (c[st.roles.length]) parts.push('AI ' + whole(c[st.roles.length]));
    return parts.join(', ');
  }

  function emptyInfo(res) {
    var n = res.note || '';
    if (/No agents/.test(n)) return { t: 'Nobody to organise yet', p: 'Add people, or make an AI fleet available, to see firms form.', a: 'people' };
    if (/rules allow no firm/.test(n)) return { t: 'The organisation rules allow no firm', p: 'With these rules together no firm can exist. Clear them to see firms form again.', a: 'rules' };
    if (/single organisation/.test(n)) return { t: 'One organisation cannot break even here', p: 'A single firm for everyone does not cover its costs. Choose another firm size rule, or lower the compute cost or the outside option.', a: 'rules' };
    return { t: 'No firm can cover its costs', p: 'At these prices nothing is worth producing. Lower the compute cost or the outside option, or raise what buyers are willing to pay.', a: 'reset' };
  }
  function renderEmpty(box, res) {
    var info = emptyInfo(res), btn;
    if (info.a === 'people') btn = el('button', { class: 'btn', text: 'Go to People', onclick: function () {
      setRack(true, false); var g = $('g-people'); if (g) g.open = true; var c = $('c-humans'); if (c) c.focus();
    } });
    else if (info.a === 'rules') btn = el('button', { class: 'btn', text: 'Clear all rules', onclick: function () { ST.rules = clone(BASE.rules); changed(false); } });
    else btn = el('button', { class: 'btn', text: 'Reset scene', onclick: function () { selectScene(ST.sceneId); } });
    box.textContent = ''; box.appendChild(el('h2', { text: info.t })); box.appendChild(el('p', { text: info.p })); box.appendChild(btn);
  }
  function updateWorld(instant) {
    var sh = shown(), st = sh.st, res = sh.res, real = sh.real;
    if (!world || !res) return;
    var nRoles = st.roles.length, order = [], i;
    for (i = 0; i < nRoles; i++) order.push(i);
    order.sort(function (a, b) { return st.roles[b].ys - st.roles[a].ys || a - b; });
    order.push(nRoles);
    var stageEl = $('stage'), stage = stageEl.getBoundingClientRect(), tall = stage.height > 460;
    if (!tall && ST.noteOpen && !ST.noteForced) { ST.noteOpen = false; renderNote(); }   // a short stage has no room for the note
    stageEl.classList.toggle('short', !tall);
    var noteH = ST.noteOpen ? $('note').offsetHeight : 0;
    world.inset = { l: 20, r: 20, t: (noteH && tall && stage.width < 1100 ? noteH + 34 : (ST.noteOpen ? 28 : 48)), b: $('legend').offsetHeight + (tall ? 26 : 18) };
    var names = recipeNames(st, res, real);
    var texts = real.groups.map(function (g) {
      var nF = g.micro ? g.total : g.firms.length, hc = 0, q;
      var sub = g.micro ? whole(g.total) + ' agents' : (nF === 1 ? '1 firm of ' + whole(g.total) : whole(nF) + ' firms of ' + size(g.total / nF));
      for (q = 0; q < nRoles; q++) hc += g.counts[q];
      if (hc > 0 && g.counts[nRoles] > 0) sub += ', ' + pct(hc / g.total) + ' human';
      if (g.net > 1.05 && !g.micro) sub += ', networks of ' + size(g.net);
      // a very long name is cut on the stage so its label cannot run off the edge; the readouts and the screen-reader text keep it whole
      var nm = names[g.ri], cut = nm.length > 30 ? nm.slice(0, 29) + '…' : nm;
      return { name: cut, full: nm, sub: sub, w: Math.max(cut.length * 7.2, sub.length * 6) };
    });
    var L = WorldNS.layout(real, { nRoles: nRoles, centerOrder: order, labelW: texts.map(function (x) { return x.w; }), view: { w: stage.width - 40, h: stage.height - world.inset.t - world.inset.b - 40 } });
    var rowBottom = {}; L.rows.forEach(function (row) { rowBottom[row.mk] = row.y + row.h / 2; });
    var labels = L.districts.map(function (d) { return { x: d.x, y: rowBottom[d.mk], ay: d.y + d.r, name: texts[d.gi].name, full: texts[d.gi].full, sub: texts[d.gi].sub }; });
    L.pools.forEach(function (p) {
      labels.push({ x: p.x + p.w / 2, y: p.y + p.h, name: p.kind === 'bench' ? 'Outside firms' : 'Idle compute', sub: whole(p.n) + (p.kind === 'bench' ? (p.n === 1 ? ' person' : ' people') : ' copies') });
    });
    $('world').setAttribute('aria-label', labels.length ? 'The stage: ' + labels.map(function (lb) { return (lb.full || lb.name) + ', ' + lb.sub; }).join('; ') + '.' : 'The stage: nobody to organise yet.');
    var tags = res.markets.length > 1 ? L.rows.map(function (row) {
      var m = res.markets[row.mk];
      return { x: row.x0 + row.w / 2, y: row.top, text: (m.name || 'Market') + ': output ' + compact(m.Q) + ', price ' + price(m.P) };
    }) : [];
    var ord = null;
    if (sh.rank) { ord = sh.rank.map(function (r) { return r.order; }); ord.push(null); }
    world.show.labels = ST.view.labels; world.speed = ST.view.speed;
    world.setColors(worldColors(st));
    world.update(L, ord, labels, tags, instant);
    var em = $('emptyMsg'); em.hidden = !res.empty || real.groups.length > 0;
    if (!em.hidden) renderEmpty(em.firstElementChild, res);
    renderLegend(st);
  }
  // the legend is one line straight on the stage; when it is longer than the stage it scrolls sideways and fades at the cut
  function renderLegend(st) {
    var lg = $('legend'); lg.textContent = '';
    var keys = st.roles.map(function (r) { return el('span', { class: 'k', title: r.name }, [el('i', { style: 'background:' + roleVar(r) }), el('span', { text: r.name })]); });
    keys.push(
      el('span', { class: 'k' }, [el('i', { class: 'sq', style: 'background:var(--c-ai)' }), 'AI copy']),
      el('span', { class: 'k' }, [el('i', { class: 'ring' }), 'person outside firms']),
      el('span', { class: 'k' }, [el('i', { class: 'sq dim', style: 'background:var(--c-ai)' }), 'idle copy']),
      el('span', { class: 'k' }, [el('i', { class: 'hex' }), 'firm']),
      st.inter && st.inter.on ? el('span', { class: 'k' }, [el('i', { class: 'link' }), 'firms in one network']) : null,
      R && R.lead && R.lead.demoted > 0.5 && st.roles[R.lead.role] ? el('span', { class: 'k' }, [el('i', { style: 'background:' + (st.roles[R.lead.role].color === 'r3' ? 'var(--ink)' : 'var(--c-r3)') }), 'coordinator (former ' + st.roles[R.lead.role].name + ')']) : null,
      el('span', { class: 'sr-only', text: 'A hexagon is one firm, edged in the colour of the role most of its people have. Firm types run from people only on the left to AI only on the right.' })
    );
    keys.forEach(function (k) { if (k) lg.appendChild(k); });
    legendFit();
  }
  function legendFit() {
    var lg = $('legend'), over = lg.scrollWidth > lg.clientWidth + 1;
    lg.classList.toggle('more', over && lg.scrollLeft + lg.clientWidth < lg.scrollWidth - 1);
    if (over) lg.setAttribute('tabindex', '0'); else lg.removeAttribute('tabindex');   // a clipped line can be scrolled from the keyboard
  }

  function kvList(rows) { var g = el('dl', { class: 'kv' }); rows.forEach(function (r) { if (!r) return; g.appendChild(el('dt', { text: r[0] })); g.appendChild(el('dd', { text: r[1] })); }); return g; }
  function firmFacts(P, rc) {
    var b = OI.capPrices(P, rc);
    var tz = P.trust && rc.zMean != null && Math.abs(rc.z - rc.zMean) > 5e-4, tl = P.trust && rc.LMean != null && rc.L < rc.LMean * (1 - 5e-4);
    return [
      ['Output per agent', compact(rc.a)],
      ['Competence', grp(rc.L, 2) + (tl ? ' (' + grp(rc.LMean, 2) + ' before unchecked errors)' : '')],
      ['Mean coordination', grp(rc.z, 3) + (tz ? ' (' + grp(rc.zMean, 3) + ' before trust)' : '')],
      ['Preferred size', P.constReturns ? 'any' : (isFinite(rc.mPref) ? size(rc.mPref) : 'no ceiling')],
      ['Size', OI.STATE_NAMES[rc.st] + (rc.sLead > 1e-12 && rc.st !== OI.ST_LEAD ? ', one leader per firm' : '')],
      P.inter && rc.ic ? ['Network', rc.ic.n > 0.005 ? size(1 + rc.ic.n) + ' firms linked, output ×' + grp(rc.ic.H, 2) + (rc.ic.st > 1 ? ' (' + OI.NET_STATE_NAMES[rc.ic.st] + ')' : '') : 'none: linking would not pay'] : null,
      ['Pays per unit of skill', money(b.y1) + ' / ' + money(b.y2)],
      ['Pays per unit of coordination', money(b.ys)]
    ];
  }
  A.kvList = kvList; A.firmFacts = firmFacts;
  function tipFor(hit) {
    var sh = shown(), st = sh.st, res = sh.res, real = sh.real, P = res.P, box = el('div');
    if (hit.kind === 'bench') { box.appendChild(el('h4', { text: 'People outside firms' })); box.appendChild(el('div', { text: whole(hit.n) + ' take the outside option of ' + money(st.wOut) + '. No firm would pay them more.' })); return box; }
    if (hit.kind === 'idle') { box.appendChild(el('h4', { text: 'Idle compute' })); box.appendChild(el('div', { text: whole(hit.n) + ' copies are not rented: one more would cost ' + money(st.r) + ' and earn less.' })); return box; }
    var rc = res.recipes[hit.ri], g = real.groups[hit.gi], c = hit.kind === 'firm' ? hit.firm.c : g.counts, b = OI.capPrices(P, rc);
    box.appendChild(el('h4', { text: recipeNames(st, res, real)[hit.ri] + (hit.kind === 'firm' ? '' : ' (all)') }));
    box.appendChild(el('div', { class: 'rowsub', text: mixText(st, c, real.leadRole >= 0 ? (g.lead ? (hit.kind === 'firm' ? 1 : g.firms.length) : 0) : null) }));
    box.appendChild(A.mixBar(st, rc));
    box.appendChild(kvList(firmFacts(P, rc)));
    return box;
  }
  function showTip(hit, cx, cy) {
    var tip = $('tip');
    if (!hit) { tip.hidden = true; return; }
    tip.textContent = ''; tip.appendChild(tipFor(hit)); tip.hidden = false;
    var sr = $('stage').getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = cx - sr.left + 14, y = cy - sr.top + 14;
    if (x + tw > sr.width - 6) x = cx - sr.left - tw - 12;
    if (y + th > sr.height - 6) y = cy - sr.top - th - 12;
    tip.style.left = Math.max(6, x) + 'px'; tip.style.top = Math.max(6, y) + 'px';
  }

  // ───────────────────────── headline numbers ─────────────────────────
  function delta(now, was, better) {
    if (was == null || !isFinite(was) || !isFinite(now)) return null;
    var d = now - was, rel = Math.abs(was) > 1e-9 ? d / Math.abs(was) : (Math.abs(d) < 1e-9 ? 0 : (d > 0 ? Infinity : -Infinity));
    if (Math.abs(rel) < 0.0005) return el('span', { text: 'same as A' });
    var txt = (d > 0 ? '▲ ' : '▼ ') + (isFinite(rel) ? (Math.abs(rel) >= 10 ? '×' + grp(Math.abs(now / was), 1) : pct(Math.abs(rel))) : 'from 0') + ' vs A';
    return el('span', { class: better == null ? '' : ((d > 0) === better ? 'delta-up' : 'delta-down'), text: txt });
  }
  A.delta = delta;
  // One readout: name and value on one baseline. The note moves into the tooltip (and is read out to
  // assistive technology); a comparison with the pinned scenario A stays in view.
  function kpi(label, value, small, sub, tip) {
    var note = typeof sub === 'string' ? sub : '', vs = sub && typeof sub === 'object' ? sub : null;
    var title = [note ? label + ': ' + note : '', tip || ''].filter(Boolean).join('. ');
    return el('div', { class: 'kpi', title: title || null }, [
      el('span', { class: 'lbl', text: label }),
      el('span', { class: 'v' }, [value, small ? el('small', { text: small }) : null]),
      vs ? el('span', { class: 'd' }, vs) : null,
      note ? el('span', { class: 'n', text: note }) : null
    ]);
  }
  // the Notes switch: one element kept across redraws, so it never loses keyboard focus
  var notesOn = false;
  try { notesOn = root.localStorage.getItem('hive-notes') === '1'; } catch (e) { /* storage is optional */ }
  var notesBtn = el('button', { class: 'btn kpi-notes', id: 'kpiNotes', type: 'button', 'aria-pressed': String(notesOn), title: 'Show the note under each headline number' }, [el('span', { class: 'tr', 'aria-hidden': 'true' }), 'Notes']);
  notesBtn.addEventListener('click', function () {
    notesOn = !notesOn; notesBtn.setAttribute('aria-pressed', String(notesOn)); $('kpis').classList.toggle('notes', notesOn);
    try { root.localStorage.setItem('hive-notes', notesOn ? '1' : '0'); } catch (e) { /* storage is optional */ }
  });
  function metrics(res, st) {
    var H = 0; res.P.roles.forEach(function (r) { H += r.n; });
    return {
      Q: res.Q, P: res.markets.length ? res.markets[0].P : 0, pInt: res.markets.length ? res.markets[0].p : 0, W: res.W, emp: res.employedTotal || 0, H: H,
      wage: (res.employedTotal || 0) > 0 ? res.wageBill / res.employedTotal : st.wOut, ai: res.aiUsed, cap: res.P.ai.cap,
      firms: res.nFirms, largest: res.largest, hhi: res.hhi, CS: res.CS, rents: res.humanRents, aiRent: res.aiRent
    };
  }
  A.metrics = metrics;
  function renderKPIs() {
    var box = $('kpis');
    [].slice.call(box.querySelectorAll('.kgroup')).forEach(function (g) { box.removeChild(g); });
    box.classList.toggle('notes', notesOn);
    if (notesBtn.parentNode !== box) box.appendChild(notesBtn);
    if (!R) return;
    var m = metrics(R, ST), a = PIN ? metrics(PIN.res, PIN.st) : null, none = m.firms < 0.5;
    function sub(key, better, fallback) { var d = a ? delta(m[key], a[key], better) : null; return d || fallback; }
    var conc = none ? 'no firms' : m.hhi > 0.6 ? 'one dominant firm' : m.hhi > 0.15 ? 'concentrating' : 'many small firms';
    var g1 = el('div', { class: 'kgroup' }), g2 = el('div', { class: 'kgroup' });
    g1.appendChild(kpi('Output', compact(m.Q), null, sub('Q', true, pct(clamp(m.Q / (ST.mk.S + (ST.niche.on ? ST.niche.S : 0)), 0, 1)) + ' of market')));
    var split = m.Q > 0 && Math.abs(m.pInt - m.P) > 0.005 * Math.max(m.P, 1e-12);
    g1.appendChild(kpi('Price', price(m.P), null, sub('P', null, split ? 'firms get ' + price(m.pInt) : 'max ' + price(ST.mk.P0)),
      split ? 'What buyers pay for one more unit. A firm as large as its market, or one that cannot reach its best scale, is financed at a different internal price (' + price(m.pInt) + ' per unit here), as in the paper.' : null));
    g1.appendChild(kpi('Total surplus', compact(m.W), null, sub('W', true, m.W > 0 ? pct(clamp(m.CS / m.W, 0, 1)) + ' to buyers' : 'nothing produced')));
    g1.appendChild(kpi('In firms', whole(m.emp), null, sub('emp', true, m.H ? pct(m.emp / m.H) + ' of ' + whole(m.H) : 'no people')));
    g2.appendChild(kpi('Mean wage', m.H ? money(m.wage) : '–', null, sub('wage', true, m.emp > 0.5 ? 'outside ' + money(ST.wOut) : (m.H ? 'nobody in firms' : 'no people'))));
    g2.appendChild(kpi('AI in use', whole(m.ai), null, sub('ai', null, m.aiRent > 1e-6 ? 'rent +' + money(m.aiRent) : (m.cap ? pct(m.ai / m.cap) + ' of fleet' : 'no fleet')),
      m.aiRent > 1e-6 ? 'The whole fleet is rented. One more copy would be worth this much more than it costs.' : null));
    g2.lastChild.classList.add('kpi-ai');   // the AI count wears the AI copies' colour
    g2.appendChild(kpi('Firms', m.firms >= 1e4 ? compact(m.firms) : whole(m.firms), null, sub('firms', null, none ? 'none' : 'largest ' + size(m.largest))));
    g2.appendChild(kpi('Concentration', grp(m.hhi, m.hhi < 0.1 ? 3 : 2), 'HHI', sub('hhi', null, conc),
      'Herfindahl index: near 0 when output is spread over many firms, 1 when one firm makes all of it.'));
    box.insertBefore(g1, notesBtn); box.insertBefore(g2, notesBtn);
  }

  function afterSolve() {
    // if the stage changed colour without a theme event reaching us, pick up its colours now
    if (world && world.C && world.C.page !== cssVar('--page', $('stage'))) world.setColors(worldColors(shown().st));
    updateWorld(false); renderKPIs();
    var says = $('interSays'), sh0 = shown();
    if (says) says.textContent = interText(ST, R, REAL);
    $('interChip').title = 'Links between firms are switched on, so these are not the paper’s numbers. ' + interText(ST, R, REAL);
    renderLegend(sh0.st);
    if (A.renderPanels) A.renderPanels();
    $('ab').hidden = !PIN;
    $('abA').setAttribute('aria-pressed', String(!!ST.viewA)); $('abB').setAttribute('aria-pressed', String(!ST.viewA));
  }
  A.afterSolve = afterSolve;

  // ───────────────────────── scenes, pin, brief ─────────────────────────
  function renderNote() {
    var sc = SCENES.filter(function (s) { return s.id === ST.sceneId; })[0], note = $('note');
    note.hidden = !ST.noteOpen; $('noteTab').hidden = ST.noteOpen;
    note.textContent = '';
    if (!sc) return;
    note.appendChild(el('h2', { text: sc.name }));
    note.appendChild(el('p', { text: sc.note }));
    if (sc.paper) note.appendChild(el('p', { class: 'paper', text: sc.paper }));
    note.appendChild(el('button', { class: 'btn quiet icon x', 'aria-label': 'Hide this note', onclick: function () { ST.noteOpen = false; ST.noteForced = false; renderNote(); updateWorld(false); } }, sv('svg', { viewBox: '0 0 16 16' }, sv('path', { d: 'M4 4l8 8M12 4l-8 8' }))));
  }
  function selectScene(id) {
    stopPlay();
    loadScene(id);
    $('scene').value = ST.sceneId;
    buildRack(); syncAll(); renderNote();
    if (world) { world.userCam = false; }
    if (A.onScene) A.onScene();
    syncScrub();
    runSolve(false);
  }
  A.selectScene = selectScene;
  function buildSceneMenu() {
    var sel = $('scene'), groups = {};
    SCENES.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    Object.keys(groups).forEach(function (g) {
      sel.appendChild(el('optgroup', { label: g }, groups[g].map(function (s) { return el('option', { value: s.id, text: s.name }); })));
    });
    sel.addEventListener('change', function () { selectScene(sel.value); });
  }

  function pinNow() {
    if (!R) return;
    PIN = { st: clone(ST), res: R, real: OI.realize(R), rank: RANK };
    ST.viewA = false; toast('Pinned as A. Change anything to compare.'); afterSolve();
  }
  function toast(msg) {
    var t = el('div', { class: 'toast', role: 'status', text: msg }); doc.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  A.toast = toast;

  function brief() {
    var m = metrics(R, ST), n = headcounts(ST), cls = OI.classify(toParams(ST)), s = [];
    s.push('Scenario from HAIV: Human-AI Venture, a playground for the Organizing Intelligence model (Imas, Koh and Legg, 2026).');
    s.push('People: ' + whole(ST.humans) + ' in total: ' + ST.roles.map(function (r, i) { var e = effRole(ST, r); return whole(n[i]) + ' ' + r.name.toLowerCase() + ' (skills ' + grp(e.y1, 2) + ' and ' + grp(e.y2, 2) + ', coordination ' + grp(e.ys, 2) + ')'; }).join('; ') + '. Outside option ' + money(ST.wOut) + '.');
    s.push(ST.aiCap ? 'AI: a fleet of up to ' + whole(ST.aiCap) + ' copies at ' + money(ST.r) + ' each, task skills ' + grp(ST.ai.y1, 2) + ' and ' + grp(ST.ai.y2, 2) + ', coordination ' + grp(ST.ai.ys, 3) + ' (' + cls.label + ').' : 'AI: none.');
    s.push('Market: size ' + compact(ST.mk.S) + ', top willingness to pay ' + price(ST.mk.P0) + (ST.niche.on ? '; plus a niche market of size ' + compact(ST.niche.S) : '') + '. Technology: rho ' + ST.rho + ', phi ' + ST.phi + (ST.constReturns ? ', constant returns' : '') + '.');
    var r = ST.rules, rl = [];
    if (r.size === 'solo') rl.push('everyone works alone'); if (r.size === 'fixed') rl.push('every firm has ' + Math.round(r.sizeValue) + ' agents'); if (r.size === 'cap') rl.push('no firm above ' + Math.round(r.sizeValue) + ' agents'); if (r.size === 'single') rl.push('a single organisation');
    if (!r.mixed) rl.push('people and AI may not share a firm'); if (!r.mosaic) rl.push('roles may not share a firm'); if (r.minHuman > 0) rl.push('at least ' + pct(r.minHuman) + ' of every firm is human');
    s.push('Organisation rules: ' + (rl.length ? rl.join('; ') + '.' : 'none (free equilibrium).'));
    if (ST.inter.on) s.push('Intercompany (an extension, not in the paper): goods transfers ' + grp(ST.inter.goods, 2) + ', shared services ' + grp(ST.inter.services, 2) + ', IP licensing ' + grp(ST.inter.ip, 2) + ', each from 0 to 1. ' + interText(ST, R, REAL));
    if (ST.trust.on) s.push('Trust (an extension, not in the paper): ' + grp(ST.trust.level, 2) + ' on a scale from 0 to 1. ' + trustText(trustInfo(ST)));
    s.push('Result: output ' + compact(m.Q) + ' at price ' + price(m.P) + '; total surplus ' + compact(m.W) + '. ' + whole(m.emp) + ' of ' + whole(m.H) + ' people work in firms; wages: ' + ST.roles.map(function (ro, i) { return ro.name.toLowerCase() + ' ' + money(R.wages[i]); }).join(', ') + '. ' + whole(m.ai) + ' AI copies in use' + (m.aiRent > 1e-6 ? ' (fleet exhausted, rent ' + money(m.aiRent) + ' per copy)' : '') + '.');
    s.push('Firms: ' + R.recipes.map(function (rc) { var k = rc.m > 0 ? compact(rc.n) + ' x size ' + size(rc.m) : compact(rc.x) + ' agents without firm structure'; return recipeName(ST, rc) + ' (' + k + ', ' + pct(rc.sAI) + ' AI, ' + pct(rc.share) + ' of its market)'; }).join('; ') + '. Largest firm ' + size(m.largest) + ' agents; concentration (HHI) ' + grp(m.hhi, 3) + '.');
    return s.join('\n');
  }

  // ───────────────────────── AI progress: scrub and play ─────────────────────────
  var playing = false, playRaf = 0, lastTick = 0, lastSolveAt = 0;
  function setT(t) {
    ST.t = clamp(t, 0, 1);
    var a = lerpPath(ST.path, ST.t);
    ST.ai.y1 = a.y1; ST.ai.y2 = a.y2; ST.ai.ys = a.ys;
    ST.lockAI = Math.abs(a.y1 - a.y2) < 1e-9 && Math.abs(ST.path.from.y1 - ST.path.from.y2) < 1e-9;
    ST.viewA = false; syncAll(); syncScrub(); requestSolve(true);
  }
  A.setT = setT;
  function syncScrub() {
    var s = $('scrub'); s.value = Math.round(ST.t * 1000); s.style.setProperty('--p', ST.t * 100 + '%');
    ST.onPath = matchT(ST) != null;                 // the AI sliders can leave the path; the recorder then says so
    $('tval').textContent = ST.onPath ? Math.round(ST.t * 100) + '%' : 'off path';
    $('tval').title = ST.onPath ? '' : 'The AI was changed by hand and no longer sits on this path. Move the handle to return to it.';
    if (A.renderStrips) A.renderStrips();
  }
  A.syncScrub = syncScrub;
  function stopPlay() {
    playing = false; if (playRaf) root.cancelAnimationFrame(playRaf); playRaf = 0;
    var b = $('play'); if (b) { b.classList.remove('on'); b.setAttribute('aria-label', 'Play AI progress'); b.firstElementChild.firstElementChild.setAttribute('d', 'M5 3.5v9l7-4.5z'); }
  }
  function startPlay() {
    if (ST.t >= 0.999) ST.t = 0;
    playing = true; lastTick = 0;
    var b = $('play'); b.classList.add('on'); b.setAttribute('aria-label', 'Pause'); b.firstElementChild.firstElementChild.setAttribute('d', 'M5 3.5v9M11 3.5v9');
    playRaf = root.requestAnimationFrame(function step(ts) {
      if (!playing) return;
      var dt = lastTick ? Math.min(0.1, (ts - lastTick) / 1000) : 0; lastTick = ts;
      var t = ST.t + dt * ST.view.speed / 16;
      if (ts - lastSolveAt > 60 || t >= 1) { lastSolveAt = ts; setT(Math.min(1, t)); } else ST.t = Math.min(1, t);
      if (t >= 1) { stopPlay(); return; }
      playRaf = root.requestAnimationFrame(step);
    });
  }

  // ───────────────────────── parameter panel ─────────────────────────
  var mqNarrow = root.matchMedia ? root.matchMedia('(max-width: 980px)') : null;
  function setRack(open, user) {
    var app = $('app'), rack = $('rack'), narrow = !!(mqNarrow && mqNarrow.matches), modal = narrow && open;
    app.setAttribute('data-rack', open ? 'open' : 'closed'); $('rackToggle').setAttribute('aria-expanded', String(open));
    ['.topbar', '.center', '.rail'].forEach(function (sel) { var e = doc.querySelector(sel); if (e) e.inert = modal; });   // nothing behind the drawer can be reached
    if (modal) { rack.setAttribute('role', 'dialog'); rack.setAttribute('aria-modal', 'true'); if (user && $('rackClose')) $('rackClose').focus(); }
    else { rack.removeAttribute('role'); rack.removeAttribute('aria-modal'); if (narrow && user) $('rackToggle').focus(); }
    if (open) { rackAuto = false; if (midNow() && app.getAttribute('data-rail') === 'open') setRail(false, false); }
  }
  A.setRack = setRack;
  // Between the phone layout and a wide window, three columns leave the stage too little room,
  // so there one side panel is open at a time: opening the readouts closes the parameters and back.
  // Up to 1399px the readouts still start closed, so the headline numbers fit one row and the stage
  // keeps its height; from 1241px the user may open both, and that choice is then kept.
  var mqMid = root.matchMedia ? root.matchMedia('(min-width: 981px) and (max-width: 1240px)') : null;
  var mqSoft = root.matchMedia ? root.matchMedia('(min-width: 1241px) and (max-width: 1399px)') : null, railWant = null, rackAuto = false;
  function midNow() { return !!(mqMid && mqMid.matches); }
  function railDefault() { return railWant != null ? railWant : !(mqSoft && mqSoft.matches); }
  function setRail(open, user) {
    var app = $('app');
    if (user && !midNow()) railWant = open;          // what the user chose where there is room for both
    app.setAttribute('data-rail', open ? 'open' : 'closed'); $('railToggle').setAttribute('aria-expanded', String(open));
    if (open && midNow() && app.getAttribute('data-rack') === 'open') { setRack(false, false); rackAuto = true; }
  }

  // ───────────────────────── boot ─────────────────────────
  function init() {
    try { var t0 = root.localStorage.getItem('oi-theme'); if (THEMES.indexOf(t0) >= 0) theme = t0; } catch (e) { /* storage is optional */ }
    if (theme !== 'auto') doc.documentElement.setAttribute('data-theme', theme);
    var app = $('app');
    setRack(!(mqNarrow && mqNarrow.matches), false);  // a drawer on narrow screens starts closed
    if (mqNarrow) {
      var onN = function () { setRack(!mqNarrow.matches, false); };
      if (mqNarrow.addEventListener) mqNarrow.addEventListener('change', onN); else if (mqNarrow.addListener) mqNarrow.addListener(onN);
    }
    if (mqMid) {
      var onMid = function () {
        if (mqMid.matches) { if (app.getAttribute('data-rack') === 'open') setRail(false, false); }
        else if (!(mqNarrow && mqNarrow.matches)) { if (rackAuto) setRack(true, false); setRail(railDefault(), false); }
      };
      onMid();
      [mqMid, mqSoft].forEach(function (mq) { if (mq.addEventListener) mq.addEventListener('change', onMid); else if (mq.addListener) mq.addListener(onMid); });
    }
    buildSceneMenu();
    loadScene(SCENES[0].id);
    buildRack(); syncAll(); renderNote();
    world = new WorldNS.World($('world'), { onHover: showTip, onPick: function (hit) { if (hit && hit.gi != null && A.highlightRecipe) A.highlightRecipe(hit.ri); } });
    A.world = world;
    world.resize();
    var rzTimer = 0;
    function onResize() {
      world.resize();
      clearTimeout(rzTimer); rzTimer = setTimeout(function () { if (R) updateWorld(true); if (A.onResize) A.onResize(); }, 60);
    }
    if (root.ResizeObserver) new ResizeObserver(onResize).observe($('stage')); else root.addEventListener('resize', onResize);
    $('legend').addEventListener('scroll', legendFit, { passive: true });

    $('rackToggle').addEventListener('click', function () { setRack(app.getAttribute('data-rack') !== 'open', true); });
    $('scrim').addEventListener('click', function () { setRack(false, true); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mqNarrow && mqNarrow.matches && app.getAttribute('data-rack') === 'open') setRack(false, true);
    });
    $('skip').addEventListener('click', function (e) { e.preventDefault(); $('play').focus(); });
    $('railToggle').addEventListener('click', function () { setRail(app.getAttribute('data-rail') !== 'open', true); });
    $('dockToggle').addEventListener('click', function () {
      var open = app.getAttribute('data-dock') !== 'open';
      app.setAttribute('data-dock', open ? 'open' : 'closed'); this.setAttribute('aria-expanded', String(open));   // the chart icon stays; aria-expanded carries the state
    });
    $('themeBtn').addEventListener('click', function () { applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); if (A.renderPanels) A.renderPanels(); toast('Theme: ' + theme); });
    if (root.matchMedia) {
      var mq = root.matchMedia('(prefers-color-scheme: dark)'), onMq = function () { if (theme === 'auto') applyTheme('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    // the stage changes colour with the theme, so the canvas redraws whenever the theme attribute changes,
    // including when the page is embedded and its host switches the theme
    if (root.MutationObserver) new MutationObserver(function () { if (world && ST) world.setColors(worldColors(shown().st)); })
      .observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    $('zin').addEventListener('click', function () { world.zoomBy(1.5); });
    $('zout').addEventListener('click', function () { world.zoomBy(1 / 1.5); });
    $('zfit').addEventListener('click', function () { world.fit(); });
    $('zoom').addEventListener('keydown', function (e) {
      var d = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }[e.key];
      if (d) { e.preventDefault(); world.panBy(d[0], d[1]); }
    });
    $('noteOpen').addEventListener('click', function () { ST.noteOpen = true; ST.noteForced = true; renderNote(); updateWorld(false); });
    $('pinBtn').addEventListener('click', pinNow);
    $('unpin').addEventListener('click', function () { PIN = null; ST.viewA = false; afterSolve(); });
    $('abA').addEventListener('click', function () { if (PIN) { ST.viewA = true; afterSolve(); } });
    $('abB').addEventListener('click', function () { ST.viewA = false; afterSolve(); });
    $('aboutBtn').addEventListener('click', function () { $('about').showModal(); });
    $('briefBtn').addEventListener('click', function () { $('briefText').value = brief(); $('briefDlg').showModal(); });
    $('briefCopy').addEventListener('click', function () {
      var ta = $('briefText');
      function fallback() { ta.focus(); ta.select(); toast('Selected: press Ctrl or Cmd + C'); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { toast('Copied'); }, fallback); else fallback();
    });
    Array.prototype.forEach.call(doc.querySelectorAll('dialog'), function (d) {
      d.addEventListener('click', function (e) { if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) d.close(); });
    });
    $('scrub').addEventListener('input', function () { stopPlay(); setT(this.value / 1000); });
    $('play').addEventListener('click', function () { if (playing) stopPlay(); else startPlay(); });
    doc.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SUMMARY') { e.preventDefault(); if (playing) stopPlay(); else startPlay(); }
    });
    if (A.initPanels) A.initPanels();
    // the stage lettering is drawn on canvas: draw it again once the typefaces are ready
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (world) { world.setColors(worldColors(shown().st)); world.kick(); } });
    syncScrub();
    runSolve(false);
  }
  A.stopPlay = stopPlay;
  A.init = init;
})(typeof globalThis !== 'undefined' ? globalThis : this);
