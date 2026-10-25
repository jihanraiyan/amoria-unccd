# Amoria

Build a city. Shape an ecosystem.

Amoria is a free, browser-based 3D city-builder about land, water and the choices a community makes. You grow a small town in a river valley: lay roads, build homes, plant fields, clear or restore forest, dig reservoirs. Underneath, a simulation of rain, runoff, soil, erosion, vegetation, crops, money and people decides what happens next. Droughts and heavy rains arrive from a seeded weather record; your choices change how hard they hit.

It was built for the UNCCD Hack for Social Impact 2026 challenge "Engaging Youth in Sustainable Land-Use Decisions", for players aged 15 to 24. It is non-profit and has no accounts, tracking or ads.

Two maps ship with it:

- **Amoria Valley**: a procedural valley generated from the seed.
- **Kaani, Machakos (Kenya)**: a 6.4 km square derived from real open data (Copernicus GLO-30 elevation, ESA WorldCover 2021, OpenStreetMap). It is a game map built from that data, not a measurement or forecast. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

All model outputs are illustrative game units, not calibrated predictions. The equations, parameters and their sources are in [docs/MODEL_ASSUMPTIONS.md](docs/MODEL_ASSUMPTIONS.md).

## Run it

Needs Node 22 or newer (developed on 23.7).

```bash
npm install        # .npmrc sets legacy-peer-deps (needed for vitest 5 peers)
npm run dev        # dev server at http://localhost:5173
```

Entry point: `index.html` loads `src/main.tsx`, which mounts `src/app/App.tsx`.

Add `?debug` to the URL for a frame-time and draw-call overlay.

## Build and test

```bash
npm run check      # the gate: typecheck, lint, all tests, production build
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint .
npm test           # vitest run (simulation, renderer, data, UI)
npm run build      # production bundle in dist/
npm run preview    # serve dist/ locally
```

There are no browser end-to-end tests by design. The simulation is checked by unit tests and scripted strategy bots that play whole games; the renderer by tests that mount the real React Three Fiber scene graph with a stub WebGL renderer; the UI by React Testing Library tests with the canvas stubbed.

The GIS pipeline is Python and lives in `scripts/geodata/` (see its README). It is not part of `npm run check`; the app reads its committed output in `public/world-data/`.

## Deploy

The build is a static site in `dist/`. Any static host works as long as unknown paths fall back to `index.html`.

- **Netlify**: connect the repo. `netlify.toml` sets `npm run build`, publishes `dist/` and adds the SPA fallback.
- **Vercel**: import the repo. `vercel.json` sets the same build, output directory and rewrite.
- **Anything else** (GitHub Pages, S3, nginx): run `npm run build` and upload `dist/`. If it is served from a sub-path, build with `npx vite build --base /your-path/`.

## Project layout

```
src/simulation   pure TypeScript engine (no React, three or DOM)
src/game         3D world (React Three Fiber): GameScene, LandingScene, SnapshotView, overlays
src/state        zustand store, replay-based saves, objectives, tutorial
src/ui           HUD, toolbar, inspector, panels, timeline, Compare Futures, end report
src/data         real-world map registry and loaders
src/app          app shell, screens, error boundaries, shortcuts
scripts/geodata  offline Python GIS pipeline
public/world-data  exported real-data maps
docs/            spec, architecture, game design, model assumptions, data sources, progress
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md), [docs/PROGRESS.md](docs/PROGRESS.md).

## Credits and licences

3D nature models: Kenney Nature Kit (CC0), see `public/assets/LICENSES.md`. Map data credits for Kaani are shown in the game whenever that map is in play and listed in `docs/DATA_SOURCES.md`. Fonts: Fraunces and Figtree (SIL Open Font License 1.1), self-hosted; their copyright notices and licence texts ship with the build in `public/assets/fonts/`. Amoria's own code is MIT licensed, see `LICENSE`.
