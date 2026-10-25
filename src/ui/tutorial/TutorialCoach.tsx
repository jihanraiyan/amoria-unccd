import { GraduationCap } from 'lucide-react'
import { useGame } from '../../state/store'
import { TUTORIAL_STEPS } from '../../state/tutorial'

// Tailwind needs literal class names. 'sm' matches the camera buttons (hidden below sm), 'md'
// matches the toolbar (folded into the Tools button below md).
const WIDE = { sm: 'hidden sm:block', md: 'hidden md:block' } as const
const NARROW = { sm: 'sm:hidden', md: 'md:hidden' } as const

export function TutorialCoach() {
  const tutorial = useGame((s) => s.tutorial)
  const skip = useGame((s) => s.skipTutorial)
  const flat = useGame((s) => s.worldView === 'flat')
  if (!tutorial.active || tutorial.done) return null
  const step = TUTORIAL_STEPS[tutorial.index]
  if (!step) return null
  const bp = step.smallBelow ?? 'md'
  return (
    <section className="panel anim-rise pointer-events-auto w-[22rem] max-w-full p-3.5" aria-label="Tutorial" aria-live="polite">
      <div className="flex items-center gap-2">
        <GraduationCap size={16} className="text-marigold" aria-hidden />
        <span className="eyebrow flex-1">
          Getting started · {tutorial.index + 1} of {TUTORIAL_STEPS.length}
        </span>
        <button type="button" className="text-xs text-dim hover:text-cream hover:underline" onClick={skip}>
          Skip tutorial
        </button>
      </div>
      <h2 className="mt-1 text-base leading-tight font-semibold">{step.title}</h2>
      {step.smallBody ? (
        <>
          <p className={`mt-1 text-sm leading-snug text-parchment ${WIDE[bp]}`}>{step.body}</p>
          <p className={`mt-1 text-sm leading-snug text-parchment ${NARROW[bp]}`}>{step.smallBody}</p>
        </>
      ) : (
        <p className="mt-1 text-sm leading-snug text-parchment">{step.body}</p>
      )}
      {flat && step.flatTask ? (
        <p className="mt-2 rounded-lg bg-marigold/15 px-2.5 py-1.5 text-sm font-semibold text-cream">{step.flatTask}</p>
      ) : step.smallTask ? (
        <>
          {/* same breakpoint as the controls the step points at, so the text never names missing controls */}
          <p className={`mt-2 rounded-lg bg-marigold/15 px-2.5 py-1.5 text-sm font-semibold text-cream ${WIDE[bp]}`} data-testid="tutorial-task">
            {step.task}
          </p>
          <p className={`mt-2 rounded-lg bg-marigold/15 px-2.5 py-1.5 text-sm font-semibold text-cream ${NARROW[bp]}`} data-testid="tutorial-task-small">
            {step.smallTask}
          </p>
        </>
      ) : (
        <p className="mt-2 rounded-lg bg-marigold/15 px-2.5 py-1.5 text-sm font-semibold text-cream">{step.task}</p>
      )}
      <div className="mt-2 flex gap-1" aria-hidden>
        {TUTORIAL_STEPS.map((s, i) => (
          <span key={s.id} className={`h-1 flex-1 rounded-full ${i < tutorial.index ? 'bg-marigold' : i === tutorial.index ? 'bg-marigold/50' : 'bg-white/10'}`} />
        ))}
      </div>
    </section>
  )
}
