import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src') } },
  test: { environment: 'node', include: ['electron/**/__tests__/*.test.ts', 'src/**/__tests__/*.test.{ts,tsx}'], testTimeout: 15000, restoreMocks: true, setupFiles: ['./src/test-setup.ts'] }
})
