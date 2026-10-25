// Grounded text builders: report, compare diff, objectives, chart indexing. Real engine runs.
import { describe, expect, test, vi } from 'vitest'
import { applyAction, createInitialState, step } from '../../src/simulation/engine'
import type { SimulationState, Snapshot } from '../../src/simulation/types'
import { evaluateObjectives } from '../../src/state/objectives'
import { snapshotOf } from '../../src/state/replay'
import type { RunData } from '../../src/state/store'
import { buildToolAction, DEFAULT_TOOL_OPTIONS } from '../../src/state/toolActions'
import { loadWorld, PROCEDURAL_WORLD_ID } from '../../src/state/worlds'
import { CHARTS, historyIndexForStep, weatherBands } from '../../src/ui/charts/chartSpecs'
import { diffSummary, fairness, metricRows, pointAt } from '../../src/ui/compare/diff'
import { decisionSummary, outcomes, weatherFindings, worstDrought } from '../../src/ui/report/analysis'
import { findValidCell } from './helpers'

// these build and replay whole runs; give them room when every suite runs in parallel
vi.setConfig({ testTimeout: 30_000 })

async function play(seed: number, seasons: number, plan: (s: SimulationState) => SimulationState = (s) => s): Promise<RunData> {
  const world = await loadWorld(PROCEDURAL_WORLD_ID)
  let s = plan(createInitialState(world, seed))
  const snapshots: Snapshot[] = [snapshotOf(s)]
  const explanations = [...s.explanations]
  for (let k = 0; k < seasons; k++) {
    const r = step(s)
    s = r.state
    snapshots.push(r.snapshot)
    explanations.push(...r.explanations)
  }
  return { slot: { id: 'A', label: 'A', worldId: PROCEDURAL_WORLD_ID, seed, log: [], endStep: s.step, savedAt: '' }, state: s, snapshots, explanations }
}

const farm = (s: SimulationState) => {
  const cells: number[] = []
  let cur = s
  for (let k = 0; k < 6; k++) {
    const c = findValidCell(cur, 'cropland')
    cells.push(c)
    cur = applyAction(cur, buildToolAction('cropland', [c], { ...DEFAULT_TOOL_OPTIONS, intensity: 'high' })!).state
  }
  return cur
}

describe('report analysis', () => {
  test('outcomes and findings cite finite recorded values', async () => {
    const run = await play(5, 12, farm)
    const outs = outcomes(run.state)
    expect(outs.length).toBeGreaterThan(5)
    for (const o of outs) {
      expect(o.start).not.toMatch(/NaN|Infinity/)
      expect(o.end).not.toMatch(/NaN|Infinity/)
    }
    const decisions = decisionSummary(run.state.decisions)
    expect(decisions[0]).toMatchObject({ type: 'cropland', times: 6, parcels: 6 })
    const text = [...weatherFindings(run.state.history), worstDrought(run.state) ?? ''].join(' ')
    expect(text).not.toMatch(/NaN|undefined/)
  })
})

describe('compare diff', () => {
  test('same seed is fair, different seed is not', async () => {
    const a = await play(9, 4)
    const b = await play(9, 4, farm)
    const c = await play(10, 4)
    expect(fairness(a.state, b.state)).toMatchObject({ sameWorld: true, sameSeed: true, sameBudget: true, sameWeather: true })
    expect(fairness(a.state, c.state).sameSeed).toBe(false)
    expect(fairness(a.state, c.state).sameWeather).toBe(false)
  })

  test('metric rows and summary come from the history point at the chosen step', async () => {
    const a = await play(11, 6)
    const b = await play(11, 6, farm)
    const pa = pointAt(a.state, 6)!
    const pb = pointAt(b.state, 6)!
    expect(pa).toBe(a.state.history[a.state.history.length - 1])
    const rows = metricRows(pa, pb)
    const budget = rows.find((r) => r.id === 'budget')!
    expect(budget.a).toBe(pa.budget)
    expect(budget.b).toBe(pb.budget)
    const lines = diffSummary(a, b, 6)
    expect(lines.join(' ')).toMatch(/A's main moves: no changes to the land/)
    expect(lines.join(' ')).toMatch(/B's main moves: planted cropland on 6 parcels/)
    expect(lines.join(' ')).not.toMatch(/NaN|undefined/)
  })
})

describe('chart indexing', () => {
  test('history index for a step matches the point recorded after that many seasons', async () => {
    const r = await play(3, 5)
    const h = r.state.history
    for (let k = 0; k <= 5; k++) {
      const i = historyIndexForStep(h, r.state.step, k)
      if (i >= 0 && typeof h[i].step === 'number') expect(h[i].step).toBe(k)
    }
    expect(historyIndexForStep(h, r.state.step, 1)).toBeGreaterThanOrEqual(0)
    for (const b of weatherBands(h)) expect(b.start).toBeGreaterThan(0)
    for (const c of CHARTS) for (const l of c.lines) for (const p of h) expect(Number.isFinite(l.get(p))).toBe(true)
  })
})

describe('objectives', () => {
  test('every goal reports a finite progress and a detail with numbers', async () => {
    const r = await play(4, 4)
    const { items, error } = evaluateObjectives(r.state)
    expect(error).toBeNull()
    expect(items.length).toBeGreaterThan(4)
    for (const o of items) {
      expect(o.progress).toBeGreaterThanOrEqual(0)
      expect(o.progress).toBeLessThanOrEqual(1)
      expect(o.detail).toMatch(/\d/)
    }
  })
})
