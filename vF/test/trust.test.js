/* Trust is an extension to the paper. These randomised checks cover what the extension guarantees:
 *  - switched off, or on at exactly the level the AI warrants, the result is the paper's, to the last digit;
 *  - trusting the AI less than it warrants never raises total surplus, and no firm exceeds the AI share people allow;
 *  - with the speed effect removed, over-trust never raises surplus; with only the speed effect, more trust never lowers it;
 *  - with only people, or only AI, trust changes nothing;
 *  - wages and the compute rent still equal what the employing firm would bid (the human-AI mix term included).
 * Run: node test/trust.test.js [cases] [seed] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 2468; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 40;
let bad = 0, checks = 0, solves = 0, maxMs = 0, sumMs = 0, bidChecks = 0;
function solve(P, o) { const r = OI.solve(P, o); solves++; sumMs += r.ms; if (r.ms > maxMs) maxMs = r.ms; return r; }
function expect(ok, msg) { checks++; if (!ok) { bad++; console.log('VIOLATION ' + msg); } }
const withTrust = (base, t, rules) => Object.assign({}, base, { trust: t }, rules ? { rules } : {});
function sane(r, P, tag) {
  expect(isFinite(r.W) && r.W >= -1e-9, `${tag}: surplus ${r.W}`);
  r.wages.forEach(w => expect(isFinite(w) && w >= P.w - 1e-9, `${tag}: wage ${w} below the outside option`));
  r.employed.forEach((e, i) => expect(e <= P.roles[i].n * (1 + 1e-6) + 1e-6, `${tag}: role ${i} employment ${e} > ${P.roles[i].n}`));
  expect(r.aiUsed <= P.ai.cap * (1 + 1e-6) + 1e-6, `${tag}: AI ${r.aiUsed} > fleet ${P.ai.cap}`);
}
for (let c = 0; c < N; c++) {
  const nRoles = 1 + Math.floor(rnd() * 3), roles = [];
  for (let i = 0; i < nRoles; i++) roles.push({ n: Math.round(pick(5, 400)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.2, 1.05) });
  const two = rnd() < 0.25, P0 = pick(0.2, 2);
  const base = {
    roles, w: pick(0.1, 1.2), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.05, 2.5),
    ai: { cap: Math.round(pick(50, 10000)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.2, 1.05) },
    markets: two ? [{ P0, S: Math.exp(pick(6, 13)) }, { P0, S: Math.exp(pick(4, 8)) }] : [{ P0, S: Math.exp(pick(5, 13)) }]
  };
  const tag = `case ${c} (${nRoles} roles${two ? ', 2 markets' : ''})`;
  const free = solve(base);
  // off is the paper's model
  const off = solve(withTrust(base, { on: false, level: rnd() }));
  expect(off.W === free.W && off.Q === free.Q, `${tag}: trust switched off changed the result ${free.W} -> ${off.W}`);
  // only people, or only AI: nothing to trust
  const noAI = Object.assign({}, base, { ai: Object.assign({}, base.ai, { cap: 0 }) });
  expect(solve(withTrust(noAI, { on: true, level: 0.1 })).W === solve(noAI).W, `${tag}: trust mattered with no AI`);
  const noPeople = Object.assign({}, base, { roles: roles.map(r => Object.assign({}, r, { n: 0 })) });
  expect(solve(withTrust(noPeople, { on: true, level: 0.1 })).W === solve(noPeople).W, `${tag}: trust mattered with no people`);
  const q = OI.normalize(withTrust(base, { on: true, level: 0.5 })).trust.warranted;
  expect(q > 0 && q < 1, `${tag}: warranted trust ${q} outside (0, 1)`);
  // on at the warranted level is the paper's model too
  const cal = solve(withTrust(base, { on: true, level: q }));
  expect(cal.W === free.W && cal.Q === free.Q, `${tag}: trust at the warranted level ${q.toFixed(3)} changed the result ${free.W} -> ${cal.W}`);
  // under-trust: surplus can only fall, and the oversight share binds every firm
  let prev = cal;
  for (const f of [0.75, 0.5, 0.25, 0]) {
    const P = withTrust(base, { on: true, level: q * f }), r = solve(P), need = r.P.trust.oversight;
    sane(r, base, `${tag} trust ${(q * f).toFixed(3)}`);
    expect(r.W <= prev.W * (1 + 2e-4) + 1e-6, `${tag}: less trust raised surplus ${prev.W.toFixed(4)} -> ${r.W.toFixed(4)} at ${(q * f).toFixed(3)}`);
    r.recipes.forEach(rc => expect(rc.sAI <= 1 - need + 1e-6, `${tag}: a firm is ${(100 * rc.sAI).toFixed(1)}% AI, above the ${(100 * (1 - need)).toFixed(1)}% people allow`));
    r.recipes.forEach(rc => { const sum = rc.sAI + rc.sRole.reduce((a, b) => a + b, 0); expect(Math.abs(sum - 1) < 1e-6, `${tag}: a firm's shares add to ${sum.toFixed(4)}, not 1`); });
    prev = r;
  }
  // over-trust
  for (const f of [0.33, 0.66, 1]) {
    const lv = q + (1 - q) * f;
    sane(solve(withTrust(base, { on: true, level: lv })), base, `${tag} trust ${lv.toFixed(3)}`);
    const errOnly = solve(withTrust(base, { on: true, level: lv, kc: 0 }));
    expect(errOnly.W <= free.W * (1 + 2e-4) + 1e-6, `${tag}: errors alone raised surplus ${free.W.toFixed(4)} -> ${errOnly.W.toFixed(4)} at ${lv.toFixed(3)}`);
  }
  // speed alone: more trust can only help
  prev = null;
  for (const lv of [0, 0.25, 0.5, 0.75, 1]) {
    const r = solve(withTrust(base, { on: true, level: lv, ke: 0, kh: 0 }));
    if (prev) expect(r.W >= prev.W * (1 - 2e-4) - 1e-6, `${tag}: speed alone, more trust lowered surplus ${prev.W.toFixed(4)} -> ${r.W.toFixed(4)} at ${lv}`);
    prev = r;
  }
  // one organisation goes through its own solver
  const one = { size: 'single' }, oneFree = solve(Object.assign({}, base, { rules: one }));
  expect(solve(withTrust(base, { on: true, level: q }, one)).W === oneFree.W, `${tag}: one organisation, warranted trust changed the result`);
  const oneLow = solve(withTrust(base, { on: true, level: q * 0.3 }, one));
  expect(oneLow.W <= oneFree.W * (1 + 2e-4) + 1e-6, `${tag}: one organisation, less trust raised surplus ${oneFree.W} -> ${oneLow.W}; free ${JSON.stringify(oneFree.recipes[0] && oneFree.recipes[0].sT)} m ${oneFree.largest}, low ${JSON.stringify(oneLow.recipes[0] && oneLow.recipes[0].sT)} m ${oneLow.largest}; ${process.env.DUMPJ ? JSON.stringify(base) : ''}`);
  // a quick solve stays close to the full one
  const lvR = rnd(), full = solve(withTrust(base, { on: true, level: lvR })), fast = solve(withTrust(base, { on: true, level: lvR }), { fast: true });
  expect(Math.abs(fast.W - full.W) <= 2e-3 * Math.abs(full.W) + 1e-6, `${tag}: fast solve off by ${(100 * (fast.W / full.W - 1)).toFixed(3)}% at trust ${lvR.toFixed(3)}`);
  // pay equals the employer's bid in firms at their preferred size, human-AI mix term included.
  // A firm held at the AI share people allow is left out: there a person is also worth the copies they license.
  // Typical mismatch is about 0.001%; the 4% allowance covers the rare case where two near-identical recipes bracket the optimum.
  const limit = 1 - full.P.rules.minHuman, TOL = 0.04;
  full.recipes.forEach((rc, j) => {
    if (rc.st !== OI.ST_PREF || !(rc.m > 0) || rc.sAI > limit - 1e-4) return;
    rc.sRole.forEach((sh, i) => {
      if (sh < 0.03 || full.employed[i] < roles[i].n * (1 - 1e-6)) return;
      const b = OI.bid(full.P, rc, full.P.roles[i], false); bidChecks++;
      expect(Math.abs(b - full.wages[i]) <= TOL * full.wages[i] + 1e-6, `${tag}: role ${i} is paid ${full.wages[i].toFixed(4)} but recipe ${j} bids ${b.toFixed(4)} (trust ${lvR.toFixed(3)}, AI share ${rc.sAI.toFixed(3)})`);
    });
    if (rc.sAI >= 0.03 && rc.sAI < 1 - 1e-9) {
      const b = OI.bid(full.P, rc, full.P.ai, true), cost = full.P.r + full.aiRent; bidChecks++;
      expect(Math.abs(b - cost) <= TOL * cost + 1e-6, `${tag}: a copy costs ${cost.toFixed(4)} but recipe ${j} bids ${b.toFixed(4)} (trust ${lvR.toFixed(3)}, AI share ${rc.sAI.toFixed(3)})`);
    }
  });
}
console.log(`\n${checks} checks (${bidChecks} of pay against bids), ${bad} violations; ${solves} solves, mean ${(sumMs / solves).toFixed(1)} ms, slowest ${maxMs.toFixed(0)} ms`);
process.exit(bad ? 1 : 0);
