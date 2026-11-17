# HAIV: Human-AI Venture

An interactive playground for the model in *Organizing Intelligence* (Imas, Koh and Legg, Google DeepMind, 2026).
People and AI copies sort themselves into competing firms; the stage shows the industry that maximises total
surplus, with wages, prices and firm sizes read from the model.

Each version is one self-contained page that works offline: open `organizing-intelligence-sandbox.html` in a browser.

| Folder | What it is |
|---|---|
| [`vE/`](vE/) | The reviewed design: the paper's model plus the Trust, Intercompany and CEO extensions. |
| [`vF/`](vF/) | A fork of vE that adds who gains: Reskilling between roles, a compute tax paid back to people, a stake in the AI fleet, a *Who gets what* readout and three new scenes. With these off, vF gives exactly vE's numbers. |

## Build and test

Each folder builds its page from `src/` and has its own tests (Node.js, no dependencies):

```sh
cd vF
node build.js
for t in test/*.test.js; do node "$t"; done
```

## Fonts

The pages embed IBM Plex Sans, Sans Condensed and Mono from `src/fonts/`, under the SIL Open Font License 1.1
(see [`OFL.txt`](OFL.txt)).
