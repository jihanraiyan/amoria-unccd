# Amoria: project conventions

Browser 3D ecological city-builder for the UNCCD Hack for Social Impact 2026 (youth 15–24).

## Commands
- `npm run dev`: dev server (Vite)
- `npm run check`: typecheck + lint + tests + build (the gate; must pass before any milestone is called done)
- `npm test`: vitest (node env; UI tests opt into jsdom with `// @vitest-environment jsdom`)

## Architecture rules
- `src/simulation/**` is pure TypeScript: no React, three, zustand, or DOM. ESLint enforces it.
- Engine functions never mutate inputs; they return new state (copy typed arrays with `.slice()`).
- The grid is struct-of-arrays typed arrays, index = z*width + x. Contract is `src/simulation/types.ts`.
- Determinism: all randomness goes through `src/simulation/rng.ts` seeded streams. No Math.random/Date in simulation.
- Weather is generated once from the seed at game start and never reads player state.
- Renderer (`src/game/**`) reads the store (`src/state/store.ts`) and never computes environmental models.
- UI (`src/ui/**`) dispatches `PlayerAction`s through the store; it never edits sim state directly.
- Parameters live in `src/simulation/params.ts`, each tagged evidence-informed vs game-balance.

## Integrity rules
- No invented citations. No claims of real data unless the GIS pipeline actually produced it.
- Model outputs are illustrative game units, not calibrated predictions; UI copy must say so where relevant.
- Drought/heavy rain are exogenous; player choices change vulnerability, never the weather.

## Testing
- No Playwright. Verify through sim unit tests, scripted strategy playthroughs (bots), and RTL store/UI tests with the canvas stubbed.
- Progress lives in docs/PROGRESS.md (team detail in docs/progress/).

## Docs
- README.md (run, build, deploy), docs/ARCHITECTURE.md, docs/GAME_DESIGN.md, docs/MODEL_ASSUMPTIONS.md, docs/DATA_SOURCES.md.
- Static SPA deploy: netlify.toml and vercel.json build to dist/.
