/* A leading role is an extension to the paper: one leader per firm, and a leader whose firm is absorbed
 * works on as a coordinator. Randomised checks of what that guarantees:
 *  - every firm with a leader has exactly one;
 *  - leaders and former leaders together never exceed the headcount, and the count of led firms equals the leaders;
 *  - with nobody in the leading role the result is the paper's.
 * Run: node test/leader.test.js [cases] [seed] */
'use strict';
const OI = require('../src/engine.js');
let seed = +process.argv[3] || 8642; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = (a, b) => a + (b - a) * rnd();
const N = +process.argv[2] || 60;
let bad = 0, checks = 0, ledTypes = 0, demotedCases = 0;
function expect(ok, msg) { checks++; if (!ok) { bad++; console.log('VIOLATION ' + msg); } }
for (let c = 0; c < N; c++) {
  const nOther = Math.floor(rnd() * 3), roles = [{ n: Math.round(pick(1, 60)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.9, 1.6), lead: true, demoteYs: pick(0.5, 1) }];
  for (let i = 0; i < nOther; i++) roles.push({ n: Math.round(pick(5, 300)), y1: pick(0.5, 10), y2: pick(0.5, 10), ys: pick(0.3, 1) });
  const P0 = pick(0.2, 2), mode = c % 4;
  const base = {
    roles, w: pick(0.1, 1), r: pick(0.3, 1.5), rho: pick(-3, 0.5), phi: pick(0.3, 2.5),
    ai: { cap: Math.round(pick(0, 10000)), y1: pick(0.5, 8), y2: pick(0.5, 8), ys: pick(0.5, 1.08) },
    markets: [{ P0, S: Math.exp(pick(6, 13)) }],
    trust: mode === 1 ? { on: true, level: rnd() } : null, inter: mode === 2 ? { on: true, goods: rnd(), services: rnd(), ip: rnd() } : null
  };
  const tag = `case ${c}`, r = OI.solve(base);
  expect(isFinite(r.W) && r.W >= -1e-9, `${tag}: surplus ${r.W}`);
  r.wages.forEach(w => expect(w >= base.w - 1e-9, `${tag}: wage ${w}`));
  r.employed.forEach((e, i) => expect(e <= roles[i].n * (1 + 1e-6) + 1e-6, `${tag}: role ${i} employment ${e} > ${roles[i].n}`));
  if (r.empty || !r.lead) continue;
  let ledFirms = 0;
  r.recipes.forEach((rc, j) => {
    const sum = rc.sAI + rc.sRole.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1) < 1e-6, `${tag}: shares add to ${sum}`);
    if (rc.sLead > 1e-12 && rc.m > 0) {
      ledTypes++; ledFirms += rc.x / rc.m;
      expect(Math.abs(rc.sLead * rc.m - 1) < 1e-6, `${tag}: firm type ${j} has ${(rc.sLead * rc.m).toFixed(4)} leaders per firm (size ${rc.m.toFixed(2)}, ${OI.STATE_NAMES[rc.st]})`);
    }
  });
  expect(Math.abs(ledFirms - r.lead.leading) < 1e-6 * Math.max(1, ledFirms), `${tag}: ${ledFirms.toFixed(4)} led firms but ${r.lead.leading.toFixed(4)} leaders`);
  expect(Math.abs(r.lead.leading + r.lead.demoted - r.employed[0]) < 1e-6 * Math.max(1, r.employed[0]), `${tag}: leaders ${r.lead.leading} + former ${r.lead.demoted} against ${r.employed[0]} employed`);
  if (r.lead.demoted > 1e-6) demotedCases++;
  // nobody in the leading role: the paper's model for the rest
  const none = JSON.parse(JSON.stringify(base)); none.roles[0].n = 0;
  const plain = JSON.parse(JSON.stringify(none)); plain.roles[0].lead = false;
  expect(OI.solve(none).W === OI.solve(plain).W, `${tag}: an empty leading role changed the result`);
}
console.log(`\n${checks} checks (${ledTypes} led firm types, ${demotedCases} cases with former leaders), ${bad} violations`);
process.exit(bad ? 1 : 0);
