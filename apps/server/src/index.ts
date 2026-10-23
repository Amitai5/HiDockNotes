import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createApplication } from './application'
const port = Number(process.env.PORT ?? 3000), origin = process.env.APP_ORIGIN ?? 'http://localhost:3000'
if (!Number.isInteger(port) || port < 1 || port > 65535 || new URL(origin).origin !== origin) throw new Error('Set PORT and APP_ORIGIN to a valid port and exact public origin.')
async function main(): Promise<void> {
const project = typeof __dirname === 'string' ? resolve(__dirname, '../../..') : existsSync(resolve('apps/server/package.json')) ? resolve('.') : resolve('../..')
process.env.WORKER_DIR ??= resolve(project, 'apps/server/dist')
const app = await createApplication({ dataPath: process.env.DATA_DIR ?? resolve(project, '.local-data'), backupPath: process.env.BACKUP_DIR ?? resolve(project, '.local-backups'), secretPath: process.env.SECRET_KEY_FILE, origin, webPath: process.env.WEB_DIR ?? resolve(project, 'apps/web/dist'), logger: true, onRestore: () => setTimeout(() => { void app.close().then(() => process.exit(0)) }, 1000) })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port })

}
void main().catch(error => { console.error(error); process.exitCode = 1 })
