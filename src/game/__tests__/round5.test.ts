// Fix round 5: whole-action refusal in the tool preview, overlay colors painted after tone
// mapping, and the diorama skirt kept free of overlay color and cue patterns.
import { describe, expect, it } from 'vitest'
import { DataTexture, ShaderLib, Vector2, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { terrainHeights } from '../core/coords'
import { TILE_STATE, buildTiles, previewTileStates } from '../controls/highlightData'
import { buildTerrainGeometry } from '../terrain/terrainData'
import { createTerrainMaterial } from '../terrain/terrainMaterial'
import { makeFrame } from './fixtures'

function compiledTerrainShader() {
  const tex = new DataTexture(new Uint8Array(4), 1, 1)
  const mat = createTerrainMaterial({
    uOverlayTex: { value: tex },
    uCueTex: { value: tex },
    uOverlayMix: { value: 1 },
    uCueKind: { value: 1 },
    uGridSize: { value: new Vector2(8, 8) },
    uContourStep: { value: 1 },
  })
  const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
  mat.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

describe('tool preview tile states', () => {
  it('every tile is blocked when each parcel passes but the action as a whole is refused', () => {
    const states = previewTileStates({ ok: false, cellOk: [true, true, true, true] }, 4)
    expect(states).toEqual([TILE_STATE.actionBlocked, TILE_STATE.actionBlocked, TILE_STATE.actionBlocked, TILE_STATE.actionBlocked])
    // the tile shader draws anything at or below 0.25 as striped orange, and valid needs 0.75
    expect(states.some((v) => v >= 0.75)).toBe(false)
    expect(states.every((v) => v <= 0.25)).toBe(true)
  })

  it('a passing action keeps per-parcel validity; failing parcels stay invalid either way', () => {
    expect(previewTileStates({ ok: true, cellOk: [true, false, true] }, 3)).toEqual([1, 0, 1])
    expect(previewTileStates({ ok: false, cellOk: [true, false] }, 2)).toEqual([TILE_STATE.actionBlocked, TILE_STATE.invalid])
    // not yet validated parcels are neutral while the action passes, blocked when it does not
    expect(previewTileStates({ ok: true, cellOk: [] }, 2)).toEqual([TILE_STATE.pending, TILE_STATE.pending])
    expect(previewTileStates({ ok: false, cellOk: [] }, 1)).toEqual([TILE_STATE.actionBlocked])
  })

  it('the states reach the tile vertices unchanged', () => {
    const frame = makeFrame(6, 6)
    const states = previewTileStates({ ok: false, cellOk: [true, true] }, 2)
    const t = buildTiles([7, 8], states, terrainHeights(frame.terrain), frame.terrain)
    expect(t.state.length).toBeGreaterThan(0)
    expect(Array.from(t.state).every((v) => v === TILE_STATE.actionBlocked)).toBe(true)
  })
})

describe('overlay colors are painted after tone mapping', () => {
  it('the patched fragment shader mixes the overlay into gl_FragColor after tonemapping and before color space conversion', () => {
    const fs = compiledTerrainShader().fragmentShader
    const tone = fs.indexOf('#include <tonemapping_fragment>')
    const mix = fs.indexOf('gl_FragColor.rgb = mix(gl_FragColor.rgb, amOvc * amShade, amHas);')
    const ink = fs.indexOf('gl_FragColor.rgb = mix(gl_FragColor.rgb, inkColor, amInkA);')
    const space = fs.indexOf('#include <colorspace_fragment>')
    expect(tone).toBeGreaterThan(0)
    expect(mix).toBeGreaterThan(tone)
    expect(ink).toBeGreaterThan(mix)
    expect(space).toBeGreaterThan(ink)
    // the overlay no longer goes through the lit diffuse color or the emissive term
    expect(fs).not.toContain('totalEmissiveRadiance += amGlow')
    expect(fs).not.toMatch(/diffuseColor\.rgb\s*=\s*mix\(diffuseColor\.rgb,\s*ovc/)
    // relief still reads: a facet shade from the world-space derivative normal
    expect(fs).toContain('cross(dFdx(vAmWorld), dFdy(vAmWorld))')
  })
})

describe('the diorama skirt keeps its strata under overlays', () => {
  it('aSurface is 1 on every surface vertex and 0 on every skirt vertex', () => {
    const frame = makeFrame(5, 4)
    const { geometry, grid } = buildTerrainGeometry(frame.terrain, terrainHeights(frame.terrain), 2)
    const a = geometry.getAttribute('aSurface')
    const pos = geometry.getAttribute('position')
    expect(a.count).toBe(pos.count)
    for (let v = 0; v < a.count; v++) expect(a.getX(v), `vertex ${v}`).toBe(v < grid.surfaceCount ? 1 : 0)
    expect(a.count).toBeGreaterThan(grid.surfaceCount)
  })

  it('the shaders gate both the overlay color and the cue ink by the surface flag', () => {
    const sh = compiledTerrainShader()
    expect(sh.vertexShader).toContain('attribute float aSurface;')
    expect(sh.vertexShader).toContain('vAmSurface = aSurface;')
    expect(sh.fragmentShader).toContain('float surf = clamp(vAmSurface, 0.0, 1.0);')
    expect(sh.fragmentShader).toContain('amHas = ov.a * uOverlayMix * surf;')
    expect(sh.fragmentShader).toMatch(/amInkA = ink \* 0\.5 \* uOverlayMix \* cue\.b \* surf;/)
  })
})
