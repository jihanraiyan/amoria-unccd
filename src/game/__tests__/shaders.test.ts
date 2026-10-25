// No WebGL in the test environment, so these check that every shader patch finds its
// injection point in three's real shader sources (a silent no-op would disable a feature).
import { describe, expect, it } from 'vitest'
import { DataTexture, ShaderLib, Vector2, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { createTerrainMaterial } from '../terrain/terrainMaterial'
import { createPropMaterials } from '../props/materials'

function compile(mat: { onBeforeCompile: (s: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => void }) {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms
  mat.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

describe('shader patches', () => {
  it('terrain material injects overlay blending and cue patterns', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1)
    const s = compile(
      createTerrainMaterial({
        uOverlayTex: { value: tex },
        uCueTex: { value: tex },
        uOverlayMix: { value: 0 },
        uCueKind: { value: 0 },
        uGridSize: { value: new Vector2(1, 1) },
        uContourStep: { value: 1 },
      }),
    )
    expect(s.vertexShader).toContain('vAmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(s.fragmentShader).toContain('float amLine(')
    expect(s.fragmentShader).toContain('texture2D(uOverlayTex, amUv)')
    expect(s.fragmentShader.indexOf('texture2D(uOverlayTex')).toBeGreaterThan(s.fragmentShader.indexOf('#include <color_fragment>'))
    expect(Object.keys(s.uniforms)).toEqual(expect.arrayContaining(['uOverlayTex', 'uCueTex', 'uOverlayMix', 'uCueKind', 'uGridSize', 'uContourStep']))
  })

  it('prop materials tint only aTint faces and sway vegetation', () => {
    const mats = createPropMaterials()
    const veg = compile(mats.vegetation)
    expect(veg.vertexShader).toContain('attribute float aTint;')
    expect(veg.vertexShader).toContain('mix( vec3( 1.0 ), instanceColor.rgb, aTint )')
    expect(veg.vertexShader).not.toContain('vColor.rgb *= instanceColor.rgb;')
    expect(veg.vertexShader).toContain('transformed.x += sin( ph ) * k;')
    const solid = compile(mats.solid)
    expect(solid.vertexShader).toContain('mix( vec3( 1.0 ), instanceColor.rgb, aTint )')
    expect(solid.vertexShader).not.toContain('transformed.x += sin( ph ) * k;')
  })
})
