// What the model wrote about the chosen season in each run, side by side, so a difference
// in outcomes can be traced to its causes in both futures.
import { useState } from 'react'
import type { RunData } from '../../state/store'
import { ExplanationCard } from '../panels/InsightsPanel'
import { afterText, explainsStep } from '../timeline/history'

function Column({ id, run, step }: { id: 'A' | 'B'; run: RunData; step: number }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = run.explanations.filter((e) => explainsStep(e, step))
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-base font-semibold">Scenario {id}</h3>
      {list.length === 0 ? (
        <p className="rounded-lg bg-black/20 p-2.5 text-xs text-dim">The model wrote no explanation for this season in Scenario {id}.</p>
      ) : (
        <ul className="space-y-1.5" aria-label={`Scenario ${id} explanations`}>
          {list.map((e) => (
            <ExplanationCard key={`${id}-${e.id}`} e={e} active={open === e.id} mapButton={false} onOpen={() => setOpen((o) => (o === e.id ? null : e.id))} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function CompareInsights({ A, B, step }: { A: RunData; B: RunData; step: number }) {
  return (
    <section className="panel mt-3 p-4" aria-labelledby="cmp-why">
      <h2 id="cmp-why" className="text-lg font-semibold">
        Why: {step === 0 ? 'the starting briefing' : `what happened in the season that ended here (${afterText(step).toLowerCase()})`}
      </h2>
      <p className="mb-2 text-xs text-muted">
        Each run's own explanations, written by the simulation from its numbers. Open one to see the values behind it. Move the season slider above to trace another season.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Column id="A" run={A} step={step} />
        <Column id="B" run={B} step={step} />
      </div>
    </section>
  )
}
