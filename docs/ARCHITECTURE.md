# Architecture

Amoria is a static single-page app: React 19, TypeScript 6, Vite 8, React Three Fiber 9 with drei 10, zustand 5 and Tailwind 4. There is no server. Saves live in the browser's localStorage.

## Layers

```
index.html -> src/main.tsx -> src/app/App.tsx
                                 |
          +----------------------+----------------------+
          |                      |                      |
      src/ui (HUD)          src/game (3D)          src/data (maps)
          |   dispatch            |  read                |  WorldInput
          v   actions             v  only                v
                 src/state/store.ts (zustand)  <---------+
                          |
                          v  createInitialState / validateAction / applyAction / step
                 src/simulation (pure TypeScript engine)
```

Rules that keep this honest (ESLint enforces the first one for every non-test file under `src/simulation`, and `tests/lint/boundary.test.ts` proves the rules fire):

1. `src/simulation/**` imports no React, React DOM, three, `@react-three/*` or zustand, and no relative path into `src/game`, `src/ui`, `src/state`, `src/app` or `src/data` at any depth. It gets ES globals only (no browser globals), and `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `performance`, `fetch`, `requestAnimationFrame`, `setTimeout`, `setInterval`, `Math.random`, `Date.now` and `Date()` or `new Date()` are lint errors. Engine functions never mutate their input; they return a new state, copying typed arrays with `.slice()`.
2. The store (`src/state/store.ts`) is the only caller of the engine for the live run.
3. The UI dispatches `PlayerAction`s through the store and never edits simulation state.
4. The renderer reads the store and never computes environmental models. Where it needs a derived value (environmental sensitivity, erosion susceptibility, urban intensity, vegetation maturity) it calls the simulation's exported functions.

## Simulation (`src/simulation`)

- **Contract**: `types.ts`. The grid is struct-of-arrays typed arrays, index `z * width + x`. `SimulationState` holds `terrain` (computed once), `layers` (state the player and time change), `fields` (per-season model outputs), economy, community, weather, history, snapshots, decisions and explanations.
- **Engine** (`engine/`): `createInitialState(world, seed)` derives terrain (pit fill, D8 flow, Horn slope, contributing area, channels), spins up soil and vegetation, calibrates the household scale per map, and generates the whole weather record from the seed. `validateAction` and `applyAction` handle the 16 `PlayerAction` types. `step` runs one season: weather, hydrology, soil and erosion, vegetation, agriculture, economy, community, then a business-as-usual twin for comparison, then history, snapshot and explanations.
- **Models** (`models/`): hydrology (curve-number style runoff, infiltration, routed flow, floods, reservoirs, household water), soil (RUSLE-style erosion with a soft ceiling, recovery), vegetation (growth, maturity, succession), agriculture (yield from water, soil and management; grazing; forest livelihoods), economy (taxes, upkeep, loans, arrears), land use (placement rules, costs, timber sale with a falling price) and community (population, housing, food and water security, wellbeing).
- **Determinism**: all randomness goes through seeded streams in `rng.ts`. No `Math.random` or `Date`. Weather never reads player state, so two runs on the same seed see the same droughts and storms.
- **Engine-level replay utilities**: `engine/replay.ts` (`replay`, `branchAt`) and `serialize.ts` (`serializeState`, `deserializeState`) rebuild a run from `(world, seed, action log)` and round-trip a full state. Only the determinism and replay tests use them. The app's saves, loads, branching and Compare go through `src/state/replay.ts` (see State).
- **Scenario**: `scenarios/guided.ts` has the 20-year guided scenario's 11 objectives and the end report.
- **Parameters**: `params.ts`, each tagged evidence-informed or game-balance, with notes. `docs/MODEL_ASSUMPTIONS.md` documents every equation and source.

## State (`src/state`)

- `store.ts` and `storeTypes.ts`: screens (landing, game, compare), the live `sim`, tool and brush, preview, selection and keyboard cursor, overlay, time controls and speed, undo and redo, history viewing (`viewSnapshot`, `viewStep`), branching, compare setup, toasts and settings. Fields tagged `[render-contract]` are read by `src/game` and must not be renamed alone.
- `replay.ts` and `persistence.ts`: a save is the world id, seed and action log, not the state. `replayRun` and `replayRunAsync` rebuild the run by calling the engine's `createInitialState`, `applyAction` and `step`; unlike `engine/replay.ts`, which throws on an invalid entry, they skip and report rejected entries. Saving and loading (`slices/persistenceActions.ts`) and Compare (`slices/compareActions.ts`) use them, and branching to Scenario B starts a new game on the same world and seed from the first season (`newGame`, not `branchAt`). Loading replays it (asynchronously, yielding to the page) and checks a fingerprint, warning the player if the replayed run differs from what was saved. Corrupt, old and newer saves get plain messages.
- `worlds.ts`: picks a world through `src/data` loaders (`import.meta.glob` over `src/data/loaders`), with the procedural valley as the fallback when a real map cannot load.
- `objectives.ts`, `tutorial.ts`, `messages.ts`, `toolActions.ts`, `toolProbe.ts`, `settings.ts`: goals text, the interactive tutorial's steps, feedback wording, tool-to-action mapping and availability, saved settings.

## Renderer (`src/game`)

Public API in `src/game/index.ts`, loaded on demand by `src/app/gameModules.ts` so the title paints at once:

- `GameScene`: the interactive world (terrain, water, vegetation, farms, settlement, erosion cues, atmosphere, picking, previews, camera). It shows `viewSnapshot` read-only when history is being viewed.
- `LandingScene`: the slow orbit behind the title screen.
- `SnapshotView`: a read-only past snapshot. Compare Futures uses two of them, side by side or stacked under a reveal slider, sharing one camera.
- `OVERLAYS` and legend helpers (`resolveLegend`, `overlayDomain`, `sharedOverlayDomain`): 11 overlays plus "none", each with a colorblind-safe ramp and a pattern cue that does not rely on color. The UI's overlay panel, legend and compare picker are built from this list.

Performance: instancing for everything repeated, React re-renders only on `sim`, `viewSnapshot`, `quality`, `overlay` or colorblind changes, and hover, preview and selection go through store subscriptions into refs. A low quality setting drops shadows and halves vegetation.

## UI (`src/ui`, `src/app`)

`App.tsx` switches between Landing, the game screen and Compare. The game screen layers the HUD over the world: top bar with metric tooltips, toolbar, active panel (overlays, budget, community, insights, charts, goals, settings and help), inspector, timeline with history scrubbing and branching, toasts and a status line, the tutorial coach and the end report (with reflection and Bring It Home). When WebGL is missing or the 3D world crashes, `FlatMap` gives a playable flat map with an honest notice.

## Data (`src/data`, `scripts/geodata`)

The Python pipeline in `scripts/geodata` downloads and clips Copernicus GLO-30, ESA WorldCover 2021 and OpenStreetMap for a region, samples them to a 64 by 64 grid of 100 m cells, derives hydrology, validates and writes `public/world-data/<id>.json` plus a TypeScript registry (`src/data/realWorlds.generated.ts`). In the browser, `src/data/worldFile.ts` parses and validates the file and `registry.ts` lists worlds and loads them with a fallback. Both maps produce the same `WorldInput`, so every system runs on either.

## Testing

`npm run check` runs typecheck, lint, all vitest suites and a production build. No browser automation:

- `src/simulation/__tests__`: unit tests per model, invariants, determinism and replay, and scripted strategy bots that play 20 years on both maps and check the tradeoffs (no strategy dominates, every goal reachable by some strategy).
- `src/game/__tests__`: pure helpers plus tests that mount the real R3F scene graph with a stub renderer.
- `src/data/__tests__`: parser, registry and routing parity with the engine.
- `tests/ui`: store, persistence and React Testing Library tests with the canvas stubbed.
- `tests/lint`: `boundary.test.ts` runs ESLint on probe files to prove the simulation boundary rules fire.
