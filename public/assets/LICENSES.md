# Third-party assets

## Kenney Nature Kit 2.1 (`kenney-nature-kit/`)

- Author: Kenney (www.kenney.nl)
- Source: https://kenney.nl/assets/nature-kit
- Archive downloaded 2026-10-24: `kenney_nature-kit.zip`, SHA-256 `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`
- License: Creative Commons Zero (CC0 1.0), http://creativecommons.org/publicdomain/zero/1.0/
- The original `License.txt` from the archive is copied unchanged next to the models. It says the content is free to use in personal, educational and commercial projects and that crediting Kenney is appreciated but not required. We credit Kenney here anyway.

Files used (GLB, unmodified on disk): `tree_default`, `tree_oak`, `tree_cone`, `tree_tall`, `tree_fat`, `tree_pineTallA`, `tree_pineRoundA`, `plant_bush`, `plant_bushSmall`, `stump_old`, `rock_smallC`, `lily_small`. These 12 are the only models shipped, and each one is loaded by `src/game/props/kenneyModels.ts`. (Two more, `stump_round` and `rock_smallA`, were copied in an earlier round but never used, so they were removed.)

At load time the renderer (`src/game/props/kenneyModels.ts`) merges each model into a single geometry and replaces Kenney's material colors with Amoria's palette (bark, foliage, stone). The meshes themselves are not edited.

## Fonts (`fonts/`)

Both fonts are self-hosted from the `@fontsource-variable` npm packages and bundled into the build as `.woff2` files. Both are licensed under the SIL Open Font License, Version 1.1. The full licence text for each, copied unchanged from the package, ships next to this file.

- Fraunces: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces). Licence: `fonts/Fraunces-OFL.txt`.
- Figtree: Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree). Licence: `fonts/Figtree-OFL.txt`.

The fonts are used as published, not modified or renamed.

## Everything else

Houses, roads, the reservoir, waterworks, market stalls, crop rows, terraces, reeds, the terrain, water and weather effects are procedural geometry and shaders written for Amoria, covered by Amoria's own MIT licence (`LICENSE` at the repository root).
