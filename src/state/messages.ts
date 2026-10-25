// Player-facing sentences built from recorded decisions, shared by the store (feedback after an
// action or an undo) and the timeline (decision markers and the past banner).
import type { DecisionRecord, PlayerAction } from '../simulation/types'
import { ACTION_PHRASE } from './toolActions'

/** "$9,000" (always positive: the sentence says which way the money moved). */
export const money = (v: number): string => `$${Math.round(Math.abs(v)).toLocaleString('en-US')}`

/** "built housing on 4 parcels for $8,000, earning $1,200 once" or "took a loan of $100,000". */
export function describeAction(action: PlayerAction, cost: number, revenue: number, fmt: (v: number) => string = money): string {
  const phrase = ACTION_PHRASE[action.type].toLowerCase()
  if (action.type === 'set-levy') return `${phrase} to ${Math.round(action.rate * 100)}%`
  const what = 'cells' in action ? ` ${action.cells.length} parcel${action.cells.length === 1 ? '' : 's'}` : ` of ${fmt(action.amount)}`
  const paid = cost > 0 ? ` for ${fmt(cost)}` : ''
  const earned = revenue > 0 ? `, earning ${fmt(revenue)} once` : ''
  return `${phrase}${what}${paid}${earned}`
}

/**
 * What undoing an action did, in words that match the money: `budgetChange` is the budget after
 * the undo minus the budget before it (positive when money came back).
 */
export function undoMessage(action: PlayerAction | undefined, record: DecisionRecord | undefined, budgetChange: number): string {
  if (!action) return 'Undid the last edit.'
  const cost = record?.cost ?? 0
  const revenue = record?.revenue ?? 0
  const head = `Undid: ${describeAction(action, cost, revenue)}.`
  const d = Math.round(budgetChange)
  if (action.type === 'loan') return `${head} The ${money(action.amount)} loan is no longer in the budget, and it is no longer owed.`
  if (action.type === 'repay') return `${head} ${money(d)} is back in the budget, and that debt is owed again.`
  if (revenue > 0) {
    const sale = action.type === 'clear' ? 'timber sale' : 'one-off sale'
    const refund = cost > 0 ? ` and the ${money(cost)} it cost is refunded` : ''
    const net = d === 0 ? 'so the budget is back where it was' : `so the budget is ${money(d)} ${d > 0 ? 'higher' : 'lower'} than before the undo`
    return `${head} The ${money(revenue)} ${sale} is undone${refund}, ${net}.`
  }
  if (d > 0) return `${head} ${money(d)} is back in the budget.`
  if (d < 0) return `${head} The budget is ${money(d)} lower again.`
  return `${head} It cost nothing, so the budget is unchanged.`
}

/** "3 saved decisions are" / "1 saved decision is": for replays that skipped decisions the model no longer allows. */
export const skippedDecisions = (n: number): string => `${n} saved decision${n === 1 ? ' is' : 's are'}`
