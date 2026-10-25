// Compare Futures: save Scenario A, branch Scenario B from identical conditions, open the comparison.
import type { GameStore, RunData } from '../storeTypes'
import { replayRunAsync } from '../replay'
import { loadWorld } from '../worlds'
import type { StoreCtx } from './context'
import { clearTimer, emptyCompare, extendsRun, slotFrom, stepText } from './runtime'

export function compareActions(ctx: StoreCtx) {
  const { set, get, notify, saveGame } = ctx
  return {
    saveScenarioA: () => {
      const s = get()
      if (!s.sim || !s.worldId) return false
      const slot = slotFrom('A', s.worldId, s.seed, s.log, s.sim.step)
      set({
        scenarios: { A: slot, B: null },
        runLabel: 'A',
        compare: { ...emptyCompare(), A: { slot, state: s.sim, snapshots: s.snapshots, explanations: s.explanations } },
      })
      saveGame({ silent: true })
      notify('ok', `Saved this run as Scenario A (year ${s.sim.year}, ${s.sim.season} season). Branch to play Scenario B from the same start.`)
      return true
    },

    branchScenarioB: async () => {
      let s = get()
      if (!s.scenarios.A) {
        notify('error', 'Save a Scenario A first.')
        return false
      }
      // Run A went on after it was saved: keep its latest seasons instead of silently dropping them
      let updated: { from: number; to: number } | null = null
      const saved = s.scenarios.A
      if (s.runLabel === 'A' && s.sim && extendsRun(saved, s.log, s.sim.step)) {
        updated = { from: saved.endStep, to: s.sim.step }
        const slot = slotFrom('A', saved.worldId, saved.seed, s.log, s.sim.step)
        set({ scenarios: { A: slot, B: null }, compare: { ...emptyCompare(), A: { slot, state: s.sim, snapshots: s.snapshots, explanations: s.explanations } } })
        s = get()
      }
      const A = s.scenarios.A!
      const cachedA = s.compare.A
      const ok = await get().newGame(A.worldId, A.seed, { runLabel: 'B', keepScenarios: true })
      if (!ok) return false
      if (cachedA) set({ compare: { ...get().compare, A: cachedA } })
      const kept = updated
        ? ` Scenario A was saved again at ${stepText(updated.to)} (it had been saved at ${stepText(updated.from)}), so the seasons you played after saving are kept.`
        : ''
      notify('info', `Scenario B starts from exactly the same valley, budget and weather as Scenario A. Try a different strategy.${kept}`)
      return true
    },

    openCompare: async () => {
      const s = get()
      const A = s.scenarios.A
      if (!A || !s.sim || !s.worldId) {
        notify('error', 'Compare needs a saved Scenario A and a second run.')
        return false
      }
      if (s.runLabel !== 'B') {
        notify('error', 'Branch to Scenario B first, then compare the two futures.')
        return false
      }
      if (A.worldId !== s.worldId || A.seed !== s.seed) {
        notify('error', 'These two runs started from different conditions, so a fair comparison is not possible.')
        return false
      }
      clearTimer()
      const slotB = slotFrom('B', s.worldId, s.seed, s.log, s.sim.step)
      const B: RunData = { slot: slotB, state: s.sim, snapshots: s.snapshots, explanations: s.explanations }
      set({
        screen: 'compare',
        playing: false,
        scenarios: { A, B: slotB },
        compare: { ...s.compare, B, loading: !s.compare.A, error: null },
      })
      let runA = s.compare.A
      if (!runA || runA.slot.endStep !== A.endStep) {
        try {
          const world = s.world ?? (await loadWorld(A.worldId))
          // replaying in slices lets "Rebuilding Scenario A..." paint and the page stay responsive
          set({ loadProgress: { done: 0, total: A.endStep } })
          const r = await replayRunAsync(world, A.seed, A.log, A.endStep, (done, total) => set({ loadProgress: { done, total } }))
          runA = { slot: A, state: r.state, snapshots: r.snapshots, explanations: r.explanations }
          if (r.rejected.length) {
            const n = r.rejected.length
            notify(
              'warning',
              `Scenario A was rebuilt, but ${n} of its saved decisions ${n === 1 ? 'is' : 'are'} no longer allowed by this version of the model and ${n === 1 ? 'was' : 'were'} skipped, so A may differ from what you played.`,
            )
          }
        } catch (e) {
          set({ loadProgress: null, compare: { ...get().compare, loading: false, error: e instanceof Error ? e.message : 'Scenario A could not be rebuilt.' } })
          return false
        }
        set({ loadProgress: null })
        // the player went back while A was being rebuilt: keep the result for next time, stay put
        if (get().screen !== 'compare') {
          set({ compare: { ...get().compare, A: runA, loading: false } })
          return false
        }
      }
      const stepShown = Math.min(runA.state.step, B.state.step)
      set({ compare: { A: runA, B, loading: false, error: null, step: stepShown } })
      saveGame({ silent: true })
      return true
    },

    closeCompare: () => set({ screen: get().sim ? 'game' : 'landing' }),

    setCompareStep: (n) => {
      const c = get().compare
      if (!c.A || !c.B) return
      const max = Math.min(c.A.state.step, c.B.state.step)
      set({ compare: { ...c, step: Math.max(0, Math.min(max, Math.round(n))) } })
    },

    clearScenarios: () => {
      set({ scenarios: { A: null, B: null }, runLabel: null, compare: emptyCompare() })
      saveGame({ silent: true })
      notify('info', 'Saved scenarios forgotten. Your current run carries on as a fresh run.')
    },
  } satisfies Partial<GameStore>
}
