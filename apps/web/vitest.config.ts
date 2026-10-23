import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({plugins:[react(),VitePWA({registerType:'prompt'})],test:{environment:'node',include:['src/**/__tests__/*.test.{ts,tsx}'],restoreMocks:true,setupFiles:['./src/test-setup.ts'],maxWorkers:4}})
