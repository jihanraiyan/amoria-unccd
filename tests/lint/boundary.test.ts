// Proves the ESLint boundary around src/simulation actually fires. Lints in-memory snippets as if
// they lived in src/simulation/models/, so no fixture files are written to disk.
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, test } from 'vitest'

const SIM_FILE = 'src/simulation/models/__boundary_probe__.ts'
let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() })
})

async function ruleIds(code: string, filePath = SIM_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId ?? 'fatal')
}

describe('simulation lint boundary', () => {
  test.each([
    "import 'react'",
    "import 'react-dom/client'",
    "import 'three'",
    "import 'three/examples/jsm/loaders/GLTFLoader.js'",
    "import '@react-three/fiber'",
    "import 'zustand'",
    "import '../game/core/overlays'",
    "import '../../game/core/overlays'",
    "import '../../state/store'",
    "import '../../../ui/hud'",
    "import '../../app/App'",
    "import '../../data/worldFile'",
  ])('blocks %s', async (code) => {
    expect(await ruleIds(code)).toContain('no-restricted-imports')
  })

  test.each([
    ['export const a = window.innerWidth', 'no-restricted-globals'],
    ['export const a = document.title', 'no-restricted-globals'],
    ["export const a = localStorage.getItem('x')", 'no-restricted-globals'],
    ['export const a = performance.now()', 'no-restricted-globals'],
    ['export const a = Math.random()', 'no-restricted-properties'],
    ['export const a = Date.now()', 'no-restricted-properties'],
    ['export const a = new Date()', 'no-restricted-syntax'],
  ])('blocks %s', async (code, rule) => {
    expect(await ruleIds(code)).toContain(rule)
  })

  test('allows imports inside the simulation and a local function that shadows a global name', async () => {
    const code = "import { step } from '../engine/season'\nfunction window(): number { return 1 }\nexport const a = [step, window()]"
    expect(await ruleIds(code)).toEqual([])
  })

  test('does not apply to the UI layer', async () => {
    expect(await ruleIds("import 'zustand'\nexport const a = window.innerWidth", 'src/ui/__boundary_probe__.ts')).toEqual([])
  })
})
