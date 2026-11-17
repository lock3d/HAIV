/* Randomised checks of properties the model guarantees:
 *  - better AI never lowers total surplus (paper, Proposition 8);
 *  - a larger fleet, or lifting an organisation rule, never lowers total surplus;
 *  - wages never fall below the outside option, employment never exceeds supply;
 *  - every firm's shares of roles and AI add to one, and a human-share mandate binds every firm.
 * Run: node test/invariants.test.js [cases] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 60;
let bad = 0, checks = 0, maxMs = 0, sumMs = 0, solves = 0;
function solve(P, o) { const r = OI.solve(P, o); solves++; sumMs += r.ms; if (r.ms > maxMs) maxMs = r.ms; return r; }
function expect(ok, msg) { checks++; if (!ok) { bad++; console.log('VIOLATION ' + msg); } }
for (let c = 0; c < N; c++) {
  const nRoles = 1 + Math.floor(rnd() * 4), roles = [];
  for (let i = 0; i < nRoles; i++) roles.push({ n: Math.round(pick(5, 400)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.2, 1.05) });
  const two = rnd() < 0.3, P0 = pick(0.2, 2);
  const base = {
    roles, w: pick(0.1, 1.2), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.05, 2.5),
    ai: { cap: Math.round(pick(0, 10000)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.2, 0.98) },
    markets: two ? [{ P0, S: Math.exp(pick(6, 13)) }, { P0, S: Math.exp(pick(4, 8)) }] : [{ P0, S: Math.exp(pick(5, 13)) }]
  };
  const tag = `case ${c} (${nRoles} roles${two ? ', 2 markets' : ''})`;
  let prev = null;
  // AI improves along a path that crosses the scale threshold
  for (let k = 0; k <= 5; k++) {
    const P = JSON.parse(JSON.stringify(base)); P.ai.y1 *= 1 + 0.25 * k; P.ai.y2 *= 1 + 0.25 * k; P.ai.ys = base.ai.ys + (1.08 - base.ai.ys) * k / 5;
    const r = solve(P);
    expect(isFinite(r.W) && r.W >= -1e-9, `${tag} step ${k}: surplus ${r.W}`);
    r.wages.forEach((w, i) => expect(w >= P.w - 1e-9 && isFinite(w), `${tag} step ${k}: wage ${w} below outside option`));
    r.employed.forEach((e, i) => expect(e <= roles[i].n * (1 + 1e-6) + 1e-6, `${tag} step ${k}: role ${i} employment ${e} > ${roles[i].n}`));
    expect(r.aiUsed <= P.ai.cap * (1 + 1e-6) + 1e-6, `${tag} step ${k}: AI ${r.aiUsed} > cap ${P.ai.cap}`);
    if (prev) expect(r.W >= prev.W * (1 - 2e-4) - 1e-6, `${tag} step ${k}: better AI lowered surplus ${prev.W.toFixed(3)} -> ${r.W.toFixed(3)}`);
    prev = r;
  }
  // rules can only cost surplus; a bigger fleet can only help
  const free = solve(base);
  for (const rules of [{ mixed: false }, { mosaic: false }, { size: 'solo' }, { size: 'cap', sizeValue: 5 }, { size: 'fixed', sizeValue: 20 }, { minHuman: 0.4 }, { size: 'single' }]) {
    const r = solve(Object.assign({}, base, { rules }));
    expect(r.W <= free.W * (1 + 2e-4) + 1e-6, `${tag}: rule ${JSON.stringify(rules)} beat the free equilibrium ${free.W.toFixed(3)} < ${r.W.toFixed(3)}`);
    r.recipes.forEach(rc => {
      const sum = rc.sAI + rc.sRole.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1) < 1e-6, `${tag}: rule ${JSON.stringify(rules)}: a firm's shares add to ${sum.toFixed(4)}, not 1`);
      if (rules.minHuman) expect(rc.sAI <= 1 - rules.minHuman + 1e-6, `${tag}: a firm is ${(100 * rc.sAI).toFixed(1)}% AI under a ${100 * rules.minHuman}% human mandate`);
    });
  }
  const more = solve(Object.assign({}, base, { ai: Object.assign({}, base.ai, { cap: base.ai.cap + 2000 }) }));
  expect(more.W >= free.W * (1 - 2e-4) - 1e-6, `${tag}: a larger fleet lowered surplus ${free.W.toFixed(3)} -> ${more.W.toFixed(3)}`);
  const fast = solve(base, { fast: true });
  expect(Math.abs(fast.W - free.W) <= 2e-3 * Math.abs(free.W) + 1e-6, `${tag}: fast solve off by ${(100 * (fast.W / free.W - 1)).toFixed(3)}%`);
}
console.log(`\n${checks} checks, ${bad} violations; ${solves} solves, mean ${(sumMs / solves).toFixed(1)} ms, slowest ${maxMs.toFixed(0)} ms`);
process.exit(bad ? 1 : 0);
