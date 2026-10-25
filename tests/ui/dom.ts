// Sets up a jsdom browser environment for UI tests. Import this FIRST in every UI test file.
//
// Why not `// @vitest-environment jsdom`? jsdom 30 loads undici 8, which binds
// zlib.createZstdDecompress at load time. Node releases before 22.15 / 23.8 have no zstd,
// so on those versions the built-in jsdom environment crashes while the test worker starts
// (and vitest's docblock only accepts environment names, not a path to a custom one).
// Here the missing function is stubbed first, then vitest's own jsdom environment is set
// up on the global object. Tests never fetch compressed responses, so the stub is never
// called. On a Node version with zstd the stub is skipped and this is plain vitest jsdom.
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
