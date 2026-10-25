// Time: stepping seasons and years, play and pause at a speed, and viewing past seasons.
import { step as engineStep } from '../../simulation/engine'
import { horizonSteps } from '../objectives'
import type { Explanation } from '../../simulation/types'
import type { GameStore, Toast } from '../storeTypes'
import type { StoreCtx } from './context'
import { clearTimer } from './runtime'

let toastSeq = 0

/**
 * The news that should pause play this season, if any: a critical explanation (homes flooded,
 * a budget shortfall, food or water in crisis), or the first season of a drought.
 */
export function pauseReason(explanations: readonly Explanation[], droughtStarts: boolean): Explanation | null {
  const critical = explanations.find((e) => e.severity === 'critical')
  if (critical) return critical
  if (droughtStarts) return explanations.find((e) => e.topic === 'event' && /drought/i.test(e.title)) ?? null
  return null
}

export function timeActions(ctx: StoreCtx) {
  const { set, get, notify, tutorialEvent, saveGame, schedule } = ctx
  return {
    stepSeason: () => {
      const s = get()
      if (!s.sim || s.busy) return
      let r: ReturnType<typeof engineStep>
      try {
        r = engineStep(s.sim)
      } catch (e) {
        clearTimer()
        set({ playing: false })
        notify('error', `The simulation hit a problem and paused: ${e instanceof Error ? e.message : 'unknown error'}.`)
        return
      }
      const next = r.state
      const toasts: Toast[] = []
      const point = next.history[next.history.length - 1]
      if (point && point.weather !== 'normal') {
        const label =
          point.weather === 'drought' ? 'Drought season' : point.weather === 'heavy-rain' ? 'Heavy rain' : 'Good growing season'
        toasts.push({
          id: ++toastSeq,
          title: `${label}: ${Math.round(point.rainfallMm)} mm of rain`,
          body: 'Weather comes from the seed and is the same in every scenario. Your land choices decide how well the valley copes.',
          severity: point.weather === 'favorable' ? 'good' : 'warning',
        })
      }
      for (const e of r.explanations) {
        if (e.severity === 'critical' || e.severity === 'warning' || e.topic === 'event' || e.severity === 'good') {
          toasts.push({ id: ++toastSeq, title: e.title, body: e.body, severity: e.severity, explanationId: e.id, cells: e.cells })
        }
      }
      // pause on critical news while playing, so a first drought, flooded homes or unpaid bills
      // never slip past a player who is busy placing things
      const prevPoint = s.sim.history[s.sim.history.length - 1]
      const droughtStarts = point?.weather === 'drought' && prevPoint?.weather !== 'drought'
      const reason = s.playing && s.settings.pauseOnEvents ? pauseReason(r.explanations, droughtStarts) : null
      let pauseToast: Toast | null = null
      if (reason) {
        pauseToast = {
          id: ++toastSeq,
          title: `Paused: ${reason.title}`,
          body: `${reason.body} Press Play to carry on, or turn this off in Settings.`,
          severity: reason.severity,
          explanationId: reason.id,
          cells: reason.cells,
          paused: true,
        }
      }
      const rest = pauseToast ? toasts.filter((t) => t.explanationId !== reason?.id) : toasts
      const shown = pauseToast ? [pauseToast, ...rest.slice(0, 2)] : rest.slice(0, 3)
      // One line per season for screen readers. While playing only warnings and critical news
      // are read, so fast speeds do not flood the reader; a manual step reads everything.
      const spoken = s.playing ? shown.filter((t) => t.severity === 'warning' || t.severity === 'critical') : shown
      const toastAnnouncement = spoken.length
        ? { id: ++toastSeq, text: `Year ${s.sim.year}, ${s.sim.season} season: ${spoken.map((t) => t.title.replace(/[.!]$/, '')).join('. ')}.` }
        : null
      const horizon = horizonSteps(next)
      const reachedHorizon = !s.reportShown && next.step >= horizon && s.sim.step < horizon
      set({
        sim: next,
        snapshots: [...s.snapshots, r.snapshot],
        explanations: [...s.explanations, ...r.explanations],
        undoStack: [],
        redoStack: [],
        viewSnapshot: null,
        viewStep: null,
        preview: null,
        ...(s.panel === 'insights' ? { seenExplanations: s.explanations.length + r.explanations.length } : {}),
        toasts: [...s.toasts, ...shown].slice(-4),
        toastAnnouncement,
        ...(reachedHorizon ? { reportOpen: true, reportShown: true, playing: false } : {}),
        ...(pauseToast ? { playing: false } : {}),
      })
      if (reachedHorizon || pauseToast) clearTimer()
      tutorialEvent('advance')
      saveGame({ silent: true })
    },

    stepYear: () => {
      get().stepSeason()
      if (!get().reportOpen) get().stepSeason()
    },

    setPlaying: (p) => {
      const s = get()
      if (p && (!s.sim || s.screen !== 'game')) return
      // playing on clears the "Paused: ..." notes, which otherwise stay until dismissed
      set({ playing: p, ...(p ? { viewSnapshot: null, viewStep: null, toasts: s.toasts.filter((t) => !t.paused) } : {}) })
      if (p) schedule()
      else clearTimer()
    },

    togglePlay: () => get().setPlaying(!get().playing),

    setSpeed: (sp) => {
      set({ speed: sp })
      if (get().playing) schedule()
    },

    viewHistory: (stepIdx) => {
      const s = get()
      if (!s.sim) return
      if (stepIdx === null || stepIdx >= s.sim.step || stepIdx < 0) {
        set({ viewStep: null, viewSnapshot: null })
        return
      }
      const snap = s.snapshots[stepIdx]
      if (!snap) return
      clearTimer()
      set({ viewStep: stepIdx, viewSnapshot: snap, playing: false, preview: null })
    },
  } satisfies Partial<GameStore>
}
