import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Main chunks share the entry's directory so __dirname-based preload/worker paths stay valid.
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('electron/main/index.ts'), 'transcription-worker': resolve('electron/main/transcription-worker.ts'), 'embedding-worker': resolve('electron/main/embedding-worker.ts'), 'calendar-worker': resolve('electron/main/calendar-worker.ts'), 'mcp-launcher': resolve('electron/main/mcp-launcher.ts') }, output: { chunkFileNames: '[name]-[hash].js' } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('electron/preload/index.ts'), server: resolve('electron/preload/server.ts') } } } },
  renderer: {
    root: '.',
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: { index: resolve('index.html'), server: resolve('server.html') } } }
  }
})
