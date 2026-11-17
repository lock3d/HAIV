/* Checks the three society extensions of vF (none of them is in the paper):
 *   reskilling   people can retrain into another role at a cost per person
 *   compute tax  firms pay a tax on every AI copy; the revenue is paid back to people
 *   fleet stake  a share of the fleet's scarcity rent belongs to people
 * Each is checked against what it must do by its definition: switched off, or at no effect, it
 * leaves the paper's numbers alone; switched on, it keeps headcounts and the accounts whole.
 * Run: node test/society.test.js [cases] [seed] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 271828; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 120;
let bad = 0, checks = 0, solves = 0; const count = {};
function expect(ok, kind, msg) { checks++; count[kind] = (count[kind] || 0) + 1; if (!ok) { bad++; if (bad <= 40) console.log('VIOLATION [' + kind + '] ' + msg); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const solve = P => { solves++; return OI.solve(JSON.parse(JSON.stringify(P))); };

// ── the Gini index on cases worked by hand ──
expect(OI.gini([{ n: 5, x: 2 }]) === 0, 'gini by hand', 'one group');
expect(Math.abs(OI.gini([{ n: 1, x: 0 }, { n: 1, x: 1 }]) - 0.5) < 1e-12, 'gini by hand', 'two people, one has all: 0.5');
expect(Math.abs(OI.gini([{ n: 3, x: 1 }, { n: 1, x: 1 }]) - 0) < 1e-12, 'gini by hand', 'equal incomes in two groups');
expect(Math.abs(OI.gini([{ n: 1, x: 1 }, { n: 1, x: 2 }, { n: 1, x: 3 }]) - 2 / 9) < 1e-12, 'gini by hand', 'incomes 1, 2, 3: 2/9');

function randomCase(c) {
  const nR = 2 + Math.floor(rnd() * 3), roles = [];
  for (let i = 0; i < nR; i++) roles.push({ name: 'r' + i, n: i > 0 && rnd() < 0.12 ? 0 : Math.round(pick(10, 400)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.3, 0.99) });
  return {
    roles, w: pick(0.1, 1), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.3, 2.5),
    ai: { cap: rnd() < 0.15 ? 0 : Math.round(Math.exp(pick(4, 9.5))), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.3, 1.1) },
    markets: [{ P0: pick(0.2, 2), S: Math.exp(pick(7, 12)) }],
    rules: { size: c % 9 === 4 ? 'cap' : 'free', sizeValue: Math.round(pick(3, 40)), mixed: rnd() > 0.1, mosaic: rnd() > 0.1, minHuman: 0 }
  };
}
const H = P => P.roles.reduce((a, r) => a + r.n, 0);
function accounts(R, P, tag) {
  const d = R.dist;
  expect(near(R.CS + R.humanRents + R.aiRentTotal + (R.tax || 0), R.W, 1e-7), 'surplus adds up', tag + ' buyers + people + fleet + tax = ' + (R.CS + R.humanRents + R.aiRentTotal + R.tax) + ' vs W ' + R.W);
  expect(near(d.buyers + d.premium + d.dividends + d.owners + d.unclaimed, R.W, 1e-7), 'who gets what adds up', tag + ' ' + JSON.stringify(d));
  expect(d.gini >= -1e-12 && d.gini < 1, 'gini in range', tag + ' gini ' + d.gini);
  const Hp = H(P);
  if (Hp > 0) expect(near(d.income, (R.P.w * Hp + R.humanRents + d.dividends) / Hp, 1e-9), 'income per person', tag);
}

for (let c = 0; c < N; c++) {
  const P = randomCase(c), R0 = solve(P), tag = '#' + c;
  if (R0.empty) continue;
  accounts(R0, P, tag + ' off');

  // ── reskilling ──
  const kappa = Math.exp(pick(-4, 1));
  const Pk = Object.assign({}, P, { reskill: { on: true, cost: kappa } }), Rk = solve(Pk);
  if (!Rk.empty) {
    accounts(Rk, P, tag + ' reskill');
    const now = Rk.roleNow, start = H(P);
    expect(near(now.reduce((a, b) => a + b, 0), start, 1e-9), 'nobody appears or vanishes', tag + ' ' + now.join(',') + ' vs ' + start);
    now.forEach((v, i) => {
      expect(v >= -1e-9, 'headcounts stay whole', tag + ' role ' + i + ' now ' + v);
      expect(Rk.working[i] <= v * (1 + 1e-6) + 1e-6, 'nobody works in a role they are not in', tag + ' role ' + i + ' works ' + Rk.working[i] + ' of ' + v);
      expect(Rk.employed[i] <= P.roles[i].n * (1 + 1e-6) + 1e-6, 'employment by origin fits the origin', tag + ' role ' + i);
    });
    // retraining is open to everyone in a role that has people: no role can pay more than that role's wage plus the cost
    for (let a = 0; a < P.roles.length; a++) for (let b = 0; b < P.roles.length; b++) {
      if (a === b || !(P.roles[a].n > 0) || !(now[b] > 1e-6)) continue;
      expect(Rk.wages[b] - Rk.wages[a] <= kappa * (1 + 1e-3) + 1e-4, 'no gap above the cost of retraining', tag + ' ' + a + '>' + b + ' gap ' + (Rk.wages[b] - Rk.wages[a]) + ' cost ' + kappa);
    }
    // and where people do retrain, it pays exactly: the gap equals the cost
    (Rk.reskill ? Rk.reskill.flows : []).forEach(f => {
      if (f.n < 1e-3 * start) return;
      expect(Math.abs(Rk.wages[f.to] - Rk.wages[f.from] - kappa) <= 2e-3 * Math.max(1, kappa) + 1e-4, 'retraining pays exactly its cost', tag + ' ' + f.from + '>' + f.to + ' gap ' + (Rk.wages[f.to] - Rk.wages[f.from]) + ' cost ' + kappa);
      expect(P.roles[f.from].n > 0, 'only people who exist move', tag);
    });
    if (Rk.reskill) expect(near(Rk.reskill.spent, kappa * Rk.reskill.moved, 1e-12), 'retraining is paid for', tag);
    // more options never lose surplus, and a cost above every gap changes nothing
    expect(Rk.W >= R0.W * (1 - 2e-3) - 1e-6, 'retraining never costs surplus', tag + ' ' + Rk.W + ' vs ' + R0.W);
    // retraining far dearer than anything a person could add changes nothing. (Today's wage gaps are no
    // bound: at another output the gaps differ, and a role nobody holds yet has no wage to show.)
    const Rbig = solve(Object.assign({}, P, { reskill: { on: true, cost: 1e6 } }));
    expect(near(Rbig.W, R0.W, 2e-3), 'too dear to retrain: the paper', tag + ' W ' + Rbig.W + ' vs ' + R0.W);
    expect(!Rbig.reskill || Rbig.reskill.moved < 1e-6 * start + 1e-6, 'too dear to retrain: nobody moves', tag + ' moved ' + (Rbig.reskill && Rbig.reskill.moved));
    // dearer retraining never adds surplus
    const Rk2 = solve(Object.assign({}, P, { reskill: { on: true, cost: kappa * 3 } }));
    expect(Rk2.W <= Rk.W * (1 + 2e-3) + 1e-6, 'dearer retraining never adds surplus', tag + ' ' + Rk2.W + ' vs ' + Rk.W);
    // no firm needs more people in a role than the role ends up with
    Rk.recipes.forEach(rc => rc.sRole.forEach((sh, i) => {
      if (rc.m > 0 && rc.m < Infinity && sh > 0) expect(rc.m * sh <= now[i] * (1 + 1e-3) + 1e-3, 'every firm fits its roles', tag + ' needs ' + (rc.m * sh) + ' of role ' + i + ', has ' + now[i]);
    }));
    // the stage: whole people stand in the role they are in now
    const real = OI.realize(Rk);
    if (real.roleCount) expect(real.roleCount.reduce((a, b) => a + b, 0) === Math.round(start), 'drawn people add up', tag);
  }

  // ── compute tax ──
  if (P.ai.cap > 0) {
    const pol = t => solve(Object.assign({}, P, { policy: { on: true, tax: t, own: 0 } }));
    const Rt0 = pol(0);
    expect(near(Rt0.W, R0.W, 1e-9) && near(Rt0.aiUsed, R0.aiUsed, 1e-9), 'a zero tax changes nothing', tag);
    let prevAI = Infinity, prevW = Infinity;
    [0.1, 0.4, 1.2].forEach(t => {
      const Rt = pol(t);
      if (Rt.empty) return;
      accounts(Rt, P, tag + ' tax ' + t);
      expect(near(Rt.tax, t * P.r * Rt.aiUsed, 1e-9), 'tax revenue is tax times copies', tag + ' tax ' + t);
      expect(Rt.W <= R0.W * (1 + 2e-3) + 1e-6, 'a tax never adds surplus', tag + ' tax ' + t + ' W ' + Rt.W + ' vs ' + R0.W);
      expect(Rt.aiUsed <= Math.min(prevAI, R0.aiUsed) * (1 + 2e-3) + 1e-3, 'a higher tax never adds copies', tag + ' tax ' + t + ' ai ' + Rt.aiUsed);
      expect(Rt.W <= prevW * (1 + 2e-3) + 1e-6, 'surplus falls with the tax', tag + ' tax ' + t);
      prevAI = Rt.aiUsed; prevW = Rt.W;
    });
    // a tax below the fleet's scarcity rent only moves that rent
    if (R0.aiRent > 0.05 && R0.aiUsed >= P.ai.cap * (1 - 1e-6) && 0.4 * R0.aiRent / P.r <= 10) {   // the tax tops out at 10 times the copy's cost
      const t = 0.4 * R0.aiRent / P.r, Rs = pol(t);
      expect(near(Rs.Q, R0.Q, 2e-3) && near(Rs.aiUsed, R0.aiUsed, 2e-3), 'a tax inside the rent leaves the industry', tag + ' Q ' + Rs.Q + ' vs ' + R0.Q);
      // at a capacity limit the split of rents between people and the fleet need not be unique, so what must hold is
      // their total: the tax takes its revenue out of the rents and leaves buyers alone
      const rents0 = R0.humanRents + R0.aiRentTotal, rents = Rs.humanRents + Rs.aiRentTotal + Rs.tax;
      expect(near(rents, rents0, 2e-3) && near(Rs.CS, R0.CS, 2e-3), 'a tax inside the rent comes out of the rents', tag + ' rents ' + rents + ' vs ' + rents0);
      expect(Rs.aiRent <= R0.aiRent * (1 + 1e-3) + 1e-6, 'a tax never raises the fleet rent', tag);
    }
    // ── a stake in the fleet moves income, never the industry ──
    const own = o => solve(Object.assign({}, P, { policy: { on: true, tax: 0, own: o } }));
    const Ro = own(1);
    expect(near(Ro.W, R0.W, 1e-9) && near(Ro.Q, R0.Q, 1e-9), 'ownership leaves the industry', tag);
    if (H(P) > 0) expect(near(Ro.dist.dividends, R0.aiRentTotal, 1e-9), 'people own all the rent', tag);
    accounts(Ro, P, tag + ' own');
  }
}
const kinds = Object.keys(count).sort();
console.log(kinds.map(k => '  ' + String(count[k]).padStart(5) + '  ' + k).join('\n'));
console.log(checks + ' checks, ' + bad + ' violations; ' + solves + ' solves');
process.exitCode = bad ? 1 : 0;
