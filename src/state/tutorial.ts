// Interactive tutorial. Each step completes only when the player actually does the
// thing it teaches; the store reports real events and this module decides progress.

export type TutorialEvent = 'navigate' | 'inspect' | 'build' | 'see-cost' | 'advance' | 'investigate'

export interface TutorialStep {
  id: TutorialEvent
  title: string
  body: string
  /** Short instruction of what to do to continue. */
  task: string
  /** The instruction on the flat map (no 3D camera), when it differs. */
  flatTask?: string
  /**
   * The instruction on small screens, when it differs. Below md keyboard shortcuts are rare and
   * the tool bar scrolls sideways; below sm the camera buttons are hidden too.
   */
  smallTask?: string
  /** The body text on small screens, when it differs. */
  smallBody?: string
  /** Breakpoint below which the small texts show: 'sm' for camera controls, 'md' (the default) for the toolbar. */
  smallBelow?: 'sm' | 'md'
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'navigate',
    title: 'Look around the valley',
    body: 'This is your valley. Rain runs downhill into the streams and out of the map. Plant cover holds the steep slopes together.',
    task: 'Drag the map to move, scroll to zoom, right-drag to turn, or use the camera buttons at the bottom left.',
    flatTask: 'Click a parcel on the map, or click the map and use the arrow keys to move between parcels.',
    smallTask: 'Drag to move, pinch to zoom, and twist with two fingers to turn.',
    smallBelow: 'sm',
  },
  {
    id: 'inspect',
    title: 'Inspect a parcel',
    body: 'Every square of land has its own soil, slope, water and vegetation. Click one to read it.',
    task: 'With the Inspect tool (I), click any parcel, or press Shift and an arrow key.',
    smallTask: 'Tap any parcel to read it.',
  },
  {
    id: 'build',
    title: 'Change the land',
    body: 'Pick a tool from the bar at the bottom and hover the map. Blue tiles mean you can build there. Orange striped tiles mean you cannot, and the bar at the bottom of the screen says why and what it costs, in words.',
    task: 'Build something: try Housing (H) or Cropland (C) near the village.',
    smallBody:
      'Pick a tool from the bar at the bottom and tap the map. Blue tiles mean you can build there. Orange striped tiles mean you cannot, and the bar at the bottom of the screen says why and what it costs, in words.',
    smallTask: 'Pick Housing or Cropland from the bar at the bottom, then tap near the village.',
  },
  {
    id: 'see-cost',
    title: 'Check what it cost',
    body: 'Everything costs money up front, and some things keep costing money every season.',
    task: 'Open the Budget panel (2) or click the budget at the top.',
    smallTask: 'Tap the budget at the top.',
  },
  {
    id: 'advance',
    title: 'Let time pass',
    body: 'Each turn is a season: a wet season, then a dry one. Rain falls, crops grow, soil changes.',
    task: 'Press Season (.) or Play (P) at the top.',
    smallTask: 'Tap Season or Play at the top.',
  },
  {
    id: 'investigate',
    title: 'Find out why',
    body: 'When something changes, the Insights feed explains it with the numbers behind it. Overlays show the hidden layers of the land.',
    task: 'Open Insights (4) and pick an entry, or switch on an overlay (1).',
    smallTask: 'Open Insights (the light bulb in the side bar) and tap an entry, or switch on an overlay.',
  },
]

export interface TutorialState {
  active: boolean
  index: number
  done: boolean
}

export const TUTORIAL_START: TutorialState = { active: true, index: 0, done: false }
export const TUTORIAL_OFF: TutorialState = { active: false, index: TUTORIAL_STEPS.length, done: true }

export function advanceTutorial(t: TutorialState, ev: TutorialEvent): TutorialState {
  if (!t.active || t.done) return t
  const current = TUTORIAL_STEPS[t.index]
  if (!current || current.id !== ev) return t
  const index = t.index + 1
  return index >= TUTORIAL_STEPS.length ? { active: false, index, done: true } : { ...t, index }
}
