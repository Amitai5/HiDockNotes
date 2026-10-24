import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('electron/main/index.ts') }, output: { chunkFileNames: '[name]-[hash].js' } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { server: resolve('electron/preload/server.ts') } } } },
  renderer: { root: '.', plugins: [react()], build: { rollupOptions: { input: { server: resolve('server.html') } } } }
})
