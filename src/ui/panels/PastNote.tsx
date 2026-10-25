// One line telling the player a panel shows a past season, not the present.
import { afterText } from '../timeline/history'

export function PastNote({ step, what }: { step: number; what?: string }) {
  return (
    <p className="mb-3 rounded-lg border border-marigold/50 bg-marigold/10 p-2 text-xs text-cream" role="note">
      Showing the past: {step === 0 ? 'the start of the game' : afterText(step).toLowerCase()}, as on the timeline.{what ? ` ${what}` : ''}
    </p>
  )
}
