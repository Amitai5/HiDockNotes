import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Keep the original command working with the shared artwork and export pipeline.
execFileSync(process.execPath, [fileURLToPath(new URL('./generate-app-icon.cjs', import.meta.url)), '--force'], { stdio: 'inherit', windowsHide: true })
