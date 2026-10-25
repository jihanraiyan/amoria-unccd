// Screen-reader text for the keyboard cursor. It describes whatever the view is drawing: the
// live world, or the past snapshot when one is shown read-only (the terrain is shared).
import type { ToolId } from '../../state/store'
import { coverName, structureName, type Terrain, type WorldLayers } from '../../simulation/types'
import { toolMode } from '../core/brush'

export function cursorAnnouncement(cell: number, terrain: Terrain, layers: WorldLayers, tool: ToolId, pastView = false): string {
  const x = cell % terrain.width
  const z = Math.floor(cell / terrain.width)
  const cover = terrain.channel[cell] ? 'river' : coverName(layers.cover[cell])
  const st = structureName(layers.structure[cell])
  const action = toolMode(tool) === 'inspect' ? 'Enter to inspect' : `Enter to apply ${tool}`
  return `Parcel ${x + 1}, ${z + 1}${pastView ? ' (past view)' : ''}: ${cover}${st !== 'none' ? `, ${st}` : ''}. ${action}.`
}
