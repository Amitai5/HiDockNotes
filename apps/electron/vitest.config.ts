import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src') } },
  test: { environment: 'node', include: ['electron/main/__tests__/hosted-client.test.ts', 'electron/main/__tests__/hosted-recorder.test.ts', 'electron/main/__tests__/server-connection.test.ts', 'electron/main/services/__tests__/native-usb-guard.test.ts', 'src/components/__tests__/ServerConnectionPanel.test.tsx'], testTimeout: 15000, restoreMocks: true, setupFiles: ['./src/test-setup.ts'] }
})
