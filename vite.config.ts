import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// UI/component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Many tests play whole seasons or 20-year games, which take seconds each and much longer when
    // the machine is busy. A generous default keeps `npm run check` a correctness gate, not a load test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
