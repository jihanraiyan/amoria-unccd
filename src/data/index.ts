// Public entry point for world data: registry, loaders and the world file format.
export {
  DEFAULT_WORLD_ID,
  FALLBACK_WORLD_ID,
  PROCEDURAL_TERRAIN_SEED,
  PROCEDURAL_WORLD_ID,
  getWorldListing,
  listWorlds,
  loadWorld,
  loadWorldWithFallback,
  worldFileUrl,
  type LoadOptions,
  type LoadResult,
  type WorldListing,
  type WorldSource,
} from './registry'
export {
  ROAD_SOURCES,
  WORLDCOVER_CODES,
  WORLD_FILE_FORMAT,
  WORLD_FILE_VERSION,
  WorldLoadError,
  describeWorldCover,
  parseWorldFile,
  parseWorldText,
  type LoadedWorld,
  type WorldDetails,
  type WorldLoadErrorCode,
  type WorldPlace,
} from './worldFile'
export { REAL_WORLDS, type RealWorldRecord } from './realWorlds.generated'
