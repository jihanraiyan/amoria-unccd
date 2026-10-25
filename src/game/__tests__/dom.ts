// jsdom for the few renderer tests that render React (the canvas itself is mocked).
// Same workaround as tests/ui/dom.ts: jsdom 30 loads undici 8, which needs
// zlib.createZstdDecompress (missing before Node 22.15 / 23.8), so stub it first and then set
// up vitest's own jsdom environment on the global object. Import this FIRST.
import zlib from 'node:zlib'
import { afterAll } from 'vitest'
import { builtinEnvironments } from 'vitest/runtime'

const z = zlib as unknown as Record<string, unknown>
if (typeof z.createZstdDecompress !== 'function') {
  z.createZstdDecompress = () => {
    throw new Error('zstd decompression is not available in this Node version')
  }
}

if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  const env = await builtinEnvironments.jsdom.setup(globalThis, { jsdom: { url: 'http://localhost:3000/' } })
  afterAll(() => env.teardown(globalThis))
}

export {}
