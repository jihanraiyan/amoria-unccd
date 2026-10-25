// Left rail: one button per panel, with the open one inverted. Panels open beside it.
import { BarChart3, Coins, Layers, Lightbulb, Settings, Target, Users, type LucideIcon } from 'lucide-react'
import { useGame, type PanelId } from '../../state/store'
import { Tip } from '../common/Tip'

export const PANEL_BUTTONS: { id: PanelId; label: string; icon: LucideIcon; key: string }[] = [
  { id: 'overlays', label: 'Overlays', icon: Layers, key: '1' },
  { id: 'budget', label: 'Budget', icon: Coins, key: '2' },
  { id: 'community', label: 'Community', icon: Users, key: '3' },
  { id: 'insights', label: 'Insights', icon: Lightbulb, key: '4' },
  { id: 'charts', label: 'Charts', icon: BarChart3, key: '5' },
  { id: 'objectives', label: 'Goals', icon: Target, key: '6' },
  { id: 'settings', label: 'Settings and help', icon: Settings, key: '?' },
]

function Badge({ children }: { children: string }) {
  return (
    <span className="tabular absolute -top-1 -right-1 min-w-4 rounded-full bg-cream px-1 text-center text-[0.65rem] leading-4 font-bold text-ink" aria-hidden>
      {children}
    </span>
  )
}

function RailButton({ id, label, icon: Icon, shortcut, badge, spoken }: { id: PanelId; label: string; icon: LucideIcon; shortcut: string; badge?: string | null; spoken?: string | null }) {
  const panel = useGame((s) => s.panel)
  const togglePanel = useGame((s) => s.togglePanel)
  const open = panel === id
  return (
    <Tip content={<span>{label} <span className="kbd ml-1">{shortcut}</span></span>} width="w-auto whitespace-nowrap" side="right">
      <button
        type="button"
        className={`rail-btn ${open ? 'rail-btn-active' : ''}`}
        aria-pressed={open}
        data-panel-button={id}
        aria-label={spoken ? `${label}, ${spoken}` : label}
        onClick={() => togglePanel(id)}
      >
        <Icon size={18} aria-hidden />
        {badge && <Badge>{badge}</Badge>}
      </button>
    </Tip>
  )
}

export function PanelRail() {
  const panel = useGame((s) => s.panel)
  const explanationCount = useGame((s) => s.explanations.length)
  const seen = useGame((s) => s.seenExplanations)
  const unread = panel === 'insights' ? 0 : Math.max(0, explanationCount - seen)
  const settings = PANEL_BUTTONS[PANEL_BUTTONS.length - 1]
  return (
    <nav className="panel pointer-events-auto flex flex-col items-center gap-1 p-1" aria-label="Panels">
      {PANEL_BUTTONS.slice(0, -1).map(({ id, label, icon, key }) => (
        <RailButton
          key={id}
          id={id}
          label={label}
          icon={icon}
          shortcut={key}
          badge={id === 'insights' && unread > 0 ? String(Math.min(unread, 99)) : null}
          spoken={id === 'insights' && unread > 0 ? `${unread} new` : null}
        />
      ))}
      <span className="rail-sep my-0.5 h-px w-6" aria-hidden />
      <RailButton id={settings.id} label={settings.label} icon={settings.icon} shortcut={settings.key} />
    </nav>
  )
}
