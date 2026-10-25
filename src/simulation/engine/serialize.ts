// Lossless JSON (de)serialisation of simulation state, including typed arrays, for saving
// to browser storage. Float32 values survive the round trip exactly because each float32
// converts to a double that JSON prints with enough digits to read back the same value.
import type { SimulationState } from '../types'

const TYPED = { Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array } as const
type TypedName = keyof typeof TYPED

interface Tagged {
  __ta: TypedName
  d: number[]
}

function replacer(_k: string, v: unknown): unknown {
  for (const name of Object.keys(TYPED) as TypedName[]) {
    if (v instanceof TYPED[name]) return { __ta: name, d: Array.from(v as ArrayLike<number>) } satisfies Tagged
  }
  return v
}

function reviver(_k: string, v: unknown): unknown {
  if (v && typeof v === 'object' && '__ta' in v && 'd' in v) {
    const t = v as Tagged
    const Ctor = TYPED[t.__ta]
    if (!Ctor || !Array.isArray(t.d)) throw new Error('corrupt typed array in save data')
    return Ctor.from(t.d)
  }
  return v
}

export function serializeState(s: SimulationState): string {
  return JSON.stringify(s, replacer)
}

export function deserializeState(json: string): SimulationState {
  const s = JSON.parse(json, reviver) as SimulationState
  if (!s || s.version !== 1 || !s.terrain || !s.layers) throw new Error('not an Amoria save (version 1)')
  const n = s.terrain.width * s.terrain.height
  if (s.layers.cover.length !== n) throw new Error('save data grid size does not match')
  return s
}
