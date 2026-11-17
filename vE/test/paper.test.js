/* Checks the engine against numbers printed in the paper (Sections 2, 5, 6 and Appendices D, E).
 * Run: node test/paper.test.js */
'use strict';
const OI = require('../src/engine.js');

let pass = 0, fail = 0;
function near(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: got ${Number(got).toPrecision(7)}, paper ${want} (tol ${tol})`);
}
function show(res, label) {
  console.log(`   [${label}] Q=${res.Q.toFixed(3)} W=${res.W.toFixed(4)} p=${res.markets.map(m => m.p.toFixed(5)).join('/')} P=${res.markets.map(m => m.P.toFixed(5)).join('/')} wages=${res.wages.map(w => w.toFixed(4)).join(',')} emp=${res.employed.map(e => e.toFixed(3)).join(',')} ai=${res.aiUsed.toFixed(3)} kink=${res.kink} ms=${res.ms.toFixed(1)} cols=${res.nCols}`);
  res.recipes.forEach(rc => console.log(`      mk${rc.mk} x=${rc.x.toFixed(4)} m=${rc.m.toFixed(4)} n=${rc.n.toFixed(4)} a=${rc.a.toFixed(4)} sRole=[${rc.sRole.map(v => v.toFixed(4)).join(',')}] sAI=${rc.sAI.toFixed(5)} z=${rc.z.toFixed(4)} ${OI.STATE_NAMES[rc.st]}`));
}
const VERBOSE = process.argv.includes('-v');
function run(P, label) { const r = OI.solve(P); if (VERBOSE) show(r, label); return r; }

const coder = n => ({ name: 'Coders', n, y1: 9, y2: 1, ys: 0.75 });
const writer = n => ({ name: 'Writers', n, y1: 1, y2: 9, ys: 0.75 });
const coord = n => ({ name: 'Coordinators', n, y1: 1, y2: 1, ys: 0.97 });
const noAI = { cap: 0, y1: 1, y2: 1, ys: 0.5 };
const DEEP = { P0: 0.3, S: 1e9 };
const base = { w: 0.25, r: 1, rho: -1, phi: 1.75 };

// ── Section 2.2 / App. E.3: human-only benchmarks in the deep market
let r = run({ ...base, roles: [coder(6)], ai: noAI, markets: [DEEP] }, 'coders only');
near('coders only: output', r.Q, 29.76, 0.02);
near('coders only: wage', r.wages[0], 1.488, 0.003);
near('coders only: firm size', r.recipes[0].m, 6, 1e-6);

r = run({ ...base, roles: [coder(6), writer(6)], ai: noAI, markets: [DEEP] }, 'mosaic');
near('mosaic: output', r.Q, 165.32, 0.02);
near('mosaic: coder wage', r.wages[0], 4.133, 0.01);
near('mosaic: writer wage', r.wages[1], 4.133, 0.01);

r = run({ ...base, roles: [coder(6), writer(6), coord(2)], ai: noAI, markets: [DEEP] }, 'with coordinators');
near('coordinators: output', r.Q, 181.98, 0.03);
near('coordinators: specialist wage', r.wages[0], 4.148, 0.02);
near('coordinators: coordinator wage', r.wages[2], 2.410, 0.02);
near('coordinators: firm size', r.recipes[0].m, 7.00654, 0.01);

// organisation rules reproduce the paper's counterfactual comparisons
r = run({ ...base, roles: [coder(6)], ai: noAI, markets: [DEEP], rules: { size: 'solo' } }, 'solo coders');
near('solo coders: output', r.Q, 21.79, 0.02);
r = run({ ...base, roles: [coder(12)], ai: noAI, markets: [DEEP], rules: { size: 'fixed', sizeValue: 12 } }, 'merged 12');
near('twelve coders merged: output', r.Q, 57.22, 0.03);
r = run({ ...base, roles: [coder(12)], ai: noAI, markets: [DEEP] }, 'two firms of six');
near('twelve coders in two firms: output', r.Q, 59.51, 0.03);
r = run({ ...base, roles: [coder(6), writer(6)], ai: noAI, markets: [DEEP], rules: { mosaic: false } }, 'siloed');
near('siloed single-skill firms: output', r.Q, 59.51, 0.03);
r = run({ ...base, roles: [coder(6), writer(6)], ai: noAI, markets: [DEEP], rules: { size: 'single' } }, 'one firm');
near('one merged twelve-person firm: output', r.Q, 158.93, 0.05);
r = run({ ...base, roles: [coder(6), writer(6), coord(2)], ai: noAI, markets: [DEEP], rules: { size: 'single' } }, 'one firm 14');
near('one merged fourteen-person firm: output', r.Q, 175.66, 0.05);

// ── App. D.6 / Figure 19: separate vs mixed firms
r = run({ w: 1, r: 1, rho: -1, phi: 1, roles: [{ n: 50, y1: 1, y2: 1, ys: 0.8 }], ai: { cap: Infinity, y1: 1, y2: 1, ys: 0.4 }, markets: [{ P0: 2, S: 200 }] }, 'fig19a');
near('fig 19a: output', r.Q, 108.927, 0.01);
near('fig 19a: human wage', r.wages[0], 1.469, 0.002);
near('fig 19a: machine input', r.aiUsed, 25.751, 0.01);
near('fig 19a: humans employed', r.employed[0], 50, 1e-4);
near('fig 19a: human firm size', r.recipes[0].m, 4, 1e-6);
near('fig 19a: AI firm size', r.recipes[r.recipes.length - 1].m, 2 / 3, 1e-6);

r = run({ w: 1, r: 1, rho: -1, phi: 1, roles: [{ n: 50, y1: 2, y2: 1, ys: 0.6 }], ai: { cap: Infinity, y1: 1, y2: 2, ys: 0.6 }, markets: [{ P0: 2, S: 200 }] }, 'fig19b');
near('fig 19b: output', r.Q, 147.215, 0.01);
near('fig 19b: human input', r.employed[0], 38.854, 0.02);
near('fig 19b: firm size', r.recipes[0].m, 1.5, 1e-6);
near('fig 19b: human share', r.recipes[0].sRole[0], 0.5, 2e-3);
near('fig 19b: wage', r.wages[0], 1, 1e-4);

// ── App. D.4 / Figure 23: gradual vs sudden exit
function fig23top(theta) { return run({ w: 1, r: 1, rho: -1, phi: 0.3, roles: [{ n: 20, y1: 1, y2: 2, ys: 0.9 }], ai: { cap: Infinity, y1: 1.5, y2: theta, ys: 0.9 }, markets: [{ P0: 2, S: 20 }] }, 'fig23top ' + theta); }
function shareFOC(theta) { // interior root of the first-order condition in App. D.4
  let lo = 0, hi = 1;
  const f = l => -0.5 / (1.5 - 0.5 * l) + (2 - theta) / (theta + (2 - theta) * l) - (1.5 - theta) / (1.5 + theta + (1.5 - theta) * l);
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
[1.0, 1.2, 1.4].forEach(th => {
  r = fig23top(th);
  const mixed = r.recipes.filter(x => x.sAI > 0 && x.sAI < 1);
  near(`fig 23 top θ=${th}: human share in firms`, mixed.length ? mixed[0].sRole[0] : 0, shareFOC(th), 3e-3);
  near(`fig 23 top θ=${th}: firm size`, r.recipes[0].m, 2, 1e-6);
});
r = fig23top(1.6);
near('fig 23 top θ=1.6: humans employed (exit)', r.employed[0], 0, 1e-6);

function fig23bot(theta) { return run({ w: 1, r: 1, rho: -1, phi: 0.02, roles: [{ n: 2 / 3, y1: 1.1, y2: 1.1, ys: 0.985 }], ai: { cap: Infinity, y1: theta, y2: theta, ys: 0.9999 }, markets: [{ P0: 2, S: 2000 }] }, 'fig23bot ' + theta); }
r = fig23bot(1.07);
near('fig 23 bottom θ=1.07: humans fully employed', r.employed[0], 2 / 3, 1e-6);
const lz = (z, phi) => phi - (1 - z) + (1 - z) * Math.log((1 - z) / phi);
near('fig 23 bottom θ=1.07: wage = a(1)/a(0)', r.wages[0], 1.1 * Math.exp(lz(0.985, 0.02)) / (1.07 * Math.exp(lz(0.9999, 0.02))), 2e-4);
near('fig 23 bottom θ=1.07: AI firm size', r.recipes[r.recipes.length - 1].m, 199, 0.01);
r = fig23bot(1.09);
near('fig 23 bottom θ=1.09: humans employed (sudden exit)', r.employed[0], 0, 1e-6);

// ── App. D.5 / Figure 22: coordinators move into AI firms
function fig22(theta) { return run({ w: 1, r: 1, rho: -1, phi: 3, roles: [{ n: 10, y1: 6, y2: 6, ys: 0.2 }, { n: 1, y1: 1, y2: 1, ys: 0.9 }], ai: { cap: Infinity, y1: theta, y2: theta, ys: 0.2 }, markets: [{ P0: 2, S: 3000 }] }, 'fig22 ' + theta); }
r = fig22(4);
near('fig 22 θ=4: productive wage', r.wages[0], 1.501, 0.003);
near('fig 22 θ=4: coordinator wage', r.wages[1], 1.624, 0.003);
r = fig22(12);
near('fig 22 θ=12: productive humans employed', r.employed[0], 0, 1e-6);
near('fig 22 θ=12: coordinator wage', r.wages[1], 1.005586, 2e-4);
{
  const f = r.recipes.find(x => x.sRole[1] > 0);
  near('fig 22 θ=12: coordinator share', f ? f.sRole[1] : 0, 0.0127096, 3e-4);
}

// ── Table 4: joint deep + niche markets (deep-market limit approximated by a large market)
const NICHE = { P0: 0.3, S: 200 }, BIG = { P0: 0.3, S: 200 * 4000 };
const pop = [coder(6), writer(6), coord(2)];
r = run({ ...base, roles: pop, ai: { cap: Infinity, y1: 59 / 35, y2: 59 / 35, ys: 547 / 700 }, markets: [BIG, NICHE] }, 'table4 minimal AGI');
near('table 4 minimal AGI: niche output', r.markets[1].Q, 65.259, 0.05);
near('table 4 minimal AGI: niche price', r.markets[1].p, 0.202112, 2e-5);
near('table 4 minimal AGI: specialist wage', r.wages[0], 2.90072, 0.01);
near('table 4 minimal AGI: coordinator wage', r.wages[2], 1.29801, 0.01);
near('table 4 minimal AGI: specialists employed', r.employed[0] + r.employed[1], 12, 1e-4);

r = run({ ...base, roles: pop, ai: { cap: Infinity, y1: 12, y2: 12, ys: 547 / 700 }, markets: [BIG, NICHE] }, 'table4 supercompetent');
near('table 4 supercompetent: specialist wage', r.wages[0], 0.39428, 0.004);
near('table 4 supercompetent: coordinator wage', r.wages[2], 0.47561, 0.004);
near('table 4 supercompetent: niche output', r.markets[1].Q, 181.005, 0.3);

// ── App. E.5: displacement thresholds (outside option raised to one)
function between(ys) { return run({ ...base, w: 1, roles: pop, ai: { cap: Infinity, y1: 4, y2: 4, ys }, markets: [BIG, NICHE] }, 'between ' + ys); }
r = between(0.84);
near('between-firm y*=0.84: specialists employed', r.employed[0] + r.employed[1], 12, 1e-3);
r = between(0.86);
near('between-firm y*=0.86: specialists employed', r.employed[0] + r.employed[1], 0, 1e-3);
r = between(0.80);
near('between-firm y*=0.80: specialist wage', r.wages[0], 1.14155, 0.004);

function within(theta) { return run({ ...base, w: 1, roles: pop, ai: { cap: Infinity, y1: theta, y2: theta, ys: 0.96 }, markets: [BIG, NICHE] }, 'within ' + theta); }
r = within(3);
near('within-firm θ=3: specialists employed', r.employed[0] + r.employed[1], 4.57923, 0.05);
r = within(3.15);
near('within-firm θ=3.15: specialists employed', r.employed[0] + r.employed[1], 2.39314, 0.05);
r = within(3.4);
near('within-firm θ=3.4: specialists employed', r.employed[0] + r.employed[1], 0, 1e-3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
