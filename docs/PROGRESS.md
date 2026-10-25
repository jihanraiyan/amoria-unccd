# Progress

Last updated 2026-10-25, after the final-panel round 2 integration pass. Team detail lives in `docs/progress/` (sim, render, ui, geodata, integration).

## Completed

- **Simulation** (`src/simulation`): deterministic seasonal engine with terrain derivation, hydrology (runoff, infiltration, routed flow, floods, reservoirs, household water with piped supply plus roof tanks and wells), soil and erosion with a soft ceiling, vegetation and restoration maturity, agriculture (intensity, irrigation, conservation, agroforestry, grazing), economy (taxes, upkeep, loans, arrears, timber sale with a falling price), community (population, housing, food and water security, wellbeing). Seeded weather with a guaranteed drought and heavy-rain season. Business-as-usual twin for fair flood and erosion goals. Replay, branching, serialization, explanations with numbers, 11 objectives and an end report. Every parameter tagged and documented in `docs/MODEL_ASSUMPTIONS.md`.
- **Strategy bots** play 20 years on both maps and check the intended tradeoffs: every goal is met by some strategy, none meets all 11, none dominates.
- **Renderer** (`src/game`): stylized low-poly 3D valley with terrain that tints by soil, erosion and water stress; rivers, wetlands, reservoirs and flood water; instanced Kenney CC0 trees and procedural farms, houses, roads and infrastructure; gullies and silt fans; seasonal and weather moods. 11 overlays with colorblind-safe ramps and pattern cues. Picking, brush and line previews, camera with keyboard and on-screen controls, reduced motion, low quality mode, colorblind tints. `GameScene`, `LandingScene`, `SnapshotView`.
- **UI and state** (`src/ui`, `src/state`, `src/app`): landing with world picker, map credits and provenance; HUD with top bar metrics and tooltips, toolbar with costs and tradeoffs, inspector, panels (overlays, budget, community, insights, charts, goals, settings and help), timeline with play, step, history scrubbing and branching, undo and redo, toasts and an accessible status line. Interactive tutorial. Compare Futures side by side and with a reveal slider. End report with reflection and Bring It Home. Saves by deterministic replay with fingerprint checks. Flat map fallback when WebGL is missing or the 3D world fails. Keyboard play throughout.
- **Real geography** (`scripts/geodata`, `src/data`, `public/world-data`): reproducible Python pipeline from Copernicus GLO-30, ESA WorldCover 2021 and OpenStreetMap to a 64 by 64 map of Kaani, Machakos (Kenya), with validation, provenance, disclosures and attribution. Same `WorldInput` as the procedural valley, which stays as the fallback.
- **Integration** (this pass): end-to-end wiring checked (landing to game, real engine in the store, world picker through `src/data`, overlay legends from `OVERLAYS`, Compare on `SnapshotView`, tutorial, goals, end report, reflection and Bring It Home all reachable). Clear-land preview now names the timber hectares sold. README, architecture, game design and this file written. `netlify.toml` and `vercel.json` added.
- **Final-panel round 2**: Sim: goals hold across 20 fixed seeds on both maps (averaged over the non-drought seasons of the last 3 years), a land goal measured against the twin ("Healthier land"), a levy action (`set-levy`, 2% to 35%) with real costs to livelihood and arrivals, redemption (the drought goal judges the most recent drought, erosion the last 10 years), sediment labelled as game tonnes. Render: game tonne units on overlays and legends; WebGL context loss pauses the view, then falls back to the flat map after 5 seconds. UI: household earnings (metrics, charts, Community panel, per-parcel "Earned here"), goals that show "Missed in year N" and whether they can be won back, pause on important news (setting, on by default), contrast fixes, text marks for status beyond color, small-screen tutorial, Cmd or Ctrl in shortcut hints, tap-to-open metric help, a warning when Compare skips saved decisions. Geodata: Python tests split by pipeline stage (84 still pass). Integration: goal names and replay docs corrected, build cache ignored.
- **Final-panel round 1 integration**: the test gate no longer depends on machine load (60 s default test and hook timeout in `vite.config.ts`; the step-time check enforces the 50 ms budget only with `AMORIA_PERF=1` and otherwise catches 10x regressions at 500 ms). The ESLint boundary around `src/simulation` now blocks renderer, UI, store, app and data imports at any relative depth, browser globals, `Math.random`, `Date.now` and `new Date()`, and `tests/lint/boundary.test.ts` proves each rule fires. The inspector reads sensitivity and its deciding part straight from the sim's `sensitivityParts` instead of recomputing them. Amoria's code is now MIT licensed (`LICENSE`, `package.json`), and the Fraunces and Figtree OFL 1.1 notices ship in the build under `assets/fonts/`.

## Incomplete

- No levy control in the UI yet. The engine, saves and bots support `set-levy`; the Budget panel does not offer it.
- Parcel earnings in the inspector repeat the engine's formulas (a test catches drift); a per-cell value field from the sim would remove the copy.

- Nobody has played it in a real browser yet. Agents were not allowed browser automation, so the visuals, flat map, decision markers and compare chart grid need a first human playtest.
- Balance is tuned with bots, not people.
- Only one real region. Adding one is a `Region` entry plus a pipeline run (`scripts/geodata/README.md`).
- Kaani runs the generic one wet, one dry climate, not the two rainy seasons of Machakos.
- No soil, rainfall or yield data is imported; those are model values.

## Decisions

- TypeScript 6.0, not 7, because typescript-eslint 8.72 supports below 6.1.
- `r3f-perf` dropped (it pins fiber 8 and drei 9); a custom `?debug` HUD instead.
- Amoria's own code is MIT licensed. The owner can swap this for another licence before release; nothing else depends on the choice.
- `.npmrc` sets `legacy-peer-deps=true`; npm 10.9 crashes on vitest 5 optional peers without it.
- Saves store the action log, not the state, and are rebuilt by `src/state/replay.ts`, which skips and reports invalid entries. The engine's `replay`, `branchAt` and `serialize` are kept for the determinism tests.
- The 3D module is code-split so the title screen paints immediately.
- Flood and erosion goals compare against a business-as-usual twin in the same weather.
- Intensive farming ending in debt on Kaani is a deliberate tradeoff, documented in MODEL_ASSUMPTIONS section 20.

## Known bugs and risks

- Snapshots are kept for every season (about 15 MB over 20 years). Thinning old ones is the fix if memory becomes a problem.
- Undo after a reload is rebuilt only for the current season (by design).
- On Kaani, 1 to 3 degraded grassland parcels can gain or lose a bush between normal seasons because they sit right on a slot threshold.
- Overlay relief shading uses a fixed key light, so it does not change with season (deliberate, keeps legend colors fixed).
- The main JS chunks are over 500 kB (the build warns). The 3D chunk is already lazy; more splitting is possible.
- The levy lever is strong at the top of its range; its price is livelihood and the wellbeing goal, not yet judged by players.
- Clearing forest raises dry-season flow modestly in this model; it cannot show the case where degraded soil dries the river.

## Test results

Run from the repo root on 2026-10-25, Node 23.7:

- `npm run check`: exit 0.
  - `tsc -b --noEmit`: no errors.
  - `eslint .`: clean.
  - `vitest run`: 46 test files, 567 tests passed (includes the 20-seed suites on both maps).
  - `tsc -b && vite build`: built, with only the chunk-size warning.
- Python pipeline tests (separate, not part of the gate, geodata team run after the test split): `scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q`, 84 passed; `scripts/geodata/.venv/bin/ruff check scripts/geodata`, all checks passed.
- Strict step budget (opt-in): `AMORIA_PERF=1 npx vitest run src/simulation/__tests__/invariants.test.ts -t budget`. Measured median 18 ms per step on the dev laptop at load 1.5.

## Next steps

1. Add the levy control to the Budget panel.
2. First human playtest on desktop and a small screen; fix what the eye finds.
3. Playtest balance with players aged 15 to 24 and tune `params.ts` game-balance values.
4. Bimodal rains for Kaani, then a second real region.
5. Snapshot thinning and further bundle splitting.
6. Deploy to Netlify or Vercel (configs are in the repo).
