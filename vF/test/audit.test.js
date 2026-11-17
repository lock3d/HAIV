/* An independent audit of the model's arithmetic. Nothing here calls the solver's own formulas:
 * every quantity is recomputed from the paper's definitions (and the two extensions' definitions)
 * and compared with what the solver reports.
 *  1. each firm type: skills, coordination, competence, trust and network terms, output per agent;
 *  2. firm size and network size against their first-order conditions, by brute force;
 *  3. the accounts: market output, employment, cost, price, total surplus, its split, concentration;
 *  4. equilibrium: at the reported prices and wages no firm type in use makes a profit or a loss,
 *     and no nearby firm type would make a profit.
 * Run: node test/audit.test.js [cases] [seed] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 97531; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 60;
let bad = 0, checks = 0, solves = 0; const count = {};
function expect(ok, kind, msg) { checks++; count[kind] = (count[kind] || 0) + 1; if (!ok) { bad++; if (bad <= 40) console.log('MISMATCH [' + kind + '] ' + msg); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ── the model, written out again from its definitions ──
const ces = (y1, y2, rho) => Math.abs(rho) < 1e-6 ? Math.sqrt(y1 * y2) : Math.pow((Math.pow(y1, rho) + Math.pow(y2, rho)) / 2, 1 / rho);
const scale = (m, z, phi) => Math.pow(1 + m, z - 1) * Math.exp(phi * m / (1 + m));          // output per agent over competence
function firmType(P, sRole, sAI) {
  let y1 = 0, y2 = 0, z = 0, q1 = 0, q2 = 0, cost = 0;
  sRole.forEach((s, i) => { const r = P.roles[i]; y1 += s * r.y1; y2 += s * r.y2; z += s * r.ys; q1 += s * r.y1 * r.y1; q2 += s * r.y2 * r.y2; cost += s * P.w; });
  y1 += sAI * P.ai.y1; y2 += sAI * P.ai.y2; z += sAI * P.ai.ys; q1 += sAI * P.ai.y1 * P.ai.y1; q2 += sAI * P.ai.y2 * P.ai.y2; cost += sAI * P.r;
  const L0 = ces(y1, y2, P.rho); let L = L0, zMean = z;
  if (P.trust && sAI > 0 && sAI < 1) {                       // trust: only where people and AI share the firm
    const x = 2 * sAI * (1 - sAI), gap = P.trust.gap;
    z = Math.max(0, z + P.trust.kc * x * gap);
    if (gap > 0) L *= 1 - P.trust.ke * x * gap;
  }
  let psi = 0, zeta = 0, lam = 0;
  if (P.inter) {
    if (P.inter.ip > 0) { const t1 = y1 + P.inter.ip * (q1 / y1 - y1), t2 = y2 + P.inter.ip * (q2 / y2 - y2); lam = Math.max(0, Math.log(ces(t1, t2, P.rho) / L0)); }
    psi = P.inter.goods * P.phi + lam; zeta = P.inter.services * z;
  }
  return { y1, y2, z, zMean, L, L0, cost, psi, zeta, lam };
}
const U = (mk, Q) => { const q = Math.min(Q, mk.S); return mk.P0 * (q - q * q / (2 * mk.S)); };
const price = (mk, Q) => Q >= mk.S ? 0 : mk.P0 * (1 - Q / mk.S);
// best value of f on (0, hi] by brute force on a log grid, refined once
function argmax(f, hi) {
  let bx = 0, bf = f(1e-9), lo = Math.log(1e-6), up = Math.log(hi);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i <= 400; i++) { const x = Math.exp(lo + (up - lo) * i / 400), v = f(x); if (v > bf) { bf = v; bx = x; } }
    if (bx > 0) { const c = Math.log(bx), w = (up - lo) / 200; lo = c - w; up = Math.min(Math.log(hi), c + w); }
  }
  return bx;
}

for (let c = 0; c < N; c++) {
  const nRoles = 1 + Math.floor(rnd() * 3), roles = [];
  for (let i = 0; i < nRoles; i++) roles.push({ n: Math.round(pick(20, 400)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.3, 0.98) });
  const mode = c % 4, P0 = pick(0.2, 2);
  const raw = {
    roles, w: pick(0.1, 1.2), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.3, 2.5),
    ai: { cap: Math.round(pick(100, 10000)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.3, 0.98) },
    markets: [{ P0, S: Math.exp(pick(9, 13)) }],
    trust: mode === 1 || mode === 3 ? { on: true, level: rnd() } : null,
    inter: mode >= 2 ? { on: true, goods: rnd(), services: rnd(), ip: rnd() } : null
  };
  const tag = `case ${c} (${['paper', 'trust', 'links', 'trust + links'][mode]})`;
  if (process.env.DUMP === String(c)) require('fs').writeFileSync(process.env.DUMP_TO, JSON.stringify(raw));
  const r = OI.solve(raw), P = r.P; solves++;
  if (r.empty) continue;
  const pi = r.wages.map(w => w - P.w), costOf = (sRole, sAI) => sRole.reduce((a, s, i) => a + s * r.wages[i], 0) + sAI * (P.r + r.aiRent);
  const anyMarketLimited = r.recipes.some(rc => rc.st === OI.ST_MARKET || (rc.ic && rc.ic.st === 3));

  // 1 and 2: every firm type in use
  const Qk = P.markets.map(() => 0), emp = P.roles.map(() => 0); let ai = 0, cost = 0;
  r.recipes.forEach((rc, j) => {
    const t = firmType(P, rc.sRole, rc.sAI), where = `${tag} firm type ${j}`;
    expect(near(rc.sAI + rc.sRole.reduce((a, b) => a + b, 0), 1, 1e-9), 'shares', `${where}: shares do not add to one`);
    expect(near(t.y1, rc.y1, 1e-9) && near(t.y2, rc.y2, 1e-9), 'skills', `${where}: mean skills ${t.y1}, ${t.y2} against ${rc.y1}, ${rc.y2}`);
    expect(near(t.z, rc.z, 1e-9), 'coordination', `${where}: coordination ${t.z} against ${rc.z}`);
    expect(near(t.L, rc.L, 1e-9), 'competence', `${where}: competence ${t.L} against ${rc.L}`);
    const n = rc.ic ? rc.ic.n : 0, H = n > 0 ? scale(n, t.zeta, t.psi) : 1;
    // (a firm type without firm structure, or one that fills its market, has no network and reports no network terms)
    if (rc.ic && rc.st !== OI.ST_ATOM && rc.st !== OI.ST_MARKET && rc.m > 0) expect(near(t.psi, rc.ic.psi, 1e-9) && near(t.zeta, rc.ic.zeta, 1e-9) && near(H, rc.ic.H, 1e-9), 'network terms', `${where}: psi ${t.psi}/${rc.ic.psi} zeta ${t.zeta}/${rc.ic.zeta} H ${H}/${rc.ic.H}`);
    const a = t.L * scale(rc.m, t.z, P.phi) * H;
    expect(near(a, rc.a, 2e-4), 'output per agent', `${where}: L x scale x network = ${a} against ${rc.a}`);
    // preferred size, by brute force and by the paper's formula
    if (rc.st === OI.ST_PREF) {
      const mBrute = argmax(m => scale(m, t.z, P.phi), 1e6), mFormula = P.phi / (1 - t.z) - 1;
      expect(near(mFormula, rc.m, 1e-6), 'firm size formula', `${where}: phi/(1-z)-1 = ${mFormula} against ${rc.m}`);
      expect(near(mBrute, rc.m, 2e-3), 'firm size brute force', `${where}: best size by search ${mBrute} against ${rc.m}`);
    }
    if (rc.ic && rc.ic.st === 1) {
      const nBrute = argmax(k => scale(k, t.zeta, t.psi), 1e6), nFormula = t.psi / (1 - t.zeta) - 1;
      expect(near(nFormula, n, 1e-6), 'network size formula', `${where}: psi/(1-zeta)-1 = ${nFormula} against ${n}`);
      expect(near(nBrute, n, 2e-3), 'network size brute force', `${where}: best partners by search ${nBrute} against ${n}`);
    }
    if (rc.ic && rc.ic.st === 0) expect(!(t.psi > 1 - t.zeta + 1e-9) || rc.st === OI.ST_MARKET || !(rc.m > 0), 'no network', `${where}: linking would pay (psi ${t.psi} > 1 - zeta ${1 - t.zeta}) but there is no network`);
    if (rc.ic && rc.ic.st === 2) {                             // headcount short: size and partners chosen together
      const staff = Math.min(...rc.sRole.map((s, i) => s > 1e-12 ? P.roles[i].n / s : Infinity), rc.sAI > 1e-12 ? P.ai.cap / rc.sAI : Infinity);
      expect(near((1 + n) * rc.m, staff, 1e-6), 'network headcount', `${where}: network of ${(1 + n) * rc.m} agents, headcount allows ${staff}`);
      const mB = argmax(m => m > staff ? -1 : scale(m, t.z, P.phi) * scale(Math.max(0, Math.min(staff / m - 1, t.psi / (1 - t.zeta) - 1)), t.zeta, t.psi), Math.min(staff, Math.max(1e-3, P.phi / (1 - t.z) - 1)));
      const best = scale(mB, t.z, P.phi) * scale(Math.max(0, staff / mB - 1), t.zeta, t.psi), got = scale(rc.m, t.z, P.phi) * H;
      expect(got >= best * (1 - 1e-4), 'joint size and partners', `${where}: size ${rc.m} with ${n} partners gives ${got}, search finds ${best} at size ${mB}`);
    }
    Qk[rc.mk] += rc.x * rc.a; rc.sRole.forEach((s, i) => emp[i] += rc.x * s); ai += rc.x * rc.sAI; cost += rc.x * t.cost;
    // 4: zero profit for a firm type in use, at the internal price
    if (!anyMarketLimited && !(P.trust && rc.sAI > 1 - P.rules.minHuman - 1e-4)) {
      const profit = rc.p * rc.a - costOf(rc.sRole, rc.sAI);
      expect(Math.abs(profit) <= 2e-3 * rc.p * rc.a, 'zero profit', `${where}: revenue per agent ${(rc.p * rc.a).toFixed(5)}, pay per agent ${costOf(rc.sRole, rc.sAI).toFixed(5)}`);
      // no nearby firm type does better: shift a little share between two inputs, at its own best size and network
      for (let k = 0; k < 6; k++) {
        const s = rc.sRole.concat([rc.sAI]), i1 = Math.floor(rnd() * s.length), i2 = Math.floor(rnd() * s.length);
        if (i1 === i2) continue;
        const d = Math.min(s[i1], 0.03 * rnd()); s[i1] -= d; s[i2] += d;
        const sAI = s.pop(); if (sAI > 1 - P.rules.minHuman + 1e-12) continue;
        const u = firmType(P, s, sAI), mS = u.z < 1 ? Math.max(0, P.phi / (1 - u.z) - 1) : null; if (mS == null || !(mS > 0)) continue;
        const staff = Math.min(...s.map((v, i) => v > 1e-12 ? P.roles[i].n / v : Infinity), sAI > 1e-12 ? P.ai.cap / sAI : Infinity);
        let nS = u.psi > 1 - u.zeta && u.zeta < 1 ? u.psi / (1 - u.zeta) - 1 : 0; if ((1 + nS) * mS > staff) continue;   // keep to unconstrained neighbours
        const aS = u.L * scale(mS, u.z, P.phi) * (nS > 0 ? scale(nS, u.zeta, u.psi) : 1);
        const gain = rc.p * aS - costOf(s, sAI);
        expect(gain <= 2e-3 * rc.p * aS, 'no profitable neighbour', `${where}: a nearby firm type would earn ${gain.toFixed(5)} per agent (revenue ${(rc.p * aS).toFixed(5)})`);
      }
    }
  });
  // 3: the accounts
  let Wsum = -cost, Qall = 0;
  P.markets.forEach((mk, k) => {
    expect(near(Qk[k], r.markets[k].Q, 1e-7), 'market output', `${tag}: firms make ${Qk[k]}, market ${k} reports ${r.markets[k].Q}`);
    expect(near(price(mk, Qk[k]), r.markets[k].P, 1e-7), 'price', `${tag}: demand price ${price(mk, Qk[k])} against ${r.markets[k].P}`);
    if (!anyMarketLimited) expect(near(r.markets[k].p, r.markets[k].P, 2e-3), 'internal price = market price', `${tag}: internal price ${r.markets[k].p} against market price ${r.markets[k].P}`);
    Wsum += U(mk, Qk[k]); Qall += Qk[k];
  });
  emp.forEach((e, i) => { expect(near(e, r.employed[i], 1e-7), 'employment', `${tag}: role ${i} employment ${e} against ${r.employed[i]}`); expect(e <= P.roles[i].n * (1 + 1e-7), 'supply', `${tag}: role ${i} over supply`);
    if (e < P.roles[i].n * (1 - 1e-5)) expect(near(r.wages[i], P.w, 1e-9), 'slack role earns the outside option', `${tag}: role ${i} is not fully employed but earns ${r.wages[i]} against ${P.w}`); });
  expect(near(ai, r.aiUsed, 1e-7) && ai <= P.ai.cap * (1 + 1e-7), 'AI use', `${tag}: AI ${ai} against ${r.aiUsed}`);
  if (ai < P.ai.cap * (1 - 1e-5)) expect(r.aiRent <= 1e-6 * P.r + 1e-9 || anyMarketLimited, 'idle fleet earns no rent', `${tag}: fleet not exhausted but rent ${r.aiRent}`);
  expect(near(cost, r.cost, 1e-7), 'cost', `${tag}: cost ${cost} against ${r.cost}`);
  expect(near(Wsum, r.W, 1e-7), 'total surplus', `${tag}: buyers' value minus cost = ${Wsum} against ${r.W}`);
  const rents = r.wages.reduce((a, w, i) => a + (w - P.w) * emp[i], 0);
  expect(near(rents, r.humanRents, 1e-7) && near(r.W - rents - r.aiRent * ai, r.CS, 1e-7), 'split of surplus', `${tag}: rents ${rents}/${r.humanRents}`);
  if (!anyMarketLimited) {                                     // buyers' surplus is then value minus what they pay; revenue covers all pay
    let revenue = 0, value = 0; P.markets.forEach((mk, k) => { revenue += r.markets[k].P * Qk[k]; value += U(mk, Qk[k]); });
    const pay = r.wageBill + ai * (P.r + r.aiRent);
    expect(near(revenue, pay, 3e-3), 'revenue = pay', `${tag}: revenue ${revenue.toFixed(3)} against wages and compute ${pay.toFixed(3)}`);
    expect(Math.abs(value - revenue - r.CS) <= 3e-3 * Math.max(1, revenue), 'buyers surplus', `${tag}: value minus spending ${(value - revenue).toFixed(3)} against ${r.CS.toFixed(3)}`);
  }
  let hh = 0; r.recipes.forEach(rc => { if (rc.m > 0 && Qall > 0) { const sh = rc.m * rc.a / Qk[rc.mk]; hh += (rc.x / rc.m) * sh * sh; } });
  expect(near(Math.min(1, hh), r.hhi, 1e-6), 'concentration', `${tag}: HHI ${hh} against ${r.hhi}`);
  if (P.trust) { const LH = P.roles.reduce((a, ro) => a + ro.n * ces(ro.y1, ro.y2, P.rho), 0) / P.roles.reduce((a, ro) => a + ro.n, 0), LM = ces(P.ai.y1, P.ai.y2, P.rho);
    expect(near(LM / (LM + LH), P.trust.warranted, 1e-12) && near(P.trust.level - LM / (LM + LH), P.trust.gap, 1e-12) && near(Math.max(0, -P.trust.gap) * 0.5, P.trust.oversight, 1e-12), 'trust terms', `${tag}: warranted trust`); }
}
console.log(`\n${checks} comparisons over ${solves} solves, ${bad} mismatches`);
Object.keys(count).forEach(k => console.log('  ' + String(count[k]).padStart(5) + '  ' + k));
process.exit(bad ? 1 : 0);
