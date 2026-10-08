import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('electron/main/index.ts'), 'transcription-worker': resolve('electron/main/transcription-worker.ts') } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('electron/preload/index.ts') } } },
  renderer: {
    root: '.',
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve('index.html') } }
  }
})
