// Display references: fixed values that turn simulation outputs into visual intensity.
// They are art-direction choices, not model parameters, and are documented in
// docs/progress/render.md. Fixed (not per-frame) so the same erosion looks the same every season.

/** Erosion index (game tonnes per ha per season) drawn as "fully gullied". About the 98th
 *  percentile of a normal wet season in the starter valley; the model caps at 150. */
export const EROSION_VISUAL_REF = 25

/** Wetland ponded water (mm) at which pools look full. The model's wetland store holds up to 400 mm. */
export const WETLAND_POOL_REF_MM = 150

/** Flood depth (m, illustrative model index) at which flood water looks deepest. */
export const FLOOD_VISUAL_REF_M = 2

/** River flow (season flowMm over the channel's bankfull capacity, terrain.bankfullMm) drawn as
 *  the highest river stage. A normal wet season runs at about 1.6 in both bundled worlds, a
 *  heavy-rain season at 4 to 7, a dry season at 0 to 1. */
export const FLOW_STAGE_REF = 3

/** Sediment concentration (game tonnes of fields.sedimentFlux per m3 of water passing, times
 *  1e6, so "g/m3" in game units) drawn as clear water and as fully muddy water. Mapped on a log
 *  scale. A normal wet season in the starter valley has a median near 700 on its channels. */
export const TURBIDITY_CLEAR = 100
export const TURBIDITY_MUDDY = 20000

/** Flow (mm over one cell) below which a channel cell counts as standing water for the
 *  turbidity color, so a trickle carrying a few grains does not look like mud. */
export const TURBIDITY_MIN_FLOW_MM = 5

/** Sediment deposited on a land cell in one season (fields.sedimentIn, game tonnes) drawn as
 *  the largest silt fan. Fans start at 40% of it (32 t), about the 99th percentile of a normal
 *  wet season in the starter valley and the 90th of a heavy-rain season. */
export const SILT_VISUAL_REF = 80
export const SILT_FAN_MIN = 0.4
