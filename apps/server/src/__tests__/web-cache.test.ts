import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApplication } from '../application'

let app: Awaited<ReturnType<typeof createApplication>>, folder: string
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-ui-cache-'))
  const webPath = join(folder, 'web')
  await mkdir(webPath)
  for (const [name, text] of Object.entries({ 'index.html': '<!doctype html><title>Current server UI</title>', 'sw.js': '/* current worker */', 'registerSW.js': '/* registration */', 'manifest.webmanifest': '{}' })) await writeFile(join(webPath, name), text)
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin: 'https://notes.example.com', webPath, processing: false, setupLog: () => undefined })
})
afterAll(async () => { await app?.close(); if (folder) await rm(folder, { recursive: true, force: true }) })
describe('web release cache freshness', () => {
  it.each(['/', '/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest', '/library'])('revalidates the server entry point or worker at %s', async url => {
    const result = await app.inject({ url })
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('no-cache, must-revalidate')
  })
  it('does not return the app for a missing JavaScript asset', async () => {
    const result = await app.inject({ url: '/assets/old-build.js' })
    expect(result.statusCode).toBe(404); expect(result.json()).toEqual({ error: 'Not found.' })
  })
})
