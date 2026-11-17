/* Organizing Intelligence sandbox: model engine.
 *
 * Implements the CES environment of Imas, Koh and Legg, "Organizing Intelligence" (2026):
 *   F(firm) = L(mean skills) * S(size, mean coordination)
 *   L = ((y1^rho + y2^rho) / 2)^(1/rho)          competence: shifts the level
 *   S = m (1+m)^(z-1) exp(phi m / (1+m))          coordination: bends the scale curve
 * Equilibrium = the surplus-maximising industry (Theorem 1). For a fixed output the
 * least-cost industry is a linear programme over firm recipes (activity analysis,
 * Lemma 1); wages are its shadow values. Pure functions, no DOM.
 *
 * Trust and Intercompany are extensions that are not in the paper; with P.trust and P.inter
 * absent or off, nothing below changes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ST_PREF = 0, ST_RULE = 1, ST_STAFF = 2, ST_MARKET = 3, ST_ATOM = 4, ST_LEAD = 5;
  var STATE_NAMES = ['preferred size', 'size set by rule', 'limited by headcount', 'limited by market', 'atomistic', 'one leader per firm'];
  var NS_NONE = 0, NS_PREF = 1, NS_STAFF = 2, NS_MARKET = 3;      // what sets the size of a firm's network
  var NET_STATE_NAMES = ['no network', 'preferred size', 'limited by headcount', 'limited by market'];

  // ───────────────────────── technology ─────────────────────────
  function cesL(y1, y2, rho) {
    if (!(y1 > 0) || !(y2 > 0)) return 0;
    if (Math.abs(rho) < 1e-6) return Math.sqrt(y1 * y2);
    return Math.pow(0.5 * (Math.pow(y1, rho) + Math.pow(y2, rho)), 1 / rho);
  }
  // dL/dy_d for the CES aggregator
  function cesGrad(y1, y2, rho, L) {
    if (!(L > 0)) return [0, 0];
    return [0.5 * Math.pow(y1 / L, rho - 1), 0.5 * Math.pow(y2 / L, rho - 1)];
  }
  // average-product scale factor S(m,z)/m
  function gScale(m, z, phi) {
    return m > 0 ? Math.exp((z - 1) * Math.log1p(m) + phi * m / (1 + m)) : 1;
  }
  // preferred size m*(z)  (paper: CES-SCALE)
  function mStar(z, phi) {
    if (z >= 1) return Infinity;
    var m = phi / (1 - z) - 1;
    return m > 0 ? m : 0;
  }
  // best scale factor G(z)  (paper: CES-PEAK); unbounded at z >= 1
  function gPeak(z, phi) {
    var m = mStar(z, phi);
    return m === Infinity ? Infinity : gScale(m, z, phi);
  }
  // elasticity of output in size, m F'(m) / F(m)
  function sizeElasticity(m, z, phi) {
    return 1 + (z - 1) * m / (1 + m) + phi * m / ((1 + m) * (1 + m));
  }
  // size at which a firm with level L and coordination z produces exactly Q (m <= m0)
  function mFit(Q, L, z, phi, m0) {
    var target = Math.log(Q / L);
    function f(u) { var m = Math.exp(u); return u + (z - 1) * Math.log1p(m) + phi * m / (1 + m) - target; }
    var hi;
    if (m0 < Infinity) hi = Math.log(m0);
    else { hi = Math.max(target, 0); var tries = 0; while (f(hi) < 0 && tries++ < 200) hi += 2; }
    var lo = Math.min(target, hi) - 40;
    var u = Math.min(Math.max(target, lo), hi);
    for (var it = 0; it < 100; it++) {
      var m = Math.exp(u), om = 1 + m;
      var fv = u + (z - 1) * Math.log1p(m) + phi * m / om - target;
      if (fv > 0) hi = u; else lo = u;
      var df = 1 + (z - 1) * m / om + phi * m / (om * om);
      var un = df > 1e-9 ? u - fv / df : NaN;
      if (!(un > lo && un < hi)) un = 0.5 * (lo + hi);
      if (Math.abs(un - u) <= 1e-13 * Math.max(1, Math.abs(u))) { u = un; break; }
      u = un;
    }
    return Math.exp(u);
  }

  // ───────────────────────── trust (extension) ─────────────────────────
  // Trust is how far people act on an AI decision without checking it (0 to 1). What the AI
  // warrants is how often its call is the better one: q = L_AI / (L_AI + mean L of people).
  // Only the gap between the two matters, and only where people and AI work together:
  //   speed      mixed teams coordinate faster with more trust     z  += speed  * x * gap
  //   errors     trust beyond what is warranted lets errors in     L  *= 1 - errors * x * max(0, gap)
  //   oversight  trust short of it keeps people in the loop        human share >= oversight * max(0, -gap)
  // x = 2 h (1 - h) is the share of working pairs that join a person and an AI copy (h = human share).
  // At gap 0 every term vanishes and the model is the paper's.
  var TRUST = { speed: 0.5, errors: 1.5, oversight: 0.5 };
  function trustOf(t, q) {
    if (!t || !t.on) return null;
    var nH = 0, LH = 0;
    q.roles.forEach(function (r) { if (r.n > 0) { nH += r.n; LH += r.n * cesL(r.y1, r.y2, q.rho); } });
    if (!(nH > 0) || !(q.ai.cap > 0)) return null;      // it is about people working with AI: it needs both
    LH /= nH;
    function num(v, d, hi) { v = v == null ? d : +v; return isNaN(v) ? d : Math.min(hi, Math.max(0, v)); }
    var LM = cesL(q.ai.y1, q.ai.y2, q.rho), level = num(t.level, 0.5, 1);
    var warr = LM + LH > 0 ? LM / (LM + LH) : 0.5, gap = level - warr;
    if (Math.abs(gap) < 1e-12) gap = 0;
    var kc = num(t.kc, TRUST.speed, 1), ke = num(t.ke, TRUST.errors, 1.9), kh = num(t.kh, TRUST.oversight, 1);
    return { on: true, level: level, warranted: warr, gap: gap, kc: kc, ke: ke, kh: kh, oversight: Math.min(1, kh * Math.max(0, -gap)) };
  }
  // what one more agent of that kind does through the human-AI mix alone, per unit of headcount share:
  // dz to the firm's coordination, dl to the log of its competence
  function trustMargin(P, rc, isAI) {
    var tr = P.trust; if (!tr) return { dz: 0, dl: 0 };
    var h = 1 - (rc.sAI || 0), x = 2 * h * (1 - h), dx = isAI ? -2 * (1 - 2 * h) * h : 2 * (1 - 2 * h) * (1 - h);
    return { dz: tr.kc * tr.gap * dx, dl: tr.gap > 0 ? -tr.ke * tr.gap * dx / (1 - tr.ke * x * tr.gap) : 0 };
  }

  // ───────────────────────── intercompany (extension) ─────────────────────────
  // Links between firms work like coordination inside a firm, one level up: firms are to a network
  // what agents are to a firm. A firm with n partner firms multiplies its output per agent by
  //   H(n) = (1+n)^(zeta-1) * exp(psi * n / (1+n))          the paper's scale curve again,
  // so a network has a preferred number of partners n* = psi / (1 - zeta) - 1. Three kinds of link:
  //   goods      dividing work across firms: a share of the internal gain phi       psi  = goods * phi
  //   ip         licensing what the best people know: each task skill moves from the firm's average
  //              toward its skill-weighted average sum(s y^2) / sum(s y); the competence gained,
  //              lambda = ln L(licensed skills) - ln L(average skills), adds to psi      psi += lambda
  //   services   shared support carries the firm's own coordination across its boundary   zeta = services * z
  // A network, like a firm, cannot out-produce its market or employ more than there are.
  function interOf(t, q) {
    if (!t || !t.on || q.constReturns) return null;     // with constant returns scale does not matter, between firms either
    function num(v) { v = +v; return isNaN(v) ? 0 : Math.min(1, Math.max(0, v)); }
    return { on: true, goods: num(t.goods), services: num(t.services), ip: num(t.ip) };
  }
  // partners at which a network produces R times one firm's output:  (1+n)^zeta * exp(psi n/(1+n)) = R
  function nFit(R, zeta, psi, nMax) {
    var target = Math.log(R);
    if (!(target > 0)) return 0;
    function f(u) { return zeta * u + psi * (1 - Math.exp(-u)) - target; }   // u = ln(1+n)
    var lo = 0, hi;
    if (nMax < Infinity) hi = Math.log1p(nMax);
    else { hi = 1; var tries = 0; while (f(hi) < 0 && tries++ < 60) hi *= 2; }
    for (var it = 0; it < 80; it++) {
      var mid = 0.5 * (lo + hi);
      if (f(mid) < 0) lo = mid; else hi = mid;
      if (hi - lo <= 1e-14 * Math.max(1, hi)) break;
    }
    return Math.expm1(0.5 * (lo + hi));
  }

  // ───────────────────────── demand ─────────────────────────
  // inverse demand P(Q) = P0 (1 - Q/S)+ ; gross benefit U(Q) = integral of P
  function priceAt(mk, Q) { return Q >= mk.S ? 0 : mk.P0 * (1 - Q / mk.S); }
  function utilAt(mk, Q) { var q = Math.min(Q, mk.S); return mk.P0 * (q - q * q / (2 * mk.S)); }
  function demandAt(mk, p) { return p >= mk.P0 ? 0 : mk.S * (1 - p / mk.P0); }
  // best split of a total quantity across markets (equalise marginal value)
  function splitTotal(mks, Qtot) {
    if (mks.length === 1) return [Math.min(Qtot, mks[0].S)];
    var cap = 0, k;
    for (k = 0; k < mks.length; k++) cap += mks[k].S;
    if (Qtot >= cap) return mks.map(function (m) { return m.S; });
    var lo = 0, hi = 0;
    for (k = 0; k < mks.length; k++) hi = Math.max(hi, mks[k].P0);
    for (var it = 0; it < 70; it++) {
      var mid = 0.5 * (lo + hi), tot = 0;
      for (k = 0; k < mks.length; k++) tot += demandAt(mks[k], mid);
      if (tot > Qtot) lo = mid; else hi = mid;
    }
    var p = 0.5 * (lo + hi);
    return mks.map(function (m) { return demandAt(m, p); });
  }

  // ───────────────────────── small dense simplex ─────────────────────────
  // minimise c.x  s.t.  V x + slack - surplus = 1 (rows pre-scaled), all variables >= 0.
  // Every row starts with its slack basic (cost slackCost[r]); rows flagged in hasSurplus
  // also own a zero-cost surplus column. Returns basis, xB, duals y.
  function simplex(nR, nC, V, c, slackCost, hasSurplus, start, safe) {
    var Binv = new Float64Array(nR * nR), M = new Float64Array(nR * nR), basis = new Int32Array(nR);
    var xB = new Float64Array(nR), cB = new Float64Array(nR);
    var y = new Float64Array(nR), w = new Float64Array(nR);
    var slackIn = new Uint8Array(nR), surpIn = new Uint8Array(nR);
    var r, i, j, cScale = 1e-12, warm = false, acc, o;
    // rebuild the basis inverse and the basic solution from scratch (also used to warm start)
    function refactor() {
      var v, pr, pv, av, t1, dv, fr;
      M.fill(0); Binv.fill(0);
      for (i = 0; i < nR; i++) {
        v = basis[i];
        if (v < nC) { o = v * nR; for (r = 0; r < nR; r++) M[r * nR + i] = V[o + r]; }
        else if (v < nC + nR) M[(v - nC) * nR + i] = 1;
        else M[(v - nC - nR) * nR + i] = -1;
        Binv[i * nR + i] = 1;
      }
      for (i = 0; i < nR; i++) {
        pr = i; pv = Math.abs(M[i * nR + i]);
        for (r = i + 1; r < nR; r++) { av = Math.abs(M[r * nR + i]); if (av > pv) { pv = av; pr = r; } }
        if (pv < 1e-13) return false;
        if (pr !== i) for (j = 0; j < nR; j++) {
          t1 = M[i * nR + j]; M[i * nR + j] = M[pr * nR + j]; M[pr * nR + j] = t1;
          t1 = Binv[i * nR + j]; Binv[i * nR + j] = Binv[pr * nR + j]; Binv[pr * nR + j] = t1;
        }
        dv = M[i * nR + i];
        for (j = 0; j < nR; j++) { M[i * nR + j] /= dv; Binv[i * nR + j] /= dv; }
        for (r = 0; r < nR; r++) {
          if (r === i) continue;
          fr = M[r * nR + i];
          if (fr !== 0) for (j = 0; j < nR; j++) { M[r * nR + j] -= fr * M[i * nR + j]; Binv[r * nR + j] -= fr * Binv[i * nR + j]; }
        }
      }
      var ok = true;
      for (i = 0; i < nR; i++) {
        acc = 0; for (r = 0; r < nR; r++) acc += Binv[i * nR + r];
        if (!(acc > -1e-5)) ok = false;
        xB[i] = acc > 0 ? acc : 0;
      }
      return ok;
    }
    function setBasis(src) {
      slackIn.fill(0); surpIn.fill(0);
      for (i = 0; i < nR; i++) {
        var v = src[i]; basis[i] = v;
        if (v < nC) cB[i] = c[v];
        else if (v < nC + nR) { cB[i] = slackCost[v - nC]; slackIn[v - nC] = 1; }
        else { cB[i] = 0; surpIn[v - nC - nR] = 1; }
      }
    }
    function cold() { for (r = 0; r < nR; r++) basis[r] = nC + r; setBasis(basis); Binv.fill(0); for (r = 0; r < nR; r++) { Binv[r * nR + r] = 1; xB[r] = 1; } }
    if (start && start.length === nR && !safe) {
      var legal = true;
      for (i = 0; i < nR; i++) if (!(start[i] >= 0 && start[i] < nC + 2 * nR)) legal = false;
      if (legal) { setBasis(start); warm = refactor(); }
    }
    if (!warm) cold();
    // tolerance follows the structural costs; shortfall penalties are deliberately huge and must not loosen it
    for (j = 0; j < nC; j++) { var ac = Math.abs(c[j]); if (ac > cScale) cScale = ac; }
    var tolD = 1e-10 * cScale, maxIter = 700 + 90 * nR, blandAfter = safe ? 0 : 250 + 30 * nR;
    var iter = 0, status = 0, BLOCK = 192, scan0 = 0, sinceRef = 0;
    while (iter++ < maxIter) {
      if (++sinceRef > 24) { sinceRef = 0; if (!refactor()) { status = 3; break; } }
      for (r = 0; r < nR; r++) { acc = 0; for (i = 0; i < nR; i++) acc += cB[i] * Binv[i * nR + r]; y[r] = acc; }
      var bland = iter > blandAfter, best = -tolD, enter = -1, d;
      if (bland) {
        for (j = 0; j < nC; j++) {
          d = c[j]; o = j * nR;
          for (r = 0; r < nR; r++) d -= y[r] * V[o + r];
          if (d < best) { best = d; enter = j; break; }
        }
      } else {
        // partial pricing: scan blocks from a rotating origin, stop at the first block holding a candidate
        var seen = 0;
        j = scan0;
        while (seen < nC) {
          var end = Math.min(nC - seen, BLOCK);
          for (var q = 0; q < end; q++) {
            d = c[j]; o = j * nR;
            for (r = 0; r < nR; r++) d -= y[r] * V[o + r];
            if (d < best) { best = d; enter = j; }
            if (++j === nC) j = 0;
          }
          seen += end;
          if (enter >= 0) break;
        }
        scan0 = j;
      }
      if (!(bland && enter >= 0)) {
        for (r = 0; r < nR; r++) {
          if (!slackIn[r]) { d = slackCost[r] - y[r]; if (d < best) { best = d; enter = nC + r; if (bland) break; } }
          if (hasSurplus[r] && !surpIn[r]) { d = y[r]; if (d < best) { best = d; enter = nC + nR + r; if (bland) break; } }
        }
      }
      if (enter < 0) { status = 1; break; }
      var r0, wAbs = 0;
      if (enter < nC) {
        o = enter * nR;
        for (i = 0; i < nR; i++) { acc = 0; for (r = 0; r < nR; r++) acc += Binv[i * nR + r] * V[o + r]; w[i] = acc; }
      } else if (enter < nC + nR) { r0 = enter - nC; for (i = 0; i < nR; i++) w[i] = Binv[i * nR + r0]; }
      else { r0 = enter - nC - nR; for (i = 0; i < nR; i++) w[i] = -Binv[i * nR + r0]; }
      for (i = 0; i < nR; i++) { var aw = Math.abs(w[i]); if (aw > wAbs) wAbs = aw; }
      // never pivot on numerical noise: the pivot must be meaningful next to the column's largest entry
      var tolP = Math.max(1e-12, 1e-9 * wAbs), leave = -1, minR = Infinity, wmax = 0, ratio;
      for (i = 0; i < nR; i++) {
        if (w[i] > tolP) {
          ratio = xB[i] / w[i];
          if (ratio < minR - 1e-13) { minR = ratio; leave = i; wmax = w[i]; }
          else if (ratio <= minR + 1e-13) {
            if (bland ? basis[i] < basis[leave] : w[i] > wmax) { leave = i; wmax = w[i]; if (ratio < minR) minR = ratio; }
          }
        }
      }
      if (leave < 0) { status = 2; break; }
      var piv = w[leave], lo = leave * nR;
      for (r = 0; r < nR; r++) Binv[lo + r] /= piv;
      for (i = 0; i < nR; i++) {
        if (i === leave) continue;
        var fct = w[i];
        if (fct !== 0) {
          var io = i * nR;
          for (r = 0; r < nR; r++) Binv[io + r] -= fct * Binv[lo + r];
          xB[i] -= fct * minR; if (xB[i] < 0) xB[i] = 0;
        }
      }
      xB[leave] = minR;
      var old = basis[leave];
      if (old >= nC + nR) surpIn[old - nC - nR] = 0; else if (old >= nC) slackIn[old - nC] = 0;
      basis[leave] = enter;
      if (enter >= nC + nR) surpIn[enter - nC - nR] = 1; else if (enter >= nC) slackIn[enter - nC] = 1;
      cB[leave] = enter < nC ? c[enter] : (enter < nC + nR ? slackCost[enter - nC] : 0);
    }
    // settle on exact values: recompute the solution from the final basis and check it
    if (status === 1 && !refactor()) status = 3;
    for (r = 0; r < nR; r++) { var a2 = 0; for (i = 0; i < nR; i++) a2 += cB[i] * Binv[i * nR + r]; y[r] = a2; }
    var obj = 0;
    for (i = 0; i < nR; i++) obj += cB[i] * xB[i];
    return { basis: basis, xB: xB, y: y, obj: obj, status: status, iter: iter, warm: warm };
  }
  // one retry from a cold start with Bland's rule if the fast path did not end cleanly
  function simplexSafe(nR, nC, V, c, slackCost, hasSurplus, start) {
    var lp = simplex(nR, nC, V, c, slackCost, hasSurplus, start, false);
    if (lp.status !== 1) lp = simplex(nR, nC, V, c, slackCost, hasSurplus, null, true);
    return lp;
  }

  function golden(f, a, b, iters) {
    var gr = 0.6180339887498949, c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
    for (var i = 0; i < iters; i++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
    }
    return fc > fd ? { x: c, f: fc } : { x: d, f: fd };
  }

  // ───────────────────────── problem context ─────────────────────────
  function normalize(P) {
    var rules = P.rules || {};
    var q = {
      roles: (P.roles || []).map(function (ro) {
        // a leading role (an extension): one per firm; a leader whose firm is absorbed works on as a coordinator
        var lead = !!ro.lead, dys = +ro.demoteYs;
        return { name: ro.name, n: Math.max(0, +ro.n || 0), y1: Math.max(0.01, +ro.y1), y2: Math.max(0.01, +ro.y2), ys: Math.max(0, +ro.ys), lead: lead, demoteYs: lead ? (isNaN(dys) ? 0.97 : Math.max(0, dys)) : 0 };
      }),
      ai: { cap: Math.max(0, P.ai ? +P.ai.cap : 0), y1: Math.max(0.01, P.ai ? +P.ai.y1 : 1), y2: Math.max(0.01, P.ai ? +P.ai.y2 : 1), ys: Math.max(0, P.ai ? +P.ai.ys : 0) },
      w: Math.max(1e-6, +P.w), r: Math.max(1e-6, +P.r),
      rho: Math.min(0.95, +P.rho), phi: Math.max(1e-4, +P.phi), constReturns: !!P.constReturns,
      markets: (P.markets || []).filter(function (m) { return m && m.S > 0 && m.P0 > 0; }).map(function (m) { return { P0: +m.P0, S: +m.S, name: m.name }; }),
      rules: {
        size: rules.size || 'free', sizeValue: Math.max(1e-3, +rules.sizeValue || 1),
        mixed: rules.mixed !== false, mosaic: rules.mosaic !== false,
        minHuman: Math.min(1, Math.max(0, +rules.minHuman || 0))
      }
    };
    if (isNaN(q.ai.cap)) q.ai.cap = 0;
    // the rule the user set, and the share people insist on when they trust the AI less than it warrants
    if (rules.minHumanRule != null) q.rules.minHuman = Math.min(1, Math.max(0, +rules.minHumanRule || 0));
    q.rules.minHumanRule = q.rules.minHuman;
    q.trust = trustOf(P.trust, q);
    if (q.trust && q.trust.oversight > q.rules.minHuman) q.rules.minHuman = q.trust.oversight;
    q.inter = interOf(P.inter, q);
    return q;
  }

  function makeContext(P) {
    var C = { P: P, rho: P.rho, phi: P.phi, constRet: P.constReturns, rules: P.rules, mks: P.markets, nM: P.markets.length, tr: P.trust || null, ic: P.inter || null };
    var maxAI = 1 - P.rules.minHuman;
    var types = [];
    var iLead = -1, iComp = -1;
    P.roles.forEach(function (ro, i) {
      if (!(ro.n > 0)) return;
      types.push({ kind: 0, role: i, y1: ro.y1, y2: ro.y2, ys: ro.ys, sup: ro.n, cost: P.w });
      if (ro.lead && iLead < 0 && !P.constReturns) {            // the same people, working as coordinators: they share the leaders' headcount
        iLead = types.length - 1; iComp = types.length;
        types.push({ kind: 0, role: i, y1: ro.y1, y2: ro.y2, ys: Math.min(ro.ys, ro.demoteYs), sup: Infinity, cost: P.w });
      }
    });
    if (P.ai.cap > 0 && maxAI > 1e-9) types.push({ kind: 1, role: -1, y1: P.ai.y1, y2: P.ai.y2, ys: P.ai.ys, sup: P.ai.cap, cost: P.r });
    C.types = types; C.T = types.length; C.maxAI = maxAI;
    C.iAI = -1; C.iLead = iLead; C.iComp = iComp;
    var T = C.T;
    C.Y1 = new Float64Array(T); C.Y2 = new Float64Array(T); C.YS = new Float64Array(T);
    C.SUP = new Float64Array(T); C.COST = new Float64Array(T);
    for (var t = 0; t < T; t++) {
      C.Y1[t] = types[t].y1; C.Y2[t] = types[t].y2; C.YS[t] = types[t].ys; C.SUP[t] = types[t].sup; C.COST[t] = types[t].cost;
      if (types[t].kind === 1) C.iAI = t;
    }
    C.nR = C.nM + T;
    C.cap = 0; C.nC = 0;
    C.S = null; C.V = null; C.mk = null; C.c0 = null; C.Lc = null; C.zc = null;
    C.af = null; C.qf = null; C.n0 = null; C.zt = null; C.ps = null; C.n = null; C.ns0 = null; C.ns = null;
    C.m0 = null; C.a0 = null; C.q0 = null; C.st0 = null; C.a = null; C.m = null; C.st = null;
    C.Qs = new Float64Array(C.nM);
    return C;
  }

  function prefSize(C, z) {
    switch (C.rules.size) {
      case 'solo': return 1;
      case 'fixed': return C.rules.sizeValue;
      case 'cap': return Math.min(mStar(z, C.phi), C.rules.sizeValue);
      default: return mStar(z, C.phi);
    }
  }

  // evaluation scratch (avoids allocation in hot loops)
  var E = { y1: 0, y2: 0, z: 0, L: 0, z0: 0, L0: 0, tx: 0, c0: 0, m0: 0, a0: 0, q0: 0, st0: 0, a: 0, m: 0, st: 0,
    af: 0, qf: 0, n0: 0, n: 0, ns0: 0, ns: 0, zeta: 0, psi: 0, lam: 0, c1: 0, c2: 0 };

  // composition -> level, coordination, unit resource cost, and its size before the market cap
  function evalBase(C, s, off) {
    var T = C.T, y1 = 0, y2 = 0, z = 0, c0 = 0, staff = Infinity, q1 = 0, q2 = 0;
    for (var t = 0; t < T; t++) {
      var st = s[off + t];
      if (st > 0) {
        y1 += st * C.Y1[t]; y2 += st * C.Y2[t]; z += st * C.YS[t]; c0 += st * C.COST[t];
        q1 += st * C.Y1[t] * C.Y1[t]; q2 += st * C.Y2[t] * C.Y2[t];
        if (t !== C.iLead && t !== C.iComp) { var cp = C.SUP[t] / st; if (cp < staff) staff = cp; }
      }
    }
    var sLead = C.iLead >= 0 ? s[off + C.iLead] : 0, sPool = sLead + (C.iComp >= 0 ? s[off + C.iComp] : 0);
    if (sPool > 0 && C.SUP[C.iLead] / sPool < staff) staff = C.SUP[C.iLead] / sPool;
    var L = cesL(y1, y2, C.rho);
    E.z0 = z; E.L0 = L; E.tx = 0;                  // the plain means, before trust
    if (C.tr && C.iAI >= 0) {
      var sa = s[off + C.iAI];
      if (sa > 0 && sa < 1) {
        var tx = 2 * sa * (1 - sa), gap = C.tr.gap;
        E.tx = tx;
        z += C.tr.kc * tx * gap; if (z < 0) z = 0;
        if (gap > 0) L *= 1 - C.tr.ke * tx * gap;
      }
    }
    E.y1 = y1; E.y2 = y2; E.z = z; E.L = L; E.c0 = c0;
    E.n0 = 0; E.ns0 = NS_NONE; E.zeta = 0; E.psi = 0; E.lam = 0; E.c1 = y1; E.c2 = y2;
    if (C.constRet) { E.m0 = 0; E.a0 = L; E.q0 = 0; E.af = L; E.qf = 0; E.st0 = ST_ATOM; return; }
    var pref = prefSize(C, z), ms = mStar(z, C.phi), st0;
    if (pref === 0) st0 = ST_ATOM;
    else if (C.rules.size === 'free' || (C.rules.size === 'cap' && ms <= C.rules.sizeValue)) st0 = ST_PREF;
    else st0 = ST_RULE;
    var m0 = pref;
    // a size fixed by rule leaves no room for the leader to set it: there the leading role is an ordinary one
    var led = sLead > 1e-12 && C.rules.size !== 'solo' && C.rules.size !== 'fixed';
    if (led) {                                     // exactly one leader: the leader's share sets the size
      m0 = 1 / sLead; st0 = ST_LEAD;
      if (C.rules.size === 'cap' && m0 > C.rules.sizeValue * (1 + 1e-9)) {   // a led firm obeys the size limit like any other
        E.m0 = m0; E.st0 = st0; E.a0 = 0; E.q0 = 0; E.af = 0; E.qf = 0; return;
      }
      if (staff < m0 * (1 - 1e-9)) {                // not enough of someone to complete the firm around its leader: no such firm
        E.m0 = m0; E.st0 = st0; E.a0 = 0; E.q0 = 0; E.af = 0; E.qf = 0; return;
      }
    }
    if (staff < m0) { m0 = staff; st0 = led ? ST_LEAD : ST_STAFF; }
    E.m0 = m0; E.st0 = st0;
    if (m0 === Infinity) { E.a0 = Infinity; E.q0 = Infinity; }
    else { E.a0 = L * gScale(m0, z, C.phi); E.q0 = m0 * E.a0; }
    E.af = E.a0; E.qf = E.q0;                      // the firm on its own
    if (C.ic && m0 > 0 && m0 < Infinity) {
      var ic = C.ic, lam = 0;
      if (ic.ip > 0 && y1 > 0 && y2 > 0) {
        E.c1 = q1 / y1; E.c2 = q2 / y2;            // skill-weighted average skill: what the firm's best know
        var Lt = cesL(y1 + ic.ip * (E.c1 - y1), y2 + ic.ip * (E.c2 - y2), C.rho);
        if (Lt > E.L0 && E.L0 > 0) lam = Math.log(Lt / E.L0);
      }
      var psi = ic.goods * C.phi + lam, zeta = ic.services * z;
      E.lam = lam; E.psi = psi; E.zeta = zeta;
      var n0 = psi > 0 ? mStar(zeta, psi) : 0, ns0 = n0 > 0 ? NS_PREF : NS_NONE;
      if (n0 > 0 && (1 + n0) * m0 > staff) {
        // too few people for the preferred network. Where firms choose their size, smaller firms leave
        // room for more partners: size and partners are chosen together. A size set by rule stays.
        if (C.rules.size !== 'fixed' && C.rules.size !== 'solo' && !led) {
          var phi = C.phi, lnS = Math.log(staff), uLo = n0 < Infinity ? Math.log(staff / (1 + n0)) : Math.log(m0) - 12, uHi = Math.log(m0);
          var val = function (u) { var mm = Math.exp(u), nn = Math.max(0, Math.exp(lnS - u) - 1); return (z - 1) * Math.log1p(mm) + phi * mm / (1 + mm) + (zeta - 1) * Math.log1p(nn) + psi * nn / (1 + nn); };
          var gb = golden(val, uLo, uHi, 28), bu = gb.x, bf = gb.f, fl = val(uLo), fh = val(uHi);
          if (fl > bf) { bf = fl; bu = uLo; }
          if (fh >= bf) { bf = fh; bu = uHi; }
          if (bu < uHi) { m0 = Math.exp(bu); E.m0 = m0; E.st0 = ST_STAFF; E.af = L * gScale(m0, z, phi); E.qf = m0 * E.af; }
        }
        n0 = Math.max(0, staff / m0 - 1); ns0 = n0 > 1e-12 ? NS_STAFF : NS_NONE; if (ns0 === NS_NONE) n0 = 0;
      }
      E.n0 = n0; E.ns0 = ns0;
      if (n0 === Infinity) { E.a0 = Infinity; E.q0 = Infinity; }
      else if (n0 > 0) { E.a0 = E.af * gScale(n0, zeta, psi); E.q0 = (1 + n0) * m0 * E.a0; }
    }
  }
  // apply the market-fit cap: a complete firm cannot out-produce its market
  function applyCap(C, Qk) {
    if (E.qf > Qk && E.L > 0) {
      E.m = E.st0 === ST_LEAD ? E.m0 : mFit(Qk, E.L, E.z, C.phi, E.m0);   // a led firm keeps its one leader and its size
      E.a = Qk / E.m; E.st = ST_MARKET; E.n = 0; E.ns = NS_NONE;
    } else if (E.q0 > Qk) {                        // the firm fits but its network would not: fewer partners
      E.n = nFit(Qk / E.qf, E.zeta, E.psi, E.n0); E.ns = NS_MARKET;
      E.m = E.m0; E.a = E.af * gScale(E.n, E.zeta, E.psi); E.st = E.st0;
    } else { E.m = E.m0; E.a = E.a0; E.st = E.st0; E.n = E.n0; E.ns = E.ns0; }
  }

  function growCols(C, need) {
    if (need <= C.cap) return;
    var cap = Math.max(256, C.cap * 2, need), T = C.T, nR = C.nR;
    function g64(old, n) { var a = new Float64Array(n); if (old) a.set(old.subarray(0, Math.min(old.length, n))); return a; }
    function g8(old, n) { var a = new Uint8Array(n); if (old) a.set(old.subarray(0, Math.min(old.length, n))); return a; }
    C.S = g64(C.S, cap * T); C.V = g64(C.V, cap * nR);
    C.mk = g8(C.mk, cap); C.st0 = g8(C.st0, cap); C.st = g8(C.st, cap);
    C.c0 = g64(C.c0, cap); C.Lc = g64(C.Lc, cap); C.zc = g64(C.zc, cap);
    C.m0 = g64(C.m0, cap); C.a0 = g64(C.a0, cap); C.q0 = g64(C.q0, cap);
    C.a = g64(C.a, cap); C.m = g64(C.m, cap);
    C.af = g64(C.af, cap); C.qf = g64(C.qf, cap); C.n0 = g64(C.n0, cap); C.zt = g64(C.zt, cap); C.ps = g64(C.ps, cap);
    C.n = g64(C.n, cap); C.ns0 = g8(C.ns0, cap); C.ns = g8(C.ns, cap);
    C.cap = cap;
  }

  function validComp(C, s, off) {
    var T = C.T, nH = 0, sAI = 0, sum = 0;
    for (var t = 0; t < T; t++) {
      var v = s[off + t];
      if (v < -1e-12) return false;
      if (v > 1e-12) { if (t === C.iAI) sAI = v; else nH++; }
      sum += v;
    }
    if (!(Math.abs(sum - 1) <= 1e-9)) return false;   // also turns away a share that is not a number
    if (sAI > C.maxAI + 1e-9) return false;
    if (sAI > 1e-12 && nH > 0 && !C.rules.mixed) return false;
    if (nH > 1 && !C.rules.mosaic) return false;
    if (C.rules.size === 'solo' && nH + (sAI > 1e-12 ? 1 : 0) !== 1) return false;
    return true;
  }

  // add one composition as a column in every market
  function addComp(C, s) {
    var T = C.T, nR = C.nR, nM = C.nM, t, k;
    if (!validComp(C, s, 0)) return -1;
    growCols(C, C.nC + nM);
    var first = C.nC;
    for (k = 0; k < nM; k++) {
      var j = C.nC++;
      for (t = 0; t < T; t++) C.S[j * T + t] = s[t] > 1e-12 ? s[t] : 0;
      evalBase(C, C.S, j * T);
      C.mk[j] = k; C.c0[j] = E.c0; C.Lc[j] = E.L; C.zc[j] = E.z;
      C.m0[j] = E.m0; C.a0[j] = E.a0; C.q0[j] = E.q0; C.st0[j] = E.st0;
      C.af[j] = E.af; C.qf[j] = E.qf; C.n0[j] = E.n0; C.zt[j] = E.zeta; C.ps[j] = E.psi; C.ns0[j] = E.ns0;
      var o = j * nR;
      for (t = 0; t < nR; t++) C.V[o + t] = 0;
      for (t = 0; t < T; t++) C.V[o + nM + t] = C.SUP[t] < Infinity ? C.S[j * T + t] / C.SUP[t] : 0;
      if (C.iComp >= 0) C.V[o + nM + C.iLead] += C.S[j * T + C.iComp] / C.SUP[C.iLead];
      // provisional output coefficient; setQ overwrites
      C.a[j] = E.a0; C.m[j] = E.m0; C.st[j] = E.st0; C.n[j] = E.n0; C.ns[j] = E.ns0;
    }
    return first;
  }

  var PAIR_GRID = [0.01, 0.03, 0.06, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.94, 0.97, 0.99];

  function buildMenu(C) {
    var T = C.T, iAI = C.iAI, maxAI = C.maxAI, R = C.rules, s = new Float64Array(T), a, b, c, d, i, t;
    function reset() { for (t = 0; t < T; t++) s[t] = 0; }
    // set shares for a support; an AI share is scaled into (0, maxAI]
    function put(idx, sh) {
      reset();
      var aiPos = -1, q;
      for (q = 0; q < idx.length; q++) if (idx[q] === iAI) aiPos = q;
      if (aiPos >= 0 && maxAI < 1) {
        var sa = sh[aiPos] * maxAI, rest = 1 - sh[aiPos];
        // with the AI at its limit the people take the remaining share (evenly, when their own shares are all zero)
        for (q = 0; q < idx.length; q++) s[idx[q]] = q === aiPos ? sa : (rest > 0 ? sh[q] / rest : 1 / (idx.length - 1)) * (1 - sa);
      } else for (q = 0; q < idx.length; q++) s[idx[q]] = sh[q];
      addComp(C, s);
    }
    for (a = 0; a < T; a++) put([a], [1]);
    if (R.size === 'solo') return;
    for (a = 0; a < T; a++) for (b = a + 1; b < T; b++) {
      for (i = 0; i < PAIR_GRID.length; i++) put([a, b], [1 - PAIR_GRID[i], PAIR_GRID[i]]);
      if (b === iAI && maxAI < 1) put([a, b], [0, 1]); // boundary: AI share exactly at the mandate limit
    }
    var G = 6, x, y2, z2, w2;
    if (T >= 3) for (a = 0; a < T; a++) for (b = a + 1; b < T; b++) for (c = b + 1; c < T; c++)
      for (x = 1; x < G; x++) for (y2 = 1; x + y2 < G; y2++) { z2 = G - x - y2; put([a, b, c], [x / G, y2 / G, z2 / G]); }
    if (T >= 4) for (a = 0; a < T; a++) for (b = a + 1; b < T; b++) for (c = b + 1; c < T; c++) for (d = c + 1; d < T; d++)
      for (x = 1; x < G; x++) for (y2 = 1; x + y2 < G; y2++) for (z2 = 1; x + y2 + z2 < G; z2++) { w2 = G - x - y2 - z2; put([a, b, c, d], [x / G, y2 / G, z2 / G, w2 / G]); }
  }

  // refresh every column's average product at the current market outputs
  function setQ(C, Qs) {
    var nC = C.nC, nR = C.nR, j, k;
    for (k = 0; k < C.nM; k++) C.Qs[k] = Math.max(Qs[k], 1e-9 * C.mks[k].S);
    for (j = 0; j < nC; j++) {
      k = C.mk[j];
      var Qk = C.Qs[k];
      if (C.qf[j] > Qk && C.Lc[j] > 0) {
        var mf = C.st0[j] === ST_LEAD ? C.m0[j] : mFit(Qk, C.Lc[j], C.zc[j], C.phi, C.m0[j]);
        C.m[j] = mf; C.a[j] = Qk / mf; C.st[j] = ST_MARKET; C.n[j] = 0; C.ns[j] = NS_NONE;
      } else if (C.q0[j] > Qk) {
        var nf = nFit(Qk / C.qf[j], C.zt[j], C.ps[j], C.n0[j]);
        C.m[j] = C.m0[j]; C.a[j] = C.af[j] * gScale(nf, C.zt[j], C.ps[j]); C.st[j] = C.st0[j]; C.n[j] = nf; C.ns[j] = NS_MARKET;
      } else { C.m[j] = C.m0[j]; C.a[j] = C.a0[j]; C.st[j] = C.st0[j]; C.n[j] = C.n0[j]; C.ns[j] = C.ns0[j]; }
      C.V[j * nR + k] = C.a[j] / Qk;
    }
  }

  // least resource cost of producing Qs (shortfall allowed at a punitive price)
  function costLP(C) {
    var nR = C.nR, nM = C.nM, k, r;
    var slackCost = new Float64Array(nR), hasSur = new Uint8Array(nR);
    for (k = 0; k < nM; k++) { slackCost[k] = 3 * C.mks[k].P0 * C.Qs[k]; hasSur[k] = 1; }
    var lp = simplexSafe(nR, C.nC, C.V, C.c0, slackCost, hasSur, C.warm);
    if (lp.status === 1) C.warm = lp.basis;
    else {                                           // no clean optimum: price the whole output as shortfall so the search steps away
      C.warm = null; lp.obj = 0;
      for (k = 0; k < nM; k++) lp.obj += slackCost[k];
      lp.failed = true;
    }
    C.nLP = (C.nLP || 0) + 1; C.nIt = (C.nIt || 0) + lp.iter;
    var short = new Float64Array(nM), penalty = 0;
    for (r = 0; r < nR; r++) {
      var b = lp.basis[r];
      if (b >= C.nC && b < C.nC + nM) { short[b - C.nC] = lp.xB[r]; penalty += slackCost[b - C.nC] * lp.xB[r]; }
    }
    lp.short = short; lp.penalty = penalty;
    return lp;
  }
  // profit-maximising supply at given prices, with an output ceiling per market
  function supplyLP(C, prices, caps) {
    var T = C.T, nM = C.nM, nC = C.nC, nR2 = T + nM, j, t, k;
    var V2 = new Float64Array(nC * nR2), c2 = new Float64Array(nC);
    for (j = 0; j < nC; j++) {
      k = C.mk[j];
      for (t = 0; t < T; t++) V2[j * nR2 + t] = C.V[j * C.nR + nM + t];
      V2[j * nR2 + T + k] = C.a[j] / caps[k];
      c2[j] = C.c0[j] - prices[k] * C.a[j];
    }
    return simplexSafe(nR2, nC, V2, c2, new Float64Array(nR2), new Uint8Array(nR2), null);
  }
  function totalU(C, Qs) { var u = 0; for (var k = 0; k < C.nM; k++) u += utilAt(C.mks[k], Qs[k]); return u; }
  function evalW(C, Qs) { setQ(C, Qs); var lp = costLP(C); return totalU(C, Qs) - lp.obj; }

  // largest output the resources can deliver (columns valued at their most favourable scale)
  function maxOutput(C) {
    var k, t, Qs = [], ones = [], caps = [];
    for (t = 0; t < C.T; t++) if (!(C.SUP[t] < Infinity) && t !== C.iComp) return Infinity;
    for (k = 0; k < C.nM; k++) { Qs.push(C.mks[k].S); ones.push(1); caps.push(C.mks[k].S); }
    setQ(C, Qs);
    var keep = C.c0; C.c0 = new Float64Array(C.nC);
    var lp = supplyLP(C, ones, caps);
    C.c0 = keep;
    return -lp.obj;
  }

  // ───────────────────────── outer search over output ─────────────────────────
  function searchLine(f, lo, hi, G, iters) {
    var bestI = -1, bestF = -Infinity, xs = [], i;
    for (i = 1; i <= G; i++) { var x = lo + (hi - lo) * i / G; xs.push(x); var v = f(x); if (v > bestF) { bestF = v; bestI = i - 1; } }
    var a = bestI > 0 ? xs[bestI - 1] : lo, b = bestI < G - 1 ? xs[bestI + 1] : hi;
    var g = golden(f, a, b, iters);
    return g.f >= bestF ? g : { x: xs[bestI], f: bestF };
  }
  function eqSplit(C, Qtot, delta) {
    var q = splitTotal(C.mks, Qtot);
    if (C.nM === 2 && delta) {
      var d = delta * Qtot, q0 = Math.min(Math.max(q[0] + d, 0), Math.min(C.mks[0].S, Qtot));
      var q1 = Qtot - q0; if (q1 > C.mks[1].S) { q1 = C.mks[1].S; q0 = Qtot - q1; }
      q = [q0, q1];
    }
    return q;
  }
  function searchQ(C, hint) {
    var cap = 0, k; for (k = 0; k < C.nM; k++) cap += C.mks[k].S;
    var qmax = maxOutput(C), hi = Math.min(cap, qmax * (1 + 1e-7));
    if (!(hi > 0)) return null;
    var delta = hint ? hint.delta : 0, lo = 1e-9 * hi, res;
    function fTot(Q) { return evalW(C, eqSplit(C, Q, delta)); }
    if (hint && hint.Qtot > 0) {
      var wdt = hint.tight ? 0.004 : 0.25;
      var a = Math.max(lo, hint.Qtot * (1 - wdt)), b = Math.min(hi, hint.Qtot * (1 + 1.2 * wdt));
      res = hint.tight ? golden(fTot, a, b, 22) : searchLine(fTot, a, b, 6, 20);
      if (hint.tight) return { Qtot: res.x, delta: delta, W: res.f, hi: hi };
    } else res = searchLine(fTot, lo, hi, 28, 26);
    var Qtot = res.x, W = res.f;
    if (C.nM === 2) {
      for (var round = 0; round < (hint ? 1 : 2); round++) {
        var qe = splitTotal(C.mks, Qtot);
        var dLo = (Math.max(0, Qtot - C.mks[1].S) - qe[0]) / Qtot, dHi = (Math.min(C.mks[0].S, Qtot) - qe[0]) / Qtot;
        if (dHi - dLo > 1e-9) {
          var rd = searchLine(function (dd) { return evalW(C, eqSplit(C, Qtot, dd)); }, dLo, dHi, 14, 20);
          if (rd.f > W + 1e-12) { W = rd.f; delta = rd.x; }
        }
        var r2 = searchLine(fTot, Math.max(lo, Qtot * 0.7), Math.min(hi, Qtot * 1.4), 8, 22);
        if (r2.f > W + 1e-12) { W = r2.f; Qtot = r2.x; } else break;
      }
    }
    return { Qtot: Qtot, delta: delta, W: W, hi: hi };
  }

  // ───────────────────────── duals (prices and wages) ─────────────────────────
  // Internal prices and resource rents at the current outputs. At a capacity kink the
  // supporting price is not unique (paper, Theorem 4 iii); we take the competitive
  // selection p = P(Q): firms maximise profit at the demand price and scarce inputs earn the rent.
  function marketOut(C, act) {
    var q = new Float64Array(C.nM);
    for (var i = 0; i < act.length; i++) q[C.mk[act[i].j]] += act[i].x * C.a[act[i].j];
    return q;
  }
  function dualsAt(C, Qs, settle) {
    setQ(C, Qs);
    var lp = costLP(C), nM = C.nM, T = C.T, k, t;
    var Qa = new Float64Array(nM), pc = new Float64Array(nM), Pd = new Float64Array(nM), kink = false, above = false, totA = 0;
    function isShort(q) { return lp.short[q] > 1e-9 || pc[q] > 2.5 * C.mks[q].P0; }
    function isAbove(q) { return !isShort(q) && pc[q] > Pd[q] * (1 + 1e-3); }
    for (k = 0; k < nM; k++) {
      Qa[k] = C.Qs[k] * (1 - lp.short[k]); totA += Qa[k];
      pc[k] = lp.y[k] / C.Qs[k]; Pd[k] = priceAt(C.mks[k], Qa[k]);
      // short of capacity, priced at the shortfall penalty, or cheaper than buyers would pay: a kink in cost
      if (isShort(k) || pc[k] < Pd[k] * (1 - 2e-5) - 1e-12) kink = true;
      // the next unit would cost more than buyers pay: either a recipe at the margin (no kink), or a
      // kink where the cost side reported the far slope, set by a recipe that is not in use
      if (isAbove(k)) above = true;
    }
    var out = { Qa: Qa, Pd: Pd, p: new Float64Array(nM), pi: new Float64Array(T), kink: false, act: activeCols(C, lp), above: above, short: lp.short };
    function useOf(act) {
      var u = new Float64Array(T);
      for (var i = 0; i < act.length; i++) for (var q = 0; q < T; q++) u[q] += act[i].x * C.S[act[i].j * T + q];
      return u;
    }
    // profit-maximising supply at the demand price; `strict` also prices the markets found "above" at the
    // demand price and then accepts only if that supply is the very industry the cost side found
    function atDemandPrice(strict) {
      var caps = [], Qe = [], ps = [], q, slack = strict ? 1e-6 : 1e-4;   // strict: leave no room for output to drift between markets
      for (q = 0; q < nM; q++) {
        var qk = Math.max(Qa[q], 1e-9 * C.mks[q].S);
        caps.push(Math.min(C.mks[q].S, qk * (1 + slack))); Qe.push(qk * (1 + 0.1 * slack));
        // a market at its capacity sells at the demand price; elsewhere active firms must still break even
        ps.push(isShort(q) || (strict && isAbove(q)) ? Pd[q] : Math.max(Pd[q], pc[q]));
      }
      setQ(C, Qe);                                    // a firm that is the whole market still fits it
      var sl = supplyLP(C, ps, caps);
      if (sl.status !== 1) return false;
      var act2 = activeCols(C, sl), Qs2 = marketOut(C, act2), tot2 = 0;
      for (q = 0; q < nM; q++) tot2 += Qs2[q];
      if (!(tot2 >= totA * (1 - 1e-3))) return false;  // supply must meet the output found
      if (strict) {                                    // the same industry: every market's output and every input's use
        var room = 0; for (q = 0; q < nM; q++) room += caps[q] - Qa[q];     // output the ceilings let drift between markets
        for (q = 0; q < nM; q++) if (Math.abs(Qs2[q] - Qa[q]) > 1e-2 * Qa[q] + 1.01 * room) return false;
        var u1 = useOf(out.act), u2 = useOf(act2), tot = 0;
        for (q = 0; q < T; q++) tot += u1[q];
        // up to the little by which the output search can overshoot the kink
        for (q = 0; q < T; q++) if (Math.abs(u1[q] - u2[q]) > 1e-3 * u1[q] + 3e-4 * tot + 1e-3) return false;
      }
      out.kink = true; out.act = act2; out.Qa = Qs2;
      for (q = 0; q < nM; q++) out.p[q] = ps[q] - Math.max(0, -sl.y[T + q] / caps[q]);
      for (q = 0; q < T; q++) out.pi[q] = C.SUP[q] < Infinity ? Math.max(0, -sl.y[q] / C.SUP[q]) : 0;
      if (C.iComp >= 0) out.pi[C.iComp] = out.pi[C.iLead];
      return true;
    }
    // only when the final prices are read: the search for recipes keeps the cost-side prices
    if (settle && above && atDemandPrice(true)) return out;
    if (kink && atDemandPrice(false)) return out;
    if (above || kink) setQ(C, Qs);
    for (k = 0; k < nM; k++) out.p[k] = pc[k];
    for (t = 0; t < T; t++) out.pi[t] = C.SUP[t] < Infinity ? Math.max(0, -lp.y[nM + t] / C.SUP[t]) : 0;
    if (C.iComp >= 0) out.pi[C.iComp] = out.pi[C.iLead];
    return out;
  }

  // ───────────────────────── column generation (polish) ─────────────────────────
  function moveSet(C, s) {
    var T = C.T, iAI = C.iAI, hum = [], t, R = C.rules, out = [];
    for (t = 0; t < T; t++) if (t !== iAI && s[t] > 1e-12) hum.push(t);
    var hasAI = iAI >= 0 && s[iAI] > 1e-12;
    if (R.size === 'solo') return out;
    if (R.mosaic && R.mixed) { for (t = 0; t < T; t++) out.push(t); return out; }
    if (R.mosaic && !R.mixed) { if (hasAI) return out; for (t = 0; t < T; t++) if (t !== iAI) out.push(t); return out; }
    if (!R.mosaic && R.mixed) { if (hum.length === 1 && iAI >= 0) { out.push(hum[0]); out.push(iAI); } return out; }
    return out;
  }
  // maximise p*a(s) - cost(s) by pairwise share transfers
  function localSearch(C, s, k, p, eff) {
    var T = C.T, Qk = C.Qs[k], set = moveSet(C, s), iAI = C.iAI, maxAI = C.maxAI, t;
    function psi() {
      evalBase(C, s, 0); applyCap(C, Qk);
      var c = 0; for (var q = 0; q < T; q++) c += s[q] * eff[q];
      return p * E.a - c;
    }
    var cur = psi();
    if (set.length < 2) return cur;
    for (var sweep = 0; sweep < 8; sweep++) {
      var improved = false;
      for (var ia = 0; ia < set.length; ia++) for (var ib = ia + 1; ib < set.length; ib++) {
        var a = set[ia], b = set[ib], sa = s[a], sb = s[b];
        var lo = -sb, hi = sa;                       // move delta from a to b
        if (b === iAI) hi = Math.min(hi, maxAI - sb);
        if (a === iAI) lo = Math.max(lo, sa - maxAI);
        if (hi - lo < 1e-10) continue;
        var g = golden(function (dl) { s[a] = sa - dl; s[b] = sb + dl; return psi(); }, lo, hi, 26);
        // also test the ends: optima often sit on the boundary of the simplex
        s[a] = sa - lo; s[b] = sb + lo; var fl = psi();
        s[a] = sa - hi; s[b] = sb + hi; var fh = psi();
        var bx = g.x, bf = g.f;
        if (fl > bf) { bf = fl; bx = lo; }
        if (fh > bf) { bf = fh; bx = hi; }
        if (bf > cur + 1e-13 * Math.max(1, Math.abs(cur))) {
          s[a] = sa - bx; s[b] = sb + bx;
          if (s[a] < 1e-12) s[a] = 0; if (s[b] < 1e-12) s[b] = 0;
          if (Math.abs(bf - cur) > 1e-11 * Math.max(1, Math.abs(cur))) improved = true;
          cur = bf;
        } else { s[a] = sa; s[b] = sb; }
      }
      if (!improved) break;
    }
    var sum = 0; for (t = 0; t < T; t++) sum += s[t];
    for (t = 0; t < T; t++) s[t] /= sum;
    return cur;
  }
  function activeCols(C, lp) {
    var out = [];
    for (var r = 0; r < lp.basis.length; r++) if (lp.basis[r] < C.nC && lp.xB[r] > 1e-10) out.push({ j: lp.basis[r], x: lp.xB[r] });
    return out;
  }
  function hasComp(C, s, k, tol) {
    var T = C.T;
    for (var j = 0; j < C.nC; j++) {
      if (C.mk[j] !== k) continue;
      var d = 0; for (var t = 0; t < T; t++) d += Math.abs(C.S[j * T + t] - s[t]);
      if (d < tol) return true;
    }
    return false;
  }
  function polish(C, Qs) {
    var T = C.T, nM = C.nM, added = 0, t, k, j;
    var D = dualsAt(C, Qs);
    var eff = new Float64Array(T);
    for (t = 0; t < T; t++) eff[t] = C.COST[t] + D.pi[t];
    var cScale = 0; for (t = 0; t < T; t++) cScale = Math.max(cScale, eff[t]);
    // starting points: active recipes plus the closest-to-entering columns in each market
    var starts = D.act.map(function (o) { return o.j; });
    for (k = 0; k < nM; k++) {
      var cand = [];
      for (j = 0; j < C.nC; j++) {
        if (C.mk[j] !== k) continue;
        var c = 0; for (t = 0; t < T; t++) c += C.S[j * T + t] * eff[t];
        cand.push({ j: j, d: (D.p[k] * C.a[j] - c) });
      }
      cand.sort(function (u, v) { return v.d - u.d; });
      for (j = 0; j < Math.min(10, cand.length); j++) if (starts.indexOf(cand[j].j) < 0) starts.push(cand[j].j);
    }
    var s = new Float64Array(T);
    function tryAdd(k) {
      if (!validComp(C, s, 0) || hasComp(C, s, k, 1e-7)) return;
      evalBase(C, s, 0); applyCap(C, C.Qs[k]);
      var c = 0; for (var u = 0; u < T; u++) c += s[u] * eff[u];
      if (D.p[k] * E.a - c > 1e-9 * cScale && addComp(C, s) >= 0) added++;
    }
    // merging active recipes uses the same inputs; where mixing is complementary the merged firm produces more
    function merge(list) {
      var tot = 0, u;
      for (u = 0; u < T; u++) s[u] = 0;
      list.forEach(function (o) { tot += o.x; for (var v = 0; v < T; v++) s[v] += o.x * C.S[o.j * T + v]; });
      if (!(tot > 0)) return false;
      for (u = 0; u < T; u++) s[u] /= tot;
      return true;
    }
    for (k = 0; k < nM; k++) {
      var mine = D.act.filter(function (o) { return C.mk[o.j] === k; });
      if (mine.length > 1) {
        if (merge(mine)) tryAdd(k);
        for (var a1 = 0; a1 < mine.length; a1++) for (var a2 = a1 + 1; a2 < mine.length; a2++) if (merge([mine[a1], mine[a2]])) tryAdd(k);
      }
    }
    for (var q = 0; q < starts.length; q++) {
      j = starts[q]; k = C.mk[j];
      for (t = 0; t < T; t++) s[t] = C.S[j * T + t];
      var psi = localSearch(C, s, k, D.p[k], eff);
      if (psi > 1e-9 * cScale && !hasComp(C, s, k, 1e-7)) { if (addComp(C, s) >= 0) added++; }
    }
    return added;
  }
  // tangent columns around the active recipes pin the shadow prices to marginal products
  function addNeighbours(C, Qs) {
    var act = dualsAt(C, Qs).act, T = C.T, eps = 2e-5, s = new Float64Array(T), t;
    for (var q = 0; q < act.length; q++) {
      var j = act[q].j;
      for (t = 0; t < T; t++) s[t] = C.S[j * T + t];
      var set = moveSet(C, s);
      for (var ia = 0; ia < set.length; ia++) for (var ib = 0; ib < set.length; ib++) {
        if (ia === ib) continue;
        var a = set[ia], b = set[ib];
        if (s[a] < 1e-9) continue;
        var e = Math.min(eps, 0.02 * s[a]);
        if (b === C.iAI && s[b] + e > C.maxAI) continue;
        s[a] -= e; s[b] += e;
        if (!hasComp(C, s, C.mk[j], 1e-12)) addComp(C, s);
        s[a] += e; s[b] -= e;
      }
    }
  }

  // ───────────────────────── result assembly ─────────────────────────
  function emptyResult(P, note) {
    var nRoles = P.roles.length;
    return {
      ok: true, empty: true, note: note || '', P: P,
      markets: P.markets.map(function (m) { return { Q: 0, P: m.P0, p: m.P0, U: 0, S: m.S, P0: m.P0, hhi: 0, name: m.name }; }),
      Q: 0, W: 0, cost: 0, CS: 0, humanRents: 0, aiRent: 0, wageBill: 0,
      wages: P.roles.map(function () { return P.w; }), employed: P.roles.map(function () { return 0; }),
      aiUsed: 0, recipes: [], nFirms: 0, largest: 0, meanSize: 0, hhi: 0, kink: false, regime: classify(P), ms: 0
    };
  }

  // the network of the recipe last evaluated: partners, what they add, and what sets their number
  function netOf(C) {
    if (!C.ic) return null;
    return { n: E.n, H: E.n > 0 ? gScale(E.n, E.zeta, E.psi) : 1, nPref: E.psi > 0 ? mStar(E.zeta, E.psi) : 0, zeta: E.zeta, psi: E.psi, lam: E.lam, c1: E.c1, c2: E.c2, st: E.ns };
  }
  function describeRecipe(C, s, k, Qk) {
    evalBase(C, s, 0); applyCap(C, Qk);
    return { y1: E.y1, y2: E.y2, z: E.z, L: E.L, zMean: E.z0, LMean: E.L0, tx: E.tx, m: E.m, a: E.a, st: E.st, mPref: C.constRet ? 0 : mStar(E.z, C.phi), c0: E.c0, ic: netOf(C) };
  }

  function assemble(C, Qs, t0) {
    var P = C.P, T = C.T, nM = C.nM, nRoles = P.roles.length, t, k, j, i;
    var D = dualsAt(C, Qs, true), act = D.act.slice();
    // merge near-identical recipes (tangent columns) within a market
    var groups = [];
    act.sort(function (u, v) { return v.x - u.x; });
    act.forEach(function (o) {
      var jj = o.j, kk = C.mk[jj], found = null;
      for (var g = 0; g < groups.length; g++) {
        if (groups[g].k !== kk) continue;
        var d = 0; for (t = 0; t < T; t++) d += Math.abs(groups[g].s[t] / groups[g].x - C.S[jj * T + t]);
        if (d < 8e-3) { found = groups[g]; break; }
      }
      if (!found) { found = { k: kk, s: new Float64Array(T), x: 0, q: 0 }; groups.push(found); }
      for (t = 0; t < T; t++) found.s[t] += o.x * C.S[jj * T + t];
      found.x += o.x; found.q += o.x * C.a[jj];
    });
    var Qk = new Float64Array(nM), employed = new Float64Array(nRoles), aiUsed = 0, cost = 0, leading = 0, demoted = 0;
    var recipes = [], s = new Float64Array(T);
    var totX = 0; groups.forEach(function (g) { totX += g.x; });
    groups.forEach(function (g) {
      if (g.x < 1e-8 * totX + 1e-6) return;                // a firm type at a vanishing level is numerical dust
      for (t = 0; t < T; t++) s[t] = g.s[t] / g.x;
      var d = describeRecipe(C, s, g.k, C.Qs[g.k]);
      var a = g.q / g.x;                                   // realised average product of the merged group
      var rec = {
        mk: g.k, x: g.x, m: d.m, a: a, q: d.m > 0 ? d.m * a : 0, n: d.m > 0 ? g.x / d.m : Infinity,
        L: d.L, z: d.z, zMean: d.zMean, LMean: d.LMean, tx: d.tx, ic: d.ic, y1: d.y1, y2: d.y2, st: d.st, mPref: d.mPref, out: g.q,
        sRole: new Array(nRoles).fill(0), sAI: 0, sT: Array.prototype.slice.call(s)
      };
      for (t = 0; t < T; t++) {
        if (C.types[t].kind === 1) { rec.sAI = s[t]; aiUsed += g.x * s[t]; }
        else { rec.sRole[C.types[t].role] += s[t]; employed[C.types[t].role] += g.x * s[t]; if (t === C.iLead) { rec.sLead = s[t]; leading += g.x * s[t]; } if (t === C.iComp) demoted += g.x * s[t]; }
        cost += g.x * s[t] * C.COST[t];
      }
      Qk[g.k] += g.q;
      recipes.push(rec);
    });
    // prices, wages, rents
    var wages = P.roles.map(function () { return P.w; }), aiRent = 0;
    for (t = 0; t < T; t++) {
      if (C.types[t].kind === 1) aiRent = D.pi[t];
      else {
        var ro = C.types[t].role, slack = P.roles[ro].n - employed[ro];
        wages[ro] = P.w + (slack > 1e-6 * Math.max(1, P.roles[ro].n) ? 0 : D.pi[t]);
      }
    }
    var markets = [], Wtot = -cost, hhiAll = 0, Qall = 0;
    for (k = 0; k < nM; k++) {
      var hh = 0;
      recipes.forEach(function (rc) { if (rc.mk === k && rc.m > 0 && Qk[k] > 0) { var sh = rc.q / Qk[k]; hh += rc.n * sh * sh; } });
      hh = Math.min(1, hh);
      markets.push({ Q: Qk[k], P: priceAt(C.mks[k], Qk[k]), p: D.p[k], U: utilAt(C.mks[k], Qk[k]), S: C.mks[k].S, P0: C.mks[k].P0, hhi: hh, name: C.mks[k].name });
      Wtot += utilAt(C.mks[k], Qk[k]); hhiAll += hh * Qk[k]; Qall += Qk[k];
    }
    recipes.forEach(function (rc) { rc.share = Qk[rc.mk] > 0 ? rc.out / Qk[rc.mk] : 0; rc.p = D.p[rc.mk]; });
    var humanRents = 0, wageBill = 0, empTot = 0;
    for (i = 0; i < nRoles; i++) { humanRents += (wages[i] - P.w) * employed[i]; wageBill += wages[i] * employed[i]; empTot += employed[i]; }
    var nFirms = 0, largest = 0, wsum = 0, xsum = 0;
    recipes.forEach(function (rc) {
      nFirms += rc.m > 0 ? rc.n : rc.x;
      if (rc.m > largest) largest = rc.m;
      wsum += rc.x * rc.m; xsum += rc.x;
    });
    recipes.sort(function (u, v) { return u.mk - v.mk || u.sAI - v.sAI || v.x - u.x; });
    return {
      ok: true, empty: recipes.length === 0, P: P, markets: markets, Q: Qall, W: Wtot, cost: cost,
      humanRents: humanRents, aiRent: aiRent, aiRentTotal: aiRent * aiUsed, wageBill: wageBill,
      CS: Wtot - humanRents - aiRent * aiUsed,
      wages: wages, employed: Array.prototype.slice.call(employed), employedTotal: empTot, aiUsed: aiUsed,
      recipes: recipes, nFirms: nFirms, largest: largest, meanSize: xsum > 0 ? wsum / xsum : 0,
      hhi: Qall > 0 ? hhiAll / Qall : 0, kink: D.kink, regime: classify(P), nCols: C.nC,
      lead: C.iLead >= 0 ? { role: C.types[C.iLead].role, leading: leading, demoted: demoted } : null,
      ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    };
  }

  // ───────────────────────── one organisation (special rule) ─────────────────────────
  function solveSingle(P, t0) {
    var C = makeContext(P), T = C.T, mks = C.mks, iAI = C.iAI, h = P.rules.minHuman, t, k;
    if (T === 0) return emptyResult(P, 'No agents available.');
    function output(x) {
      var m = 0, y1 = 0, y2 = 0, z = 0;
      for (var q = 0; q < T; q++) { m += x[q]; y1 += x[q] * C.Y1[q]; y2 += x[q] * C.Y2[q]; z += x[q] * C.YS[q]; }
      if (!(m > 0)) return 0;
      var L = cesL(y1 / m, y2 / m, C.rho), zz = z / m;
      if (C.tr && iAI >= 0 && x[iAI] > 0 && x[iAI] < m) {
        var sa = x[iAI] / m, tx = 2 * sa * (1 - sa);
        zz += C.tr.kc * tx * C.tr.gap; if (zz < 0) zz = 0;
        if (C.tr.gap > 0) L *= 1 - C.tr.ke * tx * C.tr.gap;
      }
      return C.constRet ? L * m : L * m * gScale(m, zz, C.phi);
    }
    function humSum(x) { var a = 0; for (var q = 0; q < T; q++) if (q !== iAI) a += x[q]; return a; }
    function bounds(x, q) {           // feasible interval for coordinate q given the human-share mandate
      var lo = 0, hi = C.SUP[q];
      if (h > 0 && iAI >= 0) {
        if (q === iAI) hi = Math.min(hi, h < 1 ? humSum(x) * (1 - h) / h : 0);
        else lo = Math.max(0, x[iAI] * h / (1 - h) - (humSum(x) - x[q]));
      }
      return [lo, Math.max(lo, hi)];
    }
    // supports allowed by the mixing rules
    var hum = [], supports = [];
    for (t = 0; t < T; t++) if (t !== iAI && t !== C.iComp) hum.push(t);
    var R = P.rules;
    if (R.mosaic) {
      if (hum.length) supports.push(hum.slice());
      if (R.mixed && iAI >= 0 && hum.length) supports.push(hum.concat([iAI]));
    } else {
      hum.forEach(function (q) { supports.push([q]); if (R.mixed && iAI >= 0) supports.push([q, iAI]); });
    }
    if (iAI >= 0 && h === 0) supports.push([iAI]);
    // like every firm in the model, the organisation sells into one market: try each, keep the best
    var best = null, bestW = 0, bestK = 0;
    mks.forEach(function (mk, kk) {
      function W(x) { var c = 0; for (var q = 0; q < T; q++) c += x[q] * C.COST[q]; return utilAt(mk, output(x)) - c; }
      function climb(x, allowed) {
        var cur = W(x);
        for (var sweep = 0; sweep < 40; sweep++) {
          var before = cur;
          allowed.forEach(function (q) {
            var bd = bounds(x, q), x0 = x[q];
            if (bd[1] - bd[0] < 1e-12) return;
            var g = golden(function (v) { x[q] = v; return W(x); }, bd[0], bd[1], 34);
            x[q] = bd[0]; var fl = W(x); x[q] = bd[1]; var fh = W(x);
            var bx = g.x, bf = g.f;
            if (fl > bf) { bf = fl; bx = bd[0]; }
            if (fh > bf) { bf = fh; bx = bd[1]; }
            if (bf > cur) { x[q] = bx; cur = bf; } else x[q] = x0;
          });
          if (cur - before < 1e-11 * Math.max(1, Math.abs(cur))) break;
        }
        return cur;
      }
      supports.forEach(function (sup) {
        [1, 0.4, 0.05].forEach(function (frac) {
          var x = new Float64Array(T);
          sup.forEach(function (q) { x[q] = Math.min(C.SUP[q] < Infinity ? C.SUP[q] * frac : 50 * frac, 1e7); });
          if (h > 0 && iAI >= 0 && x[iAI] > 0) x[iAI] = Math.min(x[iAI], h < 1 ? humSum(x) * (1 - h) / h : 0);
          var w = climb(x, sup);
          if (w > bestW + 1e-12) { bestW = w; best = x; bestK = kk; }
        });
        // the surface is nearly flat in the mix of roles: also start with each member in turn scarce
        if (sup.length > 1) sup.forEach(function (lowQ) {
          var x = new Float64Array(T);
          sup.forEach(function (q) { x[q] = Math.min(C.SUP[q] < Infinity ? C.SUP[q] * (q === lowQ ? 0.03 : 0.7) : (q === lowQ ? 1.5 : 35), 1e7); });
          if (h > 0 && iAI >= 0 && x[iAI] > 0) x[iAI] = Math.min(x[iAI], h < 1 ? humSum(x) * (1 - h) / h : 0);
          var w = climb(x, sup);
          if (w > bestW + 1e-12) { bestW = w; best = x; bestK = kk; }
        });
      });
    });
    if (!best) return emptyResult(P, 'No single organisation breaks even.');
    var x = best, m = 0; for (t = 0; t < T; t++) m += x[t];
    var Q = Math.min(output(x), mks[bestK].S + 1e300), nRoles = P.roles.length;
    var price = priceAt(mks[bestK], Q);
    var s = new Float64Array(T); for (t = 0; t < T; t++) s[t] = x[t] / m;
    evalBase(C, s, 0);
    var rec = {
      mk: bestK, x: m, m: m, a: Q / m, q: Q, n: 1, L: E.L, z: E.z, zMean: E.z0, LMean: E.L0, tx: E.tx, ic: null, y1: E.y1, y2: E.y2, st: ST_RULE,
      mPref: C.constRet ? 0 : mStar(E.z, C.phi), out: Q, share: 1, p: price,
      sRole: new Array(nRoles).fill(0), sAI: 0, sT: Array.prototype.slice.call(s)
    };
    var wages = P.roles.map(function () { return P.w; }), employed = new Array(nRoles).fill(0), aiUsed = 0, aiRent = 0, cost = 0;
    var hstep = 1e-5 * Math.max(1, m);
    for (t = 0; t < T; t++) {
      if (t === C.iComp) continue;                      // one organisation has one leader and no former ones
      var keep = x[t]; x[t] = keep + hstep; var qp = output(x); x[t] = Math.max(0, keep - hstep); var qm = output(x);
      var mp = (qp - qm) / (keep + hstep - Math.max(0, keep - hstep)); x[t] = keep;
      cost += x[t] * C.COST[t];
      if (C.types[t].kind === 1) { rec.sAI = s[t]; aiUsed = x[t]; if (x[t] >= C.SUP[t] * (1 - 1e-7)) aiRent = Math.max(0, price * mp - P.r); }
      else {
        var ro = C.types[t].role; rec.sRole[ro] = s[t]; employed[ro] = x[t];
        if (x[t] >= C.SUP[t] * (1 - 1e-7)) wages[ro] = Math.max(P.w, price * mp);
      }
    }
    var U = 0, markets = [];
    for (k = 0; k < mks.length; k++) {
      var qk = k === bestK ? Q : 0;
      U += utilAt(mks[k], qk);
      markets.push({ Q: qk, P: priceAt(mks[k], qk), p: k === bestK ? cost / Math.max(Q, 1e-12) : mks[k].P0, U: utilAt(mks[k], qk), S: mks[k].S, P0: mks[k].P0, hhi: qk > 0 ? 1 : 0, name: mks[k].name });
    }
    var humanRents = 0, wageBill = 0, empTot = 0;
    for (var i = 0; i < nRoles; i++) { humanRents += (wages[i] - P.w) * employed[i]; wageBill += wages[i] * employed[i]; empTot += employed[i]; }
    var Wt = U - cost;
    // With returns to scale still rising, paying everyone their marginal product would take more than the
    // organisation earns. Rents are then shared out of what it does earn over its costs.
    var earned = Math.max(0, price * Q - cost), claimed = humanRents + aiRent * aiUsed;
    if (claimed > earned && claimed > 0) {
      var fr = earned / claimed;
      for (i = 0; i < nRoles; i++) wages[i] = P.w + (wages[i] - P.w) * fr;
      aiRent *= fr; humanRents = 0; wageBill = 0;
      for (i = 0; i < nRoles; i++) { humanRents += (wages[i] - P.w) * employed[i]; wageBill += wages[i] * employed[i]; }
    }
    return {
      ok: true, empty: false, P: P, markets: markets, Q: Q, W: Wt, cost: cost, humanRents: humanRents, aiRent: aiRent,
      aiRentTotal: aiRent * aiUsed, wageBill: wageBill, CS: Wt - humanRents - aiRent * aiUsed, wages: wages, employed: employed,
      employedTotal: empTot, aiUsed: aiUsed, recipes: [rec], nFirms: 1, largest: m, meanSize: m, hhi: 1, kink: false,
      regime: classify(P), single: true, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    };
  }

  // ───────────────────────── main entry ─────────────────────────
  function solve(Praw, opts) {
    var t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    var P = normalize(Praw);
    opts = opts || {};
    if (!P.markets.length) return emptyResult(P, 'No market.');
    if (P.rules.size === 'single') return solveSingle(P, t0);
    var C = makeContext(P);
    if (C.T === 0) return emptyResult(P, 'No agents available.');
    buildMenu(C);
    if (C.nC === 0) return emptyResult(P, 'The organisation rules allow no firm.');
    var sr = searchQ(C, null);
    if (!sr || !(sr.W > 1e-12)) return emptyResult(P, 'No firm can cover its costs at these prices.');
    var rounds = opts.fast ? 3 : 10;
    for (var it = 0; it < rounds; it++) {
      var Qs = eqSplit(C, sr.Qtot, sr.delta);
      var added = polish(C, Qs);
      if (!added) break;
      var s2 = searchQ(C, sr), gain = s2 ? s2.W - sr.W : 0;
      if (s2 && s2.W >= sr.W - 1e-12) sr = { Qtot: s2.Qtot, delta: s2.delta, W: s2.W, hi: s2.hi };
      if (it > 0 && gain < 1e-9 * Math.abs(sr.W)) break;
    }
    var Qf = eqSplit(C, sr.Qtot, sr.delta);
    addNeighbours(C, Qf);
    if (!opts.fast) {
      // with tangent columns in place the cost curve is smooth near the optimum: settle output once more
      var s3 = searchQ(C, { Qtot: sr.Qtot, delta: sr.delta, tight: true });
      if (s3 && s3.W >= sr.W - 1e-12) { sr.Qtot = s3.Qtot; sr.W = s3.W; Qf = eqSplit(C, sr.Qtot, sr.delta); }
      // output the resources cannot deliver is not output: aim at what they can, so that no market is left short
      var d0 = dualsAt(C, Qf), sh0 = 0, kq;
      for (kq = 0; kq < C.nM; kq++) sh0 += d0.short[kq] * C.Qs[kq];
      if (sh0 > 1e-9 * sr.Qtot) { sr.Qtot -= sh0 * (1 + 1e-6); Qf = eqSplit(C, sr.Qtot, sr.delta); sr.W = evalW(C, Qf); }
      if (C.nM === 2) {
        // and the split between the two markets: a small market's price is sensitive to it
        var qe = splitTotal(C.mks, sr.Qtot), Qt = sr.Qtot;
        var dLo = (Math.max(0, Qt - C.mks[1].S) - qe[0]) / Qt, dHi = (Math.min(C.mks[0].S, Qt) - qe[0]) / Qt;
        if (dHi - dLo > 1e-12) {
          var rd = searchLine(function (dd) { return evalW(C, eqSplit(C, Qt, dd)); }, dLo, dHi, 24, 34);
          if (rd.f > sr.W) { sr.delta = rd.x; sr.W = rd.f; Qf = eqSplit(C, Qt, rd.x); }
        }
      }
    }
    if (!opts.fast) {
      // The search can stop a hair past a capacity limit, where the next unit would come from a firm type
      // that costs more than buyers pay. Step back onto the limit: prices are then read at what buyers pay.
      var dz = dualsAt(C, Qf, true), back = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3], bi;
      for (bi = 0; bi < back.length && !dz.kink && dz.above; bi++) {
        var Qb = eqSplit(C, sr.Qtot * (1 - back[bi]), sr.delta);
        dz = dualsAt(C, Qb, true);
        if (dz.kink || !dz.above) Qf = Qb;
      }
    }
    var res = assemble(C, Qf, t0);
    res.iters = it; res.nLP = C.nLP; res.nIt = C.nIt;
    return res;
  }

  // ───────────────────────── classification of the AI (paper §2.3, App. E.1) ─────────────────────────
  function classify(P) {
    var roles = P.roles.filter(function (r) { return r.n > 0; }), ai = P.ai;
    var out = { key: 'none', label: 'No AI', superCompetent: false, superCoop: false };
    if (!(ai.cap > 0)) return out;
    var max1 = 0, max2 = 0, n = 0, Lbar = 0, zbar = 0;
    roles.forEach(function (r) {
      if (r.y1 > max1) max1 = r.y1; if (r.y2 > max2) max2 = r.y2;
      n += r.n; Lbar += r.n * cesL(r.y1, r.y2, P.rho); zbar += r.n * r.ys;
    });
    if (n > 0) { Lbar /= n; zbar /= n; }
    out.Lbar = Lbar; out.zbar = zbar; out.max1 = max1; out.max2 = max2;
    out.superCoop = !P.constReturns && ai.ys > 1;
    out.superCompetent = n > 0 ? (ai.y1 > max1 && ai.y2 > max2) : true;
    var LM = cesL(ai.y1, ai.y2, P.rho);
    if (out.superCompetent && out.superCoop) { out.key = 'asi'; out.label = 'ASI'; }
    else if (out.superCoop) { out.key = 'supercoop'; out.label = 'Supercooperative AI'; }
    else if (out.superCompetent) { out.key = 'supercomp'; out.label = 'Supercompetent AI'; }
    else if (LM >= Lbar - 1e-9 && ai.ys >= zbar - 1e-9) { out.key = 'agi'; out.label = 'Minimal AGI'; }
    else { out.key = 'weak'; out.label = 'Weak AI'; }
    return out;
  }

  // ───────────────────────── bids (paper eq. BID) ─────────────────────────
  // what recipe `rc` would pay for one more worker with profile y, at its internal price
  function bid(P, rc, y, isAI) {
    var L0 = rc.LMean != null ? rc.LMean : rc.L, z0 = rc.zMean != null ? rc.zMean : rc.z;   // skills act on the plain means
    var g = cesGrad(rc.y1, rc.y2, P.rho, L0);
    var e = rc.st === ST_MARKET ? sizeElasticity(rc.m, rc.z, P.phi) : 1;
    var lg = P.constReturns ? 0 : Math.log1p(rc.m);
    var tm = trustMargin(P, rc, !!isAI), d1 = y.y1 - rc.y1, d2 = y.y2 - rc.y2;
    var dL = (g[0] * d1 + g[1] * d2) / Math.max(L0, 1e-12), ic = rc.ic, net = 0, lgn = 0;
    if (ic && ic.n > 0 && P.inter) {
      var u = ic.n / (1 + ic.n), ip = P.inter.ip;
      lgn = P.inter.services * Math.log1p(ic.n);          // coordination also holds the network together
      if (ip > 0 && ic.lam > 0) {                          // licensed skills: the newcomer moves the average and what the best know
        var t1 = rc.y1 + ip * (ic.c1 - rc.y1), t2 = rc.y2 + ip * (ic.c2 - rc.y2), Lt = cesL(t1, t2, P.rho), gt = cesGrad(t1, t2, P.rho, Lt);
        var e1 = (1 - ip) * d1 + ip * ((y.y1 * y.y1 - ic.c1 * rc.y1) - ic.c1 * d1) / rc.y1;
        var e2 = (1 - ip) * d2 + ip * ((y.y2 * y.y2 - ic.c2 * rc.y2) - ic.c2 * d2) / rc.y2;
        net = u * ((gt[0] * e1 + gt[1] * e2) / Math.max(Lt, 1e-12) - dL);
      }
    }
    var rel = dL + tm.dl + (lg + lgn) * ((y.ys - z0) + tm.dz) + net;
    return rc.p * rc.a * (1 + rel / e);
  }
  // capability prices: value of one more unit of each capability inside recipe rc
  function capPrices(P, rc) {
    var L0 = rc.LMean != null ? rc.LMean : rc.L;
    var g = cesGrad(rc.y1, rc.y2, P.rho, L0);
    var e = rc.st === ST_MARKET ? sizeElasticity(rc.m, rc.z, P.phi) : 1;
    var k = rc.p * rc.a / e, ic = rc.ic;
    var p1 = g[0] / Math.max(L0, 1e-12), p2 = g[1] / Math.max(L0, 1e-12), lg = P.constReturns ? 0 : Math.log1p(rc.m);
    if (ic && ic.n > 0 && P.inter) {
      var u = ic.n / (1 + ic.n), ip = P.inter.ip;
      lg += P.inter.services * Math.log1p(ic.n);
      if (ip > 0 && ic.lam > 0) {                          // for a person at the firm's average skill
        var t1 = rc.y1 + ip * (ic.c1 - rc.y1), t2 = rc.y2 + ip * (ic.c2 - rc.y2), Lt = cesL(t1, t2, P.rho), gt = cesGrad(t1, t2, P.rho, Lt);
        p1 = (1 - u) * p1 + u * gt[0] / Math.max(Lt, 1e-12) * ((1 - ip) + ip * (2 * rc.y1 - ic.c1) / rc.y1);
        p2 = (1 - u) * p2 + u * gt[1] / Math.max(Lt, 1e-12) * ((1 - ip) + ip * (2 * rc.y2 - ic.c2) / rc.y2);
      }
    }
    return { y1: k * p1, y2: k * p2, ys: k * lg };
  }

  // ───────────────────────── integer realisation for drawing ─────────────────────────
  function roundPreserve(vals, total) {
    var n = vals.length, out = new Array(n), sum = 0, i, rem = [];
    var s = 0; for (i = 0; i < n; i++) s += vals[i];
    var k = s > 0 ? total / s : 0;
    for (i = 0; i < n; i++) { var v = vals[i] * k; out[i] = Math.floor(v + 1e-9); sum += out[i]; rem.push({ i: i, f: v - out[i] }); }
    rem.sort(function (a, b) { return b.f - a.f || a.i - b.i; });
    for (i = 0; sum < total && i < n; i++) { out[rem[i].i]++; sum++; }
    return out;
  }
  // whole firms and whole people: returns, per recipe, a list of firms with head counts
  function realize(res) {
    var P = res.P, nRoles = P.roles.length, J = res.recipes.length, i, j;
    var counts = [];                                      // counts[j][i], last index = AI
    for (j = 0; j < J; j++) counts.push(new Array(nRoles + 1).fill(0));
    var unemployed = new Array(nRoles).fill(0);
    for (i = 0; i < nRoles; i++) {
      var tot = Math.round(P.roles[i].n), vals = [], used = 0;
      for (j = 0; j < J; j++) { var v = res.recipes[j].x * res.recipes[j].sRole[i]; vals.push(v); used += v; }
      vals.push(Math.max(0, P.roles[i].n - used));
      var ints = roundPreserve(vals, tot);
      for (j = 0; j < J; j++) counts[j][i] = ints[j];
      unemployed[i] = ints[J];
    }
    var capI = isFinite(P.ai.cap) ? Math.round(P.ai.cap) : 0, av = [], au = 0;
    for (j = 0; j < J; j++) { var va = res.recipes[j].x * res.recipes[j].sAI; av.push(va); au += va; }
    av.push(Math.max(0, capI - au));
    var ai = roundPreserve(av, capI);
    for (j = 0; j < J; j++) counts[j][nRoles] = ai[j];
    var groups = [];
    for (j = 0; j < J; j++) {
      var rc = res.recipes[j], total = 0;
      for (i = 0; i <= nRoles; i++) total += counts[j][i];
      if (total === 0) continue;
      var micro = !(rc.m >= 1.5);                         // below ~1 agent per firm: draw agents as a loose fringe
      var nF = micro ? total : Math.max(1, Math.min(total, Math.round(rc.n)));
      var firms = [], f;
      for (f = 0; f < nF; f++) firms.push(new Array(nRoles + 1).fill(0));
      var ptr = 0;
      for (i = 0; i <= nRoles; i++) {
        var hcount = counts[j][i], base = Math.floor(hcount / nF), extra = hcount - base * nF;
        for (f = 0; f < nF; f++) firms[f][i] = base;
        for (f = 0; f < extra; f++) firms[(ptr + f) % nF][i]++;
        ptr = (ptr + extra) % nF;
      }
      groups.push({ ri: j, mk: rc.mk, micro: micro, total: total, counts: counts[j], firms: firms, net: rc.ic && rc.ic.n > 0 ? 1 + rc.ic.n : 1, lead: rc.sLead > 1e-12 });
    }
    return { groups: groups, unemployed: unemployed, idleAI: ai[J], leadRole: res.lead ? res.lead.role : -1 };
  }

  // ───────────────────────── helpers for charts ─────────────────────────
  // output per agent of a fixed composition as a function of firm size
  function scaleCurve(P, L, z, sizes) {
    return sizes.map(function (m) { return P.constReturns ? L : L * gScale(m, z, P.phi); });
  }

  return {
    solve: solve, realize: realize, classify: classify, normalize: normalize, bid: bid, capPrices: capPrices,
    cesL: cesL, cesGrad: cesGrad, gScale: gScale, mStar: mStar, gPeak: gPeak, scaleCurve: scaleCurve,
    priceAt: priceAt, utilAt: utilAt, demandAt: demandAt, STATE_NAMES: STATE_NAMES, ST_LEAD: ST_LEAD, TRUST: TRUST, trustMargin: trustMargin, NET_STATE_NAMES: NET_STATE_NAMES, NS_PREF: NS_PREF,
    ST_PREF: ST_PREF, ST_RULE: ST_RULE, ST_STAFF: ST_STAFF, ST_MARKET: ST_MARKET, ST_ATOM: ST_ATOM,
    _simplex: simplex
  };
});
