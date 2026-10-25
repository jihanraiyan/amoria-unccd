// Tool catalogue for the toolbar, the inspector and the help screen.
import {
  Axe,
  Container,
  Droplets,
  Factory,
  Gauge,
  Hammer,
  House,
  MousePointer2,
  Route,
  Shovel,
  Sprout,
  Store,
  Trees,
  Waves,
  Wheat,
  type LucideIcon,
} from 'lucide-react'
import type { ToolId } from '../../state/toolActions'

export type ToolGroup = 'look' | 'build' | 'farm' | 'restore' | 'water'

export interface ToolDef {
  id: ToolId
  name: string
  icon: LucideIcon
  /** Single key, shown as the shortcut. */
  key: string
  group: ToolGroup
  description: string
  /** What you gain and what it costs you, in plain words. */
  tradeoffs: { gain: string; cost: string }
  /** Which option controls apply. */
  options?: { intensity?: boolean; irrigation?: boolean }
  /** Whether dragging a brush over many parcels makes sense. */
  brush: boolean
}

export const GROUP_LABEL: Record<ToolGroup, string> = {
  look: 'Look',
  build: 'Build',
  farm: 'Farm',
  restore: 'Restore',
  water: 'Water',
}

export const TOOLS: readonly ToolDef[] = [
  {
    id: 'inspect',
    name: 'Inspect',
    icon: MousePointer2,
    key: 'I',
    group: 'look',
    description: 'Click a parcel to read its soil, water, slope and what it does for the valley.',
    tradeoffs: { gain: 'Information, for free.', cost: 'Nothing.' },
    brush: false,
  },
  {
    id: 'road',
    name: 'Road',
    icon: Route,
    key: 'R',
    group: 'build',
    description: 'Lay road to connect new homes, farms and markets.',
    tradeoffs: {
      gain: 'Access for new development and trade.',
      cost: 'Paved ground lets less rain soak in, so more runs off. Roads need upkeep.',
    },
    // roads are drawn as a one-parcel-wide line, so the brush size does not apply
    brush: false,
  },
  {
    id: 'housing',
    name: 'Housing',
    icon: House,
    key: 'H',
    group: 'build',
    description: 'Build homes so the valley can grow.',
    tradeoffs: {
      gain: 'Room for more people, which brings workers and tax income.',
      cost: 'More people need more food and water. Roofs and paving increase runoff.',
    },
    brush: true,
  },
  {
    id: 'market',
    name: 'Market',
    icon: Store,
    key: 'M',
    group: 'build',
    description: 'A market hall that creates jobs and trade income.',
    tradeoffs: { gain: 'Jobs and steady income.', cost: 'Up-front cost, upkeep, and land that no longer grows anything.' },
    brush: false,
  },
  {
    id: 'demolish',
    name: 'Demolish',
    icon: Hammer,
    key: 'B',
    group: 'build',
    description: 'Remove a structure so the land can be used another way.',
    tradeoffs: { gain: 'Frees the parcel for a better use.', cost: 'You lose what the structure provided. Check the live cost first.' },
    brush: true,
  },
  {
    id: 'cropland',
    name: 'Cropland',
    icon: Wheat,
    key: 'C',
    group: 'farm',
    description: 'Turn land into fields. Choose how hard to farm it and whether to irrigate.',
    tradeoffs: {
      gain: 'Food and farm income, starting next harvest.',
      cost: 'Tilled soil erodes more, especially on slopes. High intensity wears soil down faster. Irrigation draws on shared water.',
    },
    options: { intensity: true, irrigation: true },
    brush: true,
  },
  {
    id: 'set-intensity',
    name: 'Farming intensity',
    icon: Gauge,
    key: 'N',
    group: 'farm',
    description: 'Change how intensively existing fields are farmed.',
    tradeoffs: {
      gain: 'Higher: more food now. Lower: gentler on the soil and no input bill.',
      cost: 'Higher: soil declines faster, and the farm inputs are paid from the town fund every season. The town keeps only a small levy on each harvest, so the extra food can earn the fund less than the inputs cost. The preview shows the bill. Lower: smaller harvests.',
    },
    options: { intensity: true },
    brush: true,
  },
  {
    id: 'toggle-irrigation',
    name: 'Irrigation',
    icon: Droplets,
    key: 'G',
    group: 'farm',
    description: 'Switch irrigation on or off for existing fields.',
    tradeoffs: {
      gain: 'Protects harvests in dry seasons.',
      cost: 'Uses the same water homes rely on, and costs upkeep. In a drought it can leave less for people.',
    },
    brush: true,
  },
  {
    id: 'conservation',
    name: 'Soil conservation',
    icon: Shovel,
    key: 'T',
    group: 'farm',
    description: 'Terraces, contour rows or cover crops on farmland.',
    tradeoffs: {
      gain: 'Less erosion and slowly recovering soil.',
      cost: 'An up-front cost per field. The payoff builds over seasons, not right away.',
    },
    brush: true,
  },
  {
    id: 'agroforestry',
    name: 'Agroforestry',
    icon: Trees,
    key: 'O',
    group: 'farm',
    description: 'Grow trees among crops or pasture.',
    tradeoffs: {
      gain: 'Holds soil and water, and adds tree products as a second income over time.',
      cost: 'Costs to establish, takes seasons to mature, and grows less food than open fields at first.',
    },
    brush: true,
  },
  {
    id: 'clear',
    name: 'Clear land',
    icon: Axe,
    key: 'X',
    group: 'build',
    description: 'Remove vegetation to open land for building or farming.',
    tradeoffs: {
      gain: 'Space to develop.',
      cost: 'Removes the cover that protects soil. On steep slopes, heavy rain can wash much more soil away.',
    },
    brush: true,
  },
  {
    id: 'reforest',
    name: 'Reforest',
    icon: Sprout,
    key: 'F',
    group: 'restore',
    description: 'Plant native trees. Forest returns gradually over many seasons.',
    tradeoffs: {
      gain: 'Less runoff and erosion as trees mature; steadier water downstream.',
      cost: 'Costs money, gives no direct income, and uses land that could grow food or homes.',
    },
    brush: true,
  },
  {
    id: 'wetland',
    name: 'Restore wetland',
    icon: Waves,
    key: 'L',
    group: 'restore',
    description: 'Restore wetland or a riparian buffer, usually on low wet ground near water.',
    tradeoffs: {
      gain: 'Holds back water and traps sediment, which can ease floods downstream.',
      cost: 'Takes land out of farming or building, and costs money to restore.',
    },
    brush: true,
  },
  {
    id: 'reservoir',
    name: 'Reservoir',
    icon: Container,
    key: 'V',
    group: 'water',
    description: 'Store wet-season water to use in the dry season.',
    tradeoffs: { gain: 'More water when rain is scarce.', cost: 'Expensive, and the site it fills is lost to other uses.' },
    brush: true,
  },
  {
    id: 'waterworks',
    name: 'Waterworks',
    icon: Factory,
    key: 'K',
    group: 'water',
    description: 'Treat and pipe water to homes.',
    tradeoffs: { gain: 'More reliable water supply for the town.', cost: 'Construction cost and ongoing upkeep.' },
    brush: false,
  },
]

export const TOOL_BY_ID: Record<ToolId, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export const TOOL_BY_KEY: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]))
