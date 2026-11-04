import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { queryAll, queryOne, run, upsertRecordingFromDevice } from '@hidock/core/services/database'
import { createApplication } from '../application'

const origin = 'http://localhost:3000'
let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string, string>, recording: string, token: string
const rpc = (operation: string, args: unknown[] = []) => app.inject({ method: 'POST', url: '/api/v1/rpc/' + operation, headers, payload: { args } })
const mcp = (method: string, params?: unknown) => app.inject({ method: 'POST', url: '/api/v1/mcp', headers: { authorization: 'Bearer ' + token }, payload: { jsonrpc: '2.0', id: 1, method, params } })
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-retired-tasks-'))
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false, setupLog: () => undefined }); await app.ready()
  const code = await readFile(join(folder, 'data', 'secrets/setup-code'), 'utf8')
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token: code, username: 'owner', password: 'isolated-retirement-password' } })
  headers = { origin, cookie: owner.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': owner.json().csrf }
  recording = upsertRecordingFromDevice({ filename: 'pilot.hda', size: 100, duration: 60, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
  run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', ['summary', recording, 'Pilot approved.\n## Action items\nARCHIVED TASK TABLE\n## Next steps\nReview results next week.'])
  run('INSERT INTO actionables(id,recording_id,text,owner,done) VALUES (?,?,?,?,1)', ['archived', recording, 'ARCHIVED TASK ROW', 'Dana'])
  await rpc('agents:enabled', [true])
  token = (await app.inject({ method: 'POST', url: '/api/v1/mcp/tokens', headers, payload: {} })).json().token
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })

describe('Actionables retirement at the HTTP boundary', () => {
  it('rejects removed task operations and returns an empty compatibility field without deleting legacy rows', async () => {
    const before = queryAll('SELECT * FROM actionables')
    for (const [operation, args] of [['actionables:list', []], ['actionables:update', ['archived', { done: false }]]] as const) {
      const response = await rpc(operation, [...args])
      expect(response.statusCode, response.body).toBe(400)
    }
    const detail = await rpc('library:detail', [recording])
    expect(detail.statusCode).toBe(200)
    expect(detail.json().result.actionables).toEqual([])
    expect(queryAll('SELECT * FROM actionables')).toEqual(before)
  })
  it('removes task tools and task fields while retaining source-linked meeting outcomes', async () => {
    const listed = await mcp('tools/list'), names = listed.json().result.tools.map((tool: { name: string }) => tool.name)
    expect(names).not.toContain('list_action_items')
    expect(names).toContain('list_meeting_outcomes')
    const removed = await mcp('tools/call', { name: 'list_action_items', arguments: {} })
    expect(removed.json().error.message).toContain('Unknown or unavailable')
    const read = await mcp('tools/call', { name: 'get_recording', arguments: { recordingId: recording } })
    const result = JSON.parse(read.json().result.content[0].text)
    expect(result).not.toHaveProperty('actionItems')
    expect(result).not.toHaveProperty('actionItemsTruncated')
    expect(result.recording.summary).not.toContain('ARCHIVED TASK TABLE')
    expect(result.recording.summary).toContain('Review results next week.')
  })
  it('cleans a legacy summary before MCP pagination so later pages cannot leak its retired task table', async () => {
    const raw = 'A'.repeat(23990) + '\n## Action items\nARCHIVED TASK TABLE\n## Next steps\n' + 'B'.repeat(200)
    run('UPDATE summaries SET text=? WHERE recording_id=?', [raw, recording])
    const pages: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const response = await mcp('tools/call', { name: 'get_recording', arguments: { recordingId: recording, summaryOffset: offset } })
      const result = JSON.parse(response.json().result.content[0].text)
      pages.push(result.recording.summary); offset = result.nextSummaryOffset
      expect(pages.length).toBeLessThan(3)
    }
    expect(pages).toHaveLength(2)
    expect(pages.join('')).toBe('A'.repeat(23990) + '\n## Next steps\n' + 'B'.repeat(200))
    expect(queryOne('SELECT text FROM summaries WHERE recording_id=?', [recording])).toEqual({ text: raw })
  })
  it('exports the notes and narrative next steps without exporting retired task data', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/recordings/' + recording + '/export', headers, payload: { content: 'summary', format: 'md', includeAudio: false } })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.body).toContain('Pilot approved.')
    expect(response.body).toContain('Review results next week.')
    expect(response.body).not.toContain('ARCHIVED TASK')
    expect(queryOne('SELECT text,done,owner FROM actionables')).toEqual({ text: 'ARCHIVED TASK ROW', done: 1, owner: 'Dana' })
  })
})
