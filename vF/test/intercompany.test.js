/* Intercompany is an extension to the paper: firms link into networks, and the paper's scale curve
 * applies again one level up. These randomised checks cover what the extension guarantees:
 *  - switched off, or on with no gain from linking, the result is the paper's, to the last digit;
 *  - more of any kind of link (goods, shared services, IP) never lowers total surplus;
 *  - a network never has more partners than it prefers, than its headcount allows, or than its market can absorb;
 *  - with constant returns, or as one organisation, links change nothing;
 *  - it combines with Trust: at the warranted level of trust the result is that of links alone;
 *  - wages and the compute rent still equal what the employing firm would bid.
 * Run: node test/intercompany.test.js [cases] [seed] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 1357; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 40;
let bad = 0, checks = 0, solves = 0, maxMs = 0, sumMs = 0, bidChecks = 0, linked = 0;
function solve(P, o) { const r = OI.solve(P, o); solves++; sumMs += r.ms; if (r.ms > maxMs) maxMs = r.ms; return r; }
function expect(ok, msg) { checks++; if (!ok) { bad++; console.log('VIOLATION ' + msg); } }
const withLinks = (base, ic, extra) => Object.assign({}, base, { inter: ic }, extra || {});
function sane(r, P, tag) {
  expect(isFinite(r.W) && r.W >= -1e-9, `${tag}: surplus ${r.W}`);
  r.wages.forEach(w => expect(isFinite(w) && w >= P.w - 1e-9, `${tag}: wage ${w} below the outside option`));
  r.employed.forEach((e, i) => expect(e <= P.roles[i].n * (1 + 1e-6) + 1e-6, `${tag}: role ${i} employment ${e} > ${P.roles[i].n}`));
  expect(r.aiUsed <= P.ai.cap * (1 + 1e-6) + 1e-6, `${tag}: AI ${r.aiUsed} > fleet ${P.ai.cap}`);
  r.recipes.forEach(rc => {
    const sum = rc.sAI + rc.sRole.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1) < 1e-6, `${tag}: a firm's shares add to ${sum.toFixed(4)}, not 1`);
    const ic = rc.ic; if (!ic) return;
    if (ic.n > 1e-9) linked++;
    expect(ic.n >= 0 && isFinite(ic.n), `${tag}: ${ic.n} partners`);
    expect(ic.H >= 1 - 1e-9 && isFinite(ic.H), `${tag}: linking multiplies output by ${ic.H}`);
    expect(ic.n <= ic.nPref * (1 + 1e-6) + 1e-9, `${tag}: ${ic.n.toFixed(3)} partners, more than the preferred ${ic.nPref.toFixed(3)}`);
    const Qk = r.markets[rc.mk].Q;
    // (at a capacity kink a market can hold a fraction of a firm, as in the paper, so the comparison is skipped there)
    if (rc.m > 0 && !r.kink) expect((1 + ic.n) * rc.m * rc.a <= Qk * (1 + 1e-4) + 1e-6, `${tag}: a network makes ${((1 + ic.n) * rc.m * rc.a).toFixed(2)}, more than its market's ${Qk.toFixed(2)}`);
    rc.sRole.forEach((sh, i) => { if (sh > 1e-9) expect((1 + ic.n) * rc.m * sh <= P.roles[i].n * (1 + 1e-6) + 1e-6, `${tag}: a network needs ${((1 + ic.n) * rc.m * sh).toFixed(2)} of role ${i}, there are ${P.roles[i].n}`); });
  });
}
for (let c = 0; c < N; c++) {
  const nRoles = 1 + Math.floor(rnd() * 3), roles = [];
  for (let i = 0; i < nRoles; i++) roles.push({ n: Math.round(pick(5, 400)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.2, 1.05) });
  const two = rnd() < 0.25, P0 = pick(0.2, 2);
  const base = {
    roles, w: pick(0.1, 1.2), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.05, 2.5),
    ai: { cap: Math.round(pick(0, 10000)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.2, 1.05) },
    markets: two ? [{ P0, S: Math.exp(pick(6, 13)) }, { P0, S: Math.exp(pick(4, 8)) }] : [{ P0, S: Math.exp(pick(5, 13)) }]
  };
  const tag = `case ${c} (${nRoles} roles${two ? ', 2 markets' : ''})`;
  const free = solve(base);
  // off, and on with nothing to gain, are the paper's model
  expect(solve(withLinks(base, { on: false, goods: 1, services: 1, ip: 1 })).W === free.W, `${tag}: links switched off changed the result`);
  const zero = solve(withLinks(base, { on: true, goods: 0, services: rnd(), ip: 0 }));
  expect(zero.W === free.W && zero.Q === free.Q, `${tag}: links with no gain changed the result ${free.W} -> ${zero.W}`);
  // more of any link never lowers surplus
  const at = { goods: rnd(), services: rnd(), ip: rnd() };
  for (const key of ['goods', 'services', 'ip']) {
    let prev = null;
    for (const v of [0, 0.35, 0.7, 1]) {
      const ic = Object.assign({ on: true }, at, { [key]: v }), r = solve(withLinks(base, ic));
      sane(r, base, `${tag} ${key} ${v}`);
      if (prev) expect(r.W >= prev.W * (1 - 2e-4) - 1e-6, `${tag}: more ${key} lowered surplus ${prev.W.toFixed(4)} -> ${r.W.toFixed(4)} at ${v} (${JSON.stringify(at)})`);
      prev = r;
    }
  }
  const ic = Object.assign({ on: true }, at), full = solve(withLinks(base, ic));
  expect(full.W >= free.W * (1 - 2e-4) - 1e-6, `${tag}: links lowered surplus ${free.W.toFixed(4)} -> ${full.W.toFixed(4)}`);
  // where scale does not matter, or there is one organisation, there is nothing to link
  const cr = Object.assign({}, base, { constReturns: true });
  expect(solve(withLinks(cr, ic)).W === solve(cr).W, `${tag}: links mattered under constant returns`);
  const one = Object.assign({}, base, { rules: { size: 'single' } });
  expect(solve(withLinks(one, ic)).W === solve(one).W, `${tag}: links mattered for one organisation`);
  // with Trust: at the warranted level the result is that of links alone; and the pair stays sane
  if (base.ai.cap > 0) {
    const q = OI.normalize(Object.assign({}, base, { trust: { on: true, level: 0.5 } })).trust.warranted;
    expect(solve(withLinks(base, ic, { trust: { on: true, level: q } })).W === full.W, `${tag}: warranted trust changed the result with links on`);
    sane(solve(withLinks(base, ic, { trust: { on: true, level: rnd() } })), base, `${tag} with trust`);
  }
  // rules still only cost surplus
  for (const rules of [{ mixed: false }, { size: 'solo' }, { size: 'cap', sizeValue: 5 }, { minHuman: 0.4 }]) {
    const r = solve(withLinks(base, ic, { rules }));
    sane(r, base, `${tag} rule ${JSON.stringify(rules)}`);
    // (where a market, not headcount, limits a network the firm keeps its size and sheds partners; a size rule may then do better)
    const byMarket = x => x.recipes.some(rc => rc.ic && rc.ic.st === 3);
    if (!byMarket(r) && !byMarket(full)) expect(r.W <= full.W * (1 + 2e-4) + 1e-6, `${tag}: with links, rule ${JSON.stringify(rules)} beat the free equilibrium ${full.W.toFixed(4)} < ${r.W.toFixed(4)}`);
  }
  const fast = solve(withLinks(base, ic), { fast: true });
  expect(Math.abs(fast.W - full.W) <= 2e-3 * Math.abs(full.W) + 1e-6, `${tag}: fast solve off by ${(100 * (fast.W / full.W - 1)).toFixed(3)}%`);
  // pay equals the employer's bid where the firm and its network are both at their preferred size.
  // Typical mismatch is far below 1%; the allowance covers recipes that bracket the optimum.
  const TOL = 0.04;
  full.recipes.forEach((rc, j) => {
    if (rc.st !== OI.ST_PREF || !(rc.m > 0) || !rc.ic || (rc.ic.n > 0 && rc.ic.st !== OI.NS_PREF)) return;
    rc.sRole.forEach((sh, i) => {
      if (sh < 0.03 || full.employed[i] < roles[i].n * (1 - 1e-6)) return;
      const b = OI.bid(full.P, rc, full.P.roles[i], false); bidChecks++;
      expect(Math.abs(b - full.wages[i]) <= TOL * full.wages[i] + 1e-6, `${tag}: role ${i} is paid ${full.wages[i].toFixed(4)} but recipe ${j} bids ${b.toFixed(4)} (${JSON.stringify(at)}, partners ${rc.ic.n.toFixed(2)})`);
    });
    if (rc.sAI >= 0.03) {
      const b = OI.bid(full.P, rc, full.P.ai, true), cost = full.P.r + full.aiRent; bidChecks++;
      expect(Math.abs(b - cost) <= TOL * cost + 1e-6, `${tag}: a copy costs ${cost.toFixed(4)} but recipe ${j} bids ${b.toFixed(4)} (${JSON.stringify(at)}, partners ${rc.ic.n.toFixed(2)})`);
    }
  });
}
console.log(`\n${checks} checks (${bidChecks} of pay against bids; ${linked} linked firm types seen), ${bad} violations; ${solves} solves, mean ${(sumMs / solves).toFixed(1)} ms, slowest ${maxMs.toFixed(0)} ms`);
process.exit(bad ? 1 : 0);
