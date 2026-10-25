// Terrain material: flat-shaded vertex-colored standard material, patched to blend in the
// active overlay (a per-cell color texture) and to draw its color-independent cue pattern
// (hatching, dots, contour lines, a street grid, runoff waves or per-category patterns) in world space.
import {
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  type IUniform,
} from 'three'

export interface TerrainUniforms {
  uOverlayTex: IUniform<DataTexture>
  uCueTex: IUniform<DataTexture>
  uOverlayMix: IUniform<number>
  uCueKind: IUniform<number>
  uGridSize: IUniform<Vector2>
  uContourStep: IUniform<number>
}

/** Categorical overlays (land cover) must not blend neighbouring category colors. */
export function overlayFilterFor(valueKind: 'none' | 'categorical' | 'continuous'): 'linear' | 'nearest' {
  return valueKind === 'categorical' ? 'nearest' : 'linear'
}

/** Switch a cell texture between linear and nearest filtering. */
export function setCellTextureFilter(tex: DataTexture, filter: 'linear' | 'nearest'): void {
  const f = filter === 'linear' ? LinearFilter : NearestFilter
  if (tex.magFilter === f && tex.minFilter === f) return
  tex.magFilter = f
  tex.minFilter = f
  tex.needsUpdate = true
}

export function makeCellTexture(width: number, height: number, srgb: boolean, filter: 'linear' | 'nearest'): DataTexture {
  const tex = new DataTexture(new Uint8Array(width * height * 4), width, height, RGBAFormat, UnsignedByteType)
  tex.magFilter = filter === 'linear' ? LinearFilter : NearestFilter
  tex.minFilter = filter === 'linear' ? LinearFilter : NearestFilter
  tex.generateMipmaps = false
  if (srgb) tex.colorSpace = SRGBColorSpace
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}

const PARS = /* glsl */ `
uniform sampler2D uOverlayTex;
uniform sampler2D uCueTex;
uniform float uOverlayMix;
uniform float uCueKind;
uniform vec2 uGridSize;
uniform float uContourStep;
varying vec3 vAmWorld;
varying float vAmSurface;

// 1 on lines at integer values of coord; halfWidth is in units of one period (0..0.5)
float amLine(float coord, float halfWidth) {
  float dist = 0.5 - abs(fract(coord) - 0.5);
  float aa = fwidth(coord) * 0.75;
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, dist);
}
float amHatch(vec2 p, float level, float freq) {
  if (level < 0.02) return 0.0;
  return amLine((p.x + p.y) * freq, 0.04 + 0.3 * level);
}
float amDots(vec2 p, float level, float freq) {
  if (level < 0.02) return 0.0;
  vec2 q = fract(p * freq) - 0.5;
  float r = length(q);
  float rad = 0.45 * sqrt(level);
  float aa = fwidth(p.x * freq) * 0.75;
  return 1.0 - smoothstep(rad - aa, rad + aa, r);
}
float amCategory(vec2 p, float code) {
  // matches COVER_PATTERNS in core/overlays.ts
  if (code < 0.5) return amDots(p, 0.35, 5.0);                                   // forest: dots
  if (code < 1.5) return 0.0;                                                    // grassland: plain
  if (code < 2.5) return amLine(p.y * 6.0, 0.12);                                // cropland: rows
  if (code < 3.5) return max(amLine(p.y * 4.0, 0.1), amDots(p + 0.125, 0.25, 4.0)); // agroforestry
  if (code < 4.5) return max(amLine(p.x * 4.0, 0.08), amLine(p.y * 4.0, 0.08));  // built-up: grid
  if (code < 5.5) return amLine(p.y * 5.0 + sin(p.x * 12.0) * 0.18, 0.1);        // wetland: waves
  if (code < 6.5) return 0.0;                                                    // water: plain
  return max(amLine((p.x + p.y) * 4.0, 0.1), amLine((p.x - p.y) * 4.0, 0.1));    // bare: cross-hatch
}
`

// The overlay is resolved in two steps. APPLY (before lighting) samples the overlay and cue
// textures and works out the cue ink; nothing is mixed into the lit color yet. POST runs after
// tone mapping, so overlay pixels skip ACES and the scene lights and land on the exact legend
// colors (the texture is sRGB, sampled to linear, and colorspace_fragment encodes it back). A
// light facet shade keeps relief readable. The texture holds premultiplied colors (no-data
// texels are transparent black), so filtered texels are divided by alpha to avoid dark halos.
// vAmSurface is 0 on the diorama skirt, which keeps its earthy strata under every overlay.
const APPLY = /* glsl */ `
vec3 amOvc = vec3(0.0);
float amHas = 0.0;
float amInkA = 0.0;
{
  vec2 amUv = (vAmWorld.xz + uGridSize * 0.5) / uGridSize;
  vec4 ov = texture2D(uOverlayTex, amUv);
  vec4 cue = texture2D(uCueTex, amUv);
  amOvc = ov.rgb / max(ov.a, 1e-3);
  float surf = clamp(vAmSurface, 0.0, 1.0);
  amHas = ov.a * uOverlayMix * surf;
  vec2 p = vAmWorld.xz;
  float level = cue.r;
  float ink = 0.0;
  int kind = int(uCueKind + 0.5);
  if (kind == 1) ink = amHatch(p, level, 3.0);
  else if (kind == 2) ink = amDots(p, level, 3.0);
  else if (kind == 3) {
    float hv = vAmWorld.y / max(uContourStep, 0.001);
    float major = step(4.5, mod(floor(hv + 0.5), 5.0));
    ink = amLine(hv, 0.05 + 0.05 * major);
  }
  else if (kind == 4) ink = amCategory(p, floor(cue.g * 255.0 + 0.5));
  else if (kind == 5) ink = max(amHatch(p, level, 3.0), amHatch(vec2(p.x, -p.y), level, 3.0));
  else if (kind == 6) ink = level < 0.02 ? 0.0 : amLine(p.y * 4.0, 0.04 + 0.3 * level);
  else if (kind == 7) ink = level < 0.02 ? 0.0 : max(amLine(p.x * 4.0, 0.03 + 0.22 * level), amLine(p.y * 4.0, 0.03 + 0.22 * level));
  else if (kind == 8) ink = level < 0.02 ? 0.0 : amLine(p.y * 3.0 + sin(p.x * 7.0) * 0.22, 0.03 + 0.3 * level);
  amInkA = ink * 0.5 * uOverlayMix * cue.b * surf;
}
`

/** Fixed key-light direction for the overlay's facet shade (matches the default sun). */
const POST = /* glsl */ `
{
  vec3 amN = normalize(cross(dFdx(vAmWorld), dFdy(vAmWorld)));
  if (amN.y < 0.0) amN = -amN;
  float amShade = 0.8 + 0.2 * clamp(dot(amN, normalize(vec3(0.45, 0.8, 0.35))), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, amOvc * amShade, amHas);
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 inkColor = lum > 0.18 ? vec3(0.02) : vec3(0.85);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, inkColor, amInkA);
}
`

export function createTerrainMaterial(uniforms: TerrainUniforms): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSurface;\nvarying vec3 vAmWorld;\nvarying float vAmSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvAmSurface = aSurface;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${APPLY}`)
      .replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>\n${POST}`)
  }
  mat.customProgramCacheKey = () => 'amoria-terrain'
  // reachable from the scene graph (debugging, scene tests)
  mat.userData.amoriaUniforms = uniforms
  return mat
}
