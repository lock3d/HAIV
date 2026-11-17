/* Scenes: starting points for the sandbox. "Paper" scenes use the calibrations printed in
 * Imas, Koh and Legg (2026); where a population is scaled up, markets are scaled with it,
 * which leaves prices, wages and firm sizes unchanged. */
(function (root) {
  'use strict';
  var Y_AGI = 59 / 35, Z_AGI = 547 / 700;       // average standalone human competence and coordination (App. E.1)

  function roles3(c, w, k) {
    return [
      { id: 'coder', name: 'Coders', share: c, y1: 9, y2: 1, ys: 0.75, color: 'r1' },
      { id: 'writer', name: 'Writers', share: w, y1: 1, y2: 9, ys: 0.75, color: 'r2' },
      { id: 'coord', name: 'Coordinators', share: k, y1: 1, y2: 1, ys: 0.97, color: 'r3' }
    ];
  }
  var EX = { rho: -1, phi: 1.75, r: 1, wOut: 0.25 };   // the illustrative example of Section 2

  var SCENES = [
    // ───────── at sandbox scale ─────────
    {
      id: 'agi', group: 'At scale', name: 'Minimal AGI arrives',
      note: 'AI matches the average person on skills and coordination. Everyone keeps a job, yet wages fall, because cheap copies expand output until its price drops to the cost of AI. Press play to raise AI coordination past the scale threshold.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: { from: { y1: Y_AGI, y2: Y_AGI, ys: 0.78 }, to: { y1: Y_AGI, y2: Y_AGI, ys: 1.06 } }
    },
    {
      id: 'none', group: 'At scale', name: 'Before AI',
      note: 'No AI. Coders and writers pair up into mosaic teams, and a coordinator in each team stretches its best size from six to seven. Scarce talent earns a premium far above the outside option.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 0, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: null
    },
    {
      id: 'supercomp', group: 'At scale', name: 'Supercompetent AI',
      note: 'AI beats every person at both tasks but coordinates like an average one. AI firms stay small. Coordinators move into AI teams and now out-earn the specialists.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 12, y2: 12, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: { from: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, to: { y1: 12, y2: 12, ys: Z_AGI } }
    },
    {
      id: 'supercoop', group: 'At scale', name: 'Supercooperative AI',
      note: 'Modest skills, but coordination above one, so output per copy keeps rising with size. Production tips into one giant AI firm, limited only by the size of the market.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: Y_AGI, y2: Y_AGI, ys: 1.05 }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: { from: { y1: Y_AGI, y2: Y_AGI, ys: 0.9 }, to: { y1: Y_AGI, y2: Y_AGI, ys: 1.1 } }
    },
    {
      id: 'asi', group: 'At scale', name: 'ASI with a niche market',
      note: 'AI dominates on every capability. One giant firm takes the deep market. In the small niche market the giant cannot reach scale, so teams of specialists survive there while coordinators lose their role.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 12, y2: 12, ys: 1.05 }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 10000 } }),
      path: null
    },

    // ───────── paper calibrations ─────────
    {
      id: 'fig2a', group: 'Paper: human economies (Fig. 2)', name: 'Coders only',
      note: 'One human type in a deep market. Weak writing holds competence at 1.8; coordination of 0.75 puts the best firm size at six.',
      paper: 'Paper: firms of 6, wage 1.49.',
      params: Object.assign({}, EX, { humans: 300, roles: roles3(1, 0, 0), aiCap: 0, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 1e7 }, niche: { on: false, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig2b', group: 'Paper: human economies (Fig. 2)', name: 'Mosaic intelligence',
      note: 'Add writers. Nobody holds both skills, but balanced teams reach competence 5, nearly three times any member alone. Pay triples although no one got better at their own task.',
      paper: 'Paper: balanced firms of 6, wage 4.13.',
      params: Object.assign({}, EX, { humans: 600, roles: roles3(1, 1, 0), aiCap: 0, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 1e7 }, niche: { on: false, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig2c', group: 'Paper: human economies (Fig. 2)', name: 'Teams with coordinators',
      note: 'Coordinators rank last on any solo test, yet they relax the span-of-control limit for everyone else. Teams grow to seven.',
      paper: 'Paper: firms of 7.0, wages 4.15 and 2.41.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 0, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 1e7 }, niche: { on: false, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig4a', group: 'Paper: four AI regimes (Fig. 4)', name: 'Minimal AGI',
      note: 'The paper’s own economy: 14 people, a deep market and a niche market. AI firms of seven serve both; all fourteen people stay employed in the deep market at lower pay.',
      paper: 'Paper (Table 4): specialist wage 2.90, coordinator 1.30, niche price 0.202.',
      params: Object.assign({}, EX, { humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig4b', group: 'Paper: four AI regimes (Fig. 4)', name: 'Supercompetent AI',
      note: 'Task skills of 12 with human-level coordination. Specialists retreat to the niche market in balanced teams; the two coordinators spread across AI firms in the deep market.',
      paper: 'Paper (Table 4): specialist wage 0.394, coordinator 0.476.',
      params: Object.assign({}, EX, { humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 12, y2: 12, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig4c', group: 'Paper: four AI regimes (Fig. 4)', name: 'Supercooperative AI',
      note: 'Coordination of 1.6 with average skills. One giant AI firm takes the deep market. The niche keeps human firms; some coordinators are no longer needed.',
      paper: 'Paper (Table 4): specialist wage 0.414, coordinators at the outside option, niche price 0.030.',
      params: Object.assign({}, EX, { humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: Y_AGI, y2: Y_AGI, ys: 1.6 }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig4d', group: 'Paper: four AI regimes (Fig. 4)', name: 'ASI',
      note: 'Superhuman at tasks and above the scale threshold. Specialists keep working in the niche through comparative advantage; both coordinators are unemployed.',
      paper: 'Paper (Table 4): specialist wage 0.269, niche price 0.0195.',
      params: Object.assign({}, EX, { humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 12, y2: 12, ys: 1.05 }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: null
    },
    {
      id: 'fig7a', group: 'Paper: displacement (Fig. 7, 8)', name: 'Gradual: within firms',
      note: 'Outside option raised to one. AI coordinates slightly worse than the human coordinator; as its task skills rise from 3 to 3.4 the mixed niche firm sheds specialists one by one.',
      paper: 'Paper: 4.58 specialists at skill 3.0, 2.39 at 3.15, none past 3.30.',
      params: Object.assign({}, EX, { wOut: 1, humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 3, y2: 3, ys: 0.96 }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: { from: { y1: 3, y2: 3, ys: 0.96 }, to: { y1: 3.4, y2: 3.4, ys: 0.96 } }
    },
    {
      id: 'fig7b', group: 'Paper: displacement (Fig. 7, 8)', name: 'Sudden: between firms',
      note: 'Task skills fixed at 4 while AI coordination climbs. Human-only firms keep all twelve specialists until AI-only production becomes cheaper; then they vanish at once.',
      paper: 'Paper: twelve specialists employed below coordination 0.8521, none above.',
      params: Object.assign({}, EX, { wOut: 1, humans: 14, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 4, y2: 4, ys: 0.8 }, mk: { P0: 0.3, S: 100000 }, niche: { on: true, P0: 0.3, S: 200 } }),
      path: { from: { y1: 4, y2: 4, ys: 0.8 }, to: { y1: 4, y2: 4, ys: 1.04 } }
    },
    {
      id: 'fig19a', group: 'Paper: who works with whom', name: 'Separate firms (Fig. 19a)',
      note: 'Equal skills, but people coordinate better than AI. Mixing would dilute that advantage, so the market splits into human-only firms of four and small AI-only firms.',
      paper: 'Paper: human wage 1.469, human firms of 4, AI firms of 2/3.',
      params: { rho: -1, phi: 1, r: 1, wOut: 1, humans: 50, roles: [{ id: 'h', name: 'People', share: 1, y1: 1, y2: 1, ys: 0.8, color: 'r1' }], aiCap: 10000, ai: { y1: 1, y2: 1, ys: 0.4 }, mk: { P0: 2, S: 200 }, niche: { on: false, P0: 2, S: 200 } },
      path: null
    },
    {
      id: 'fig19b', group: 'Paper: who works with whom', name: 'Mixed firms (Fig. 19b)',
      note: 'Equal coordination, mirror-image skills. People and AI complete each other, so every firm is half human, half AI.',
      paper: 'Paper: firms of 1.5 with human share 1/2, wage 1.',
      params: { rho: -1, phi: 1, r: 1, wOut: 1, humans: 50, roles: [{ id: 'h', name: 'People', share: 1, y1: 2, y2: 1, ys: 0.6, color: 'r1' }], aiCap: 10000, ai: { y1: 1, y2: 2, ys: 0.6 }, mk: { P0: 2, S: 200 }, niche: { on: false, P0: 2, S: 200 } },
      path: null
    },
    {
      id: 'fig22', group: 'Paper: who works with whom', name: 'Coordinators join AI teams (Fig. 22)',
      note: 'As AI competence rises from 4 to 12, productive people leave employment while coordinators move into AI teams, where a little coordination lifts many capable copies.',
      paper: 'Paper: wages 1.50 and 1.62 at competence 4; coordinators at 1.006 in firms that are 1.3% human at competence 12.',
      params: { rho: -1, phi: 3, r: 1, wOut: 1, humans: 110, roles: [{ id: 'p', name: 'Productive', share: 10, y1: 6, y2: 6, ys: 0.2, color: 'r1' }, { id: 'c', name: 'Coordinators', share: 1, y1: 1, y2: 1, ys: 0.9, color: 'r3' }], aiCap: 10000, ai: { y1: 4, y2: 4, ys: 0.2 }, mk: { P0: 2, S: 30000 }, niche: { on: false, P0: 2, S: 200 } },
      path: { from: { y1: 4, y2: 4, ys: 0.2 }, to: { y1: 12, y2: 12, ys: 0.2 } }
    },
    {
      id: 'fig23a', group: 'Paper: human exit (Fig. 23)', name: 'Continuous exit',
      note: 'Complementary skills and equal coordination. As AI improves at the task people were needed for, firms lower their human share smoothly to zero.',
      paper: 'Paper: human share reaches zero at AI skill 1.5.',
      params: { rho: -1, phi: 0.3, r: 1, wOut: 1, humans: 200, roles: [{ id: 'h', name: 'People', share: 1, y1: 1, y2: 2, ys: 0.9, color: 'r1' }], aiCap: 10000, ai: { y1: 1.5, y2: 1, ys: 0.9 }, mk: { P0: 2, S: 200 }, niche: { on: false, P0: 2, S: 200 } },
      path: { from: { y1: 1.5, y2: 1, ys: 0.9 }, to: { y1: 1.5, y2: 2, ys: 0.9 } }
    },
    {
      id: 'fig23b', group: 'Paper: human exit (Fig. 23)', name: 'Sudden exit',
      note: 'AI coordinates better, so human and AI firms stay separate. Tiny human firms hold on until AI production becomes cheaper, then every job goes at the same moment.',
      paper: 'Paper: full employment below AI skill 1.0796, none above.',
      params: { rho: -1, phi: 0.02, r: 1, wOut: 1, humans: 6, roles: [{ id: 'h', name: 'People', share: 1, y1: 1.1, y2: 1.1, ys: 0.985, color: 'r1' }], aiCap: 10000, ai: { y1: 1, y2: 1, ys: 0.9999 }, mk: { P0: 2, S: 18000 }, niche: { on: false, P0: 2, S: 200 } },
      path: { from: { y1: 1, y2: 1, ys: 0.9999 }, to: { y1: 1.2, y2: 1.2, ys: 0.9999 } }
    },
    {
      id: 'fig25', group: 'Paper: wages and reorganisation', name: 'Reorganisation reverses wages (Fig. 25)',
      note: 'AI improves on every capability. Firms grow, which first raises the value of human coordinators; further progress then lowers it. The wage rises before it falls.',
      paper: 'Paper: coordinator wage peaks when the employing firm reaches size 113.',
      params: { rho: -1, phi: 0.02, r: 1, wOut: 0.28, humans: 40, roles: [{ id: 'p', name: 'Productive', share: 1, y1: 1.5, y2: 1.5, ys: 0.78, color: 'r1' }, { id: 'c', name: 'Coordinators', share: 1, y1: 0.6, y2: 0.6, ys: 1.5, color: 'r3' }], aiCap: 10000, ai: { y1: 0.9, y2: 0.9, ys: 0.95 }, mk: { P0: 1.64, S: 15000 }, niche: { on: false, P0: 1.64, S: 200 } },
      path: { from: { y1: 0.9, y2: 0.9, ys: 0.95 }, to: { y1: 1.4, y2: 1.4, ys: 1.02 } }
    },

    // ───────── beyond the paper ─────────
    {
      id: 'trust', group: 'Beyond the paper', name: 'Trust lags behind',
      note: 'Trust stays at 0.40 while AI skills grow. At first that is about what the AI warrants, so little changes. As the AI improves the same trust falls short: people insist on a share of every firm, which limits how many copies can work and keeps wages above the paper’s. Press play and watch the warranted mark pass the slider.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: 1.2, y2: 1.2, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 }, trust: { on: true, level: 0.4 } }),
      path: { from: { y1: 1.2, y2: 1.2, ys: Z_AGI }, to: { y1: 6, y2: 6, ys: Z_AGI } }
    },
    {
      id: 'links', group: 'Beyond the paper', name: 'Linked firms',
      note: 'Intercompany is switched on: firms move goods, share services and license IP across their boundaries. Human teams, whose people differ most from one another, gain most from licensing and form the largest networks. Surplus and wages both end up above the paper’s. Switch it off in the Intercompany group to compare, or pin first.',
      params: Object.assign({}, EX, { humans: 700, roles: roles3(6, 6, 2), aiCap: 10000, ai: { y1: Y_AGI, y2: Y_AGI, ys: Z_AGI }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 }, inter: { on: true, goods: 0.5, services: 0.6, ip: 0.5 } }),
      path: { from: { y1: Y_AGI, y2: Y_AGI, ys: 0.78 }, to: { y1: Y_AGI, y2: Y_AGI, ys: 1.06 } }
    },
    {
      id: 'mosaicai', group: 'Beyond the paper', name: 'Mosaic Intelligence + AI',
      note: 'Coders and writers, each strong at one task, with an AI that is modest at both but coordinates well. No firm is human-only or AI-only: each team pairs about one coder and one writer with some twenty copies. The specialists supply the skill, the copies supply the scale. Surplus is three times that of the human mosaic alone, and wages fall by more than half.',
      params: Object.assign({}, EX, { humans: 600, roles: [{ id: 'coder', name: 'Coders', share: 1, y1: 9, y2: 1, ys: 0.75, color: 'r1' }, { id: 'writer', name: 'Writers', share: 1, y1: 1, y2: 9, ys: 0.75, color: 'r2' }], aiCap: 10000, ai: { y1: 2, y2: 2, ys: 0.95 }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: { from: { y1: 2, y2: 2, ys: 0.75 }, to: { y1: 2, y2: 2, ys: 1.03 } }
    },
    {
      id: 'ceo', group: 'Beyond the paper', name: 'One human as a CEO',
      note: 'One person among ten thousand copies, no better at the tasks but a far better coordinator: enough to lead the largest firm and earn about fourteen times the outside option. There is one CEO per firm, so 20 people make 20 such firms. Press play: past the scale threshold the firms merge, and the other CEOs work on as coordinators.',
      params: Object.assign({}, EX, { humans: 1, roles: [{ id: 'ceo', name: 'CEO', share: 1, y1: 3, y2: 3, ys: 1.6, color: 'r5', lead: true, demoteYs: 0.97 }], aiCap: 10000, ai: { y1: 3, y2: 3, ys: 0.95 }, mk: { P0: 0.3, S: 100000 }, niche: { on: false, P0: 0.3, S: 10000 } }),
      path: { from: { y1: 3, y2: 3, ys: 0.85 }, to: { y1: 3, y2: 3, ys: 1.02 } }
    }
  ];

  root.OI_SCENES = SCENES;
  if (typeof module === 'object' && module.exports) module.exports = SCENES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
