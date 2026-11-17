/* Bundles src/ into one self-contained page: organizing-intelligence-sandbox.html
 * Run: node build.js */
'use strict';
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = ['engine.js', 'scenes.js', 'world.js', 'app.js', 'panels.js'].map(f => `// ── ${f} ──\n${src(f)}`).join('\n')
  + "\n(function () { function go() { OIApp.init(); } if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go(); })();\n";
if (js.includes('</script')) throw new Error('script text must not contain a closing script tag');
// typefaces travel inside the page, so it works offline and looks the same everywhere (all four are SIL Open Font License)
const FONTS = [
  ['IBM Plex Sans', 'IBM_Plex_Sans.woff2', '400 700'],
  ['IBM Plex Sans Condensed', 'IBM_Plex_Sans_Condensed_600.woff2', '600'],
  ['IBM Plex Sans Condensed', 'IBM_Plex_Sans_Condensed_700.woff2', '700'],
  ['IBM Plex Mono', 'IBM_Plex_Mono_400.woff2', '400'],
  ['IBM Plex Mono', 'IBM_Plex_Mono_600.woff2', '600']
];
const faces = FONTS.map(([fam, file, wt]) => `@font-face { font-family: "${fam}"; font-style: normal; font-weight: ${wt}; font-display: swap; src: url(data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, 'src', 'fonts', file)).toString('base64')}) format("woff2"); }`).join('\n');
const html = src('index.template.html').replace('/*__CSS__*/', () => faces + '\n' + src('styles.css')).replace('/*__JS__*/', () => js);
const out = path.join(__dirname, 'organizing-intelligence-sandbox.html');
fs.writeFileSync(out, html);
console.log(`built ${path.basename(out)}: ${(html.length / 1024).toFixed(0)} KB`);
