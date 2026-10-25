import { generateProceduralWorld } from '../world/procedural'

test('procedural world is deterministic and finite', () => {
  const a = generateProceduralWorld(3)
  const b = generateProceduralWorld(3)
  expect(Array.from(a.elevationM)).toEqual(Array.from(b.elevationM))
  expect(a.elevationM.every(Number.isFinite)).toBe(true)
})
