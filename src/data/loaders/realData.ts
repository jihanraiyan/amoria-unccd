// Adapter for the UI world catalog (src/state/worlds.ts discovers every module in this
// folder and reads `WORLDS`: entries of { meta, load }). Only real-data worlds are listed
// here; the catalog already provides the procedural Amoria Valley itself.
import { listWorlds } from '../registry'
import type { WorldMeta } from '../../simulation/types'
import type { LoadedWorld } from '../worldFile'

export interface CatalogEntry {
  meta: WorldMeta
  load(): Promise<LoadedWorld>
}

export const WORLDS: CatalogEntry[] = listWorlds()
  .filter((w) => w.source.type === 'file')
  .map((w) => ({ meta: w.meta, load: () => w.load() }))
