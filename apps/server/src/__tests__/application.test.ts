import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, unlink, open } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createApplication } from '../application'
import { queryOne, run, getDatabase } from '@hidock/core/services/database'
import { wavHeader } from '@hidock/core/services/realtime-recorder'
let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string,string>
const origin = 'http://localhost:3000'
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'hidock-hosted-test-')); app = await createApplication({ dataPath: join(folder,'data'), backupPath: join(folder,'backups'), origin, processing: false }); await app.ready(); const token = await readFile(join(folder,'data','secrets','setup-code'),'utf8'); const login = await app.inject({ method:'POST',url:'/api/v1/auth/setup',headers:{origin},payload:{token,username:'owner',password:'a-long-test-password'} }); expect(login.statusCode).toBe(200); headers = { origin, cookie: login.cookies.map(cookie=>cookie.name+'='+cookie.value).join('; '), 'x-csrf-token': login.json().csrf } })
afterEach(async () => { await app.close(); await rm(folder,{recursive:true,force:true}) })
async function rpc(operation:string,args:unknown[]=[]) { return app.inject({method:'POST',url:'/api/v1/rpc/'+operation,headers,payload:{args}}) }
const audio = Buffer.concat([wavHeader(64000),Buffer.alloc(64000)])
const checksum = createHash('sha256').update(audio).digest('hex')
async function upload(serial?:string) { const result=await app.inject({method:'POST',url:'/api/v1/uploads',headers,payload:{filename:'meeting.wav',size:audio.length,checksum,...(serial?{serial,deviceFilename:'meeting.wav'}:{})}});expect(result.statusCode).toBe(200);return result.json().id as string }
async function chunk(id:string,offset:number,body:Buffer) { return app.inject({method:'PUT',url:'/api/v1/uploads/'+id+'?offset='+offset,headers:{...headers,'content-type':'application/octet-stream'},payload:body}) }
describe('hosted library boundaries',()=>{
  it('uses an eight-character setup code and stops logging it after owner creation', async () => {
    const token = await readFile(join(folder,'data','secrets','setup-code'),'utf8')
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    await app.close()
    const notices: string[] = []
    app = await createApplication({dataPath:join(folder,'data'),backupPath:join(folder,'backups'),origin,processing:false,setupLog:message=>notices.push(message)})
    expect(notices).toEqual([])
    expect((await app.inject({method:'POST',url:'/api/v1/auth/setup',headers,payload:{token,username:'second',password:'a-long-test-password'}})).statusCode).toBe(409)
  })
  it('requires a login, same-origin mutation and matching CSRF token',async()=>{expect((await app.inject('/api/v1/device/manifest?serial=test')).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/v1/rpc/projects:create',headers:{...headers,origin:'https://other.test'},payload:{args:['Test']}})).statusCode).toBe(403);expect((await app.inject({method:'POST',url:'/api/v1/rpc/projects:create',headers:{...headers,'x-csrf-token':'wrong'},payload:{args:['Test']}})).statusCode).toBe(403);expect((await rpc('projects:create',['Test'])).json().result.name).toBe('Test')})
  it('prevents owner replacement and revokes logout sessions',async()=>{expect((await app.inject({method:'POST',url:'/api/v1/auth/setup',headers,payload:{token:'wrong',username:'other',password:'another-long-password'}})).statusCode).toBe(409);await app.inject({method:'POST',url:'/api/v1/auth/logout',headers});expect((await rpc('library:list')).statusCode).toBe(401)})
  it('resumes committed chunks after restart and rejects stale offsets',async()=>{const id=await upload();expect((await chunk(id,0,audio.subarray(0,1000))).json().offset).toBe(1000);expect((await chunk(id,0,audio.subarray(0,1000))).statusCode).toBe(409);await app.close();app=await createApplication({dataPath:join(folder,'data'),backupPath:join(folder,'backups'),origin,processing:false});await app.ready();expect((await app.inject({url:'/api/v1/uploads/'+id,headers})).json().offset).toBe(1000);expect((await chunk(id,1000,audio.subarray(1000))).statusCode).toBe(200);const done=await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}});expect(done.statusCode).toBe(200);expect(done.json().recording_id).toBeTruthy();expect((await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}})).json().recording_id).toBe(done.json().recording_id);expect((await rpc('library:list')).json().result).toHaveLength(1)})
  it('verifies checksums, blocks path traversal, and does not create corrupt recordings',async()=>{expect((await app.inject({method:'POST',url:'/api/v1/uploads',headers,payload:{filename:'../outside.wav',size:100,checksum}})).statusCode).toBe(400);const id=await upload();const corrupt=Buffer.from(audio);corrupt[100]=1;await chunk(id,0,corrupt);expect((await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}})).statusCode).toBe(400);expect((await rpc('library:list')).json().result).toHaveLength(0)})
  it('deletes server data immediately and persists identity-bound device cleanup',async()=>{const id=await upload('P1-original');await chunk(id,0,audio);const done=await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}}),recording=done.json().recording_id;run("INSERT INTO transcripts(id,recording_id,text) VALUES ('transcript',?,'private text')",[recording]);expect((await rpc('library:deletion-info',[recording])).json().result.allowed).toBe(true);expect((await rpc('library:delete',[recording,true])).statusCode).toBe(200);expect(queryOne('SELECT id FROM recordings WHERE id=?',[recording])).toBeUndefined();expect(queryOne('SELECT id FROM transcripts')).toBeUndefined();const manifest=await app.inject({url:'/api/v1/device/manifest?serial=P1-original',headers});expect(manifest.json().commands).toHaveLength(1);expect(manifest.json().commands[0].checksum).toBe(checksum);expect((await app.inject({url:'/api/v1/device/manifest?serial=another-device',headers})).json().commands).toHaveLength(0)})
  it('backs up all metadata and complete audio with schema validation',async()=>{const id=await upload();await chunk(id,0,audio);await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}});const backup=await rpc('backup:create');expect(backup.statusCode).toBe(200);expect(backup.json().result.recordings).toBe(1);expect(getDatabase().pragma('integrity_check',{simple:true})).toBe('ok');const file=await readFile(backup.json().result.filePath);expect(file.length).toBeGreaterThan(1000)})
  it('provides read-only MCP tools with separately revocable tokens',async()=>{await rpc('agents:enabled',[true]);const token=(await app.inject({method:'POST',url:'/api/v1/mcp/tokens',headers,payload:{}})).json().token;const call=()=>app.inject({method:'POST',url:'/api/v1/mcp',headers:{authorization:'Bearer '+token},payload:{jsonrpc:'2.0',id:1,method:'tools/list'}});const result=await call();expect(result.statusCode).toBe(200);expect(result.json().result.tools.every((tool:{annotations:{readOnlyHint:boolean}})=>tool.annotations.readOnlyHint)).toBe(true);await rpc('agents:enabled',[false]);expect((await call()).statusCode).toBe(401)})
  it('saves sequenced live capture frames once and recovers an interrupted prefix',async()=>{const capture=(await app.inject({method:'POST',url:'/api/v1/captures',headers,payload:{serial:'P1'}})).json();const send=()=>app.inject({method:'PUT',url:'/api/v1/captures/'+capture.id+'?sequence=0',headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.alloc(64000)});expect((await send()).json().frames).toBe(1);expect((await send()).json().frames).toBe(1);const saved=await app.inject({method:'POST',url:'/api/v1/captures/'+capture.id+'/finish',headers,payload:{}});expect(saved.statusCode).toBe(200);expect((await rpc('library:detail',[saved.json().recordingId])).json().result.recording.duration).toBe(1)})
  it('serves authenticated byte ranges and refuses new playback while deletion is pending', async () => {
    const id = await upload(); await chunk(id,0,audio)
    const done = await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}}), recording = done.json().recording_id
    const range = await app.inject({url:'/api/v1/recordings/'+recording+'/audio',headers:{...headers,range:'bytes=0-43'}})
    expect(range.statusCode).toBe(206); expect(range.rawPayload.length).toBe(44); expect(range.headers['content-type']).toContain('audio/wav')
    expect((await app.inject({url:'/api/v1/recordings/'+recording+'/audio',headers:{...headers,range:'bytes=9999999-'}})).statusCode).toBe(416)
    run('INSERT INTO recording_deletions VALUES (?,0,?)',[recording,new Date().toISOString()])
    expect((await app.inject({url:'/api/v1/recordings/'+recording+'/audio',headers})).statusCode).toBe(409)
    expect((await rpc('library:waveform',[recording])).statusCode).toBe(400)
  })
})

describe('device verified-copy deletion boundary',()=>{
  async function savedCopy() { const id=await upload('P1-original');await chunk(id,0,audio);const done=await app.inject({method:'POST',url:'/api/v1/uploads/'+id+'/complete',headers,payload:{}});return done.json().recording_id as string }
  const verify=()=>app.inject({method:'POST',url:'/api/v1/device/verify-copy',headers,payload:{serial:'P1-original',filename:'meeting.wav',size:audio.length,checksum}})
  it('verifies the saved bytes without uploading or changing the library',async()=>{await savedCopy();const result=await verify();expect(result.statusCode, result.body).toBe(200);expect(result.json()).toEqual({verified:true});expect((await rpc('library:list')).json().result).toHaveLength(1)})
  it('rejects a missing or corrupt server copy even when its database row remains verified',async()=>{const id=await savedCopy(),row=queryOne<{file_path:string}>('SELECT file_path FROM recordings WHERE id=?',[id])!;const corrupt=Buffer.from(audio);corrupt[100]=1;await writeFile(row.file_path,corrupt);expect((await verify()).statusCode).toBe(400);await unlink(row.file_path);expect((await verify()).statusCode).toBe(400)})
  it('requires the original recorder identity, file size and checksum',async()=>{await savedCopy();for(const patch of [{serial:'another'},{size:audio.length+1},{checksum:'b'.repeat(64)},{filename:'other.wav'}]){const response=await app.inject({method:'POST',url:'/api/v1/device/verify-copy',headers,payload:{serial:'P1-original',filename:'meeting.wav',size:audio.length,checksum,...patch}});expect(response.statusCode).toBe(400)}})
  it('keeps automatic device deletion disabled by default and persists a strict boolean',async()=>{expect((await rpc('settings:get')).json().result.autoDeleteFromDevice).toBe(false);expect((await rpc('settings:update',[{autoDeleteFromDevice:true}])).json().result.autoDeleteFromDevice).toBe(true);expect((await rpc('settings:get')).json().result.autoDeleteFromDevice).toBe(true);expect((await rpc('settings:update',[{autoDeleteFromDevice:'true'}])).statusCode).toBe(400);expect((await rpc('settings:update',[{autoDeleteFromDevice:false}])).json().result.autoDeleteFromDevice).toBe(false)})
})

it('accepts 4 MiB chunks, rejects larger bodies, and resumes with checksum verification after restart', async () => {
  const bytes = Buffer.concat([wavHeader(4 * 1024 * 1024 + 64000), Buffer.alloc(4 * 1024 * 1024 + 64000, 7)])
  const digest = createHash('sha256').update(bytes).digest('hex')
  const begin = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: { filename: 'long-meeting.wav', size: bytes.length, checksum: digest } })
  expect(begin.statusCode).toBe(200)
  const id = begin.json().id, boundary = 4 * 1024 * 1024
  expect((await chunk(id, 0, bytes.subarray(0, boundary + 1))).statusCode).toBe(413)
  expect((await app.inject({ url: '/api/v1/uploads/' + id, headers })).json().offset).toBe(0)
  const first = await chunk(id, 0, bytes.subarray(0, boundary))
  expect(first.statusCode, first.body).toBe(200); expect(first.json().offset).toBe(boundary)
  expect((await rpc('library:list')).json().result).toHaveLength(0)
  await app.close()
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false })
  await app.ready()
  expect((await app.inject({ url: '/api/v1/uploads/' + id, headers })).json().offset).toBe(boundary)
  expect((await chunk(id, boundary, bytes.subarray(boundary))).statusCode).toBe(200)
  const done = await app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/complete', headers, payload: {} })
  expect(done.statusCode, done.body).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/complete', headers, payload: {} })).json().recording_id).toBe(done.json().recording_id)
  const saved = queryOne<{ checksum: string; verified: number }>('SELECT checksum,verified FROM recordings WHERE id=?', [done.json().recording_id])
  expect(saved).toEqual({ checksum: digest, verified: 1 })
})

it('restarts a checksum-failed upload when Retry reuses its original import request ID', async () => {
  const requestId = 'b33fd7e6-fb55-4544-bd44-3bf0b3bab57b', metadata = { filename: 'meeting.wav', size: audio.length, checksum, requestId }
  const begin = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: metadata }), id = begin.json().id
  const corrupt = Buffer.from(audio); corrupt[100] = 12
  await chunk(id, 0, corrupt)
  expect((await app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/complete', headers, payload: {} })).statusCode).toBe(400)
  const retry = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: metadata })
  expect(retry.statusCode, retry.body).toBe(200)
  expect(retry.json()).toMatchObject({ id, offset: 0, state: 'uploading' })
  expect((await chunk(id, 0, audio)).statusCode).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/complete', headers, payload: {} })).json().recording_id).toBeTruthy()
  expect((await rpc('library:list')).json().result).toHaveLength(1)
})

it('returns an acknowledged import on retry even if its destination project was subsequently deleted', async () => {
  const project = (await rpc('projects:create', ['Temporary project'])).json().result
  const metadata = { filename: 'meeting.wav', size: audio.length, checksum, projectId: project.id, requestId: 'fd32f8ea-cbb2-46fa-b3cc-b05e3e2023ea' }
  const begin = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: metadata }), id = begin.json().id
  await chunk(id, 0, audio)
  const completed = await app.inject({ method: 'POST', url: '/api/v1/uploads/' + id + '/complete', headers, payload: {} })
  run('DELETE FROM projects WHERE id=?', [project.id])
  const retry = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: metadata })
  expect(retry.statusCode, retry.body).toBe(200)
  expect(retry.json()).toMatchObject({ id, state: 'completed', recording_id: completed.json().recording_id })
  expect((await rpc('library:list')).json().result).toHaveLength(1)
})

it('does not verify or discard a live capture if its source PCM is shorter than its acknowledged byte count', async () => {
  const begin = await app.inject({ method: 'POST', url: '/api/v1/captures', headers, payload: { serial: 'P1' } }), id = begin.json().id
  await app.inject({ method: 'PUT', url: '/api/v1/captures/' + id + '?sequence=0', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(64000) })
  const source = join(folder, 'data', 'uploads', id + '.pcm')
  await writeFile(source, Buffer.alloc(100))
  const finished = await app.inject({ method: 'POST', url: '/api/v1/captures/' + id + '/finish', headers, payload: {} })
  expect(finished.statusCode, finished.body).toBe(400)
  expect((await readFile(source)).length).toBe(100)
  expect((await rpc('library:list')).json().result).toHaveLength(0)
  expect(queryOne<{ state: string }>('SELECT state FROM server_captures WHERE id=?', [id])?.state).toBe('recording')
})

it('writes every PCM byte even when the file system accepts only part of each write', async () => {
  const begin = await app.inject({ method: 'POST', url: '/api/v1/captures', headers, payload: { serial: 'P1' } }), id = begin.json().id, pcm = Buffer.alloc(64000, 31)
  await app.inject({ method: 'PUT', url: '/api/v1/captures/' + id + '?sequence=0', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: pcm })
  const probe = await open(join(folder, 'write-probe'), 'w'), prototype = Object.getPrototypeOf(probe), original = prototype.write
  await probe.close()
  const writes = vi.spyOn(prototype, 'write').mockImplementation(function (this: unknown, buffer: Buffer, offset = 0, length = buffer.length, position: number | null = null) { return original.call(this, buffer, offset, Math.min(length, 997), position) })
  try {
    const finished = await app.inject({ method: 'POST', url: '/api/v1/captures/' + id + '/finish', headers, payload: {} })
    expect(finished.statusCode, finished.body).toBe(200)
    const saved = await readFile(join(folder, 'data', 'recordings', id + '.wav'))
    expect(saved.length).toBe(pcm.length + 44)
    expect(saved.subarray(44)).toEqual(pcm)
  } finally { writes.mockRestore() }
})

it('retains capture sources and rejects completion if storage accepts zero bytes', async () => {
  const begin = await app.inject({ method: 'POST', url: '/api/v1/captures', headers, payload: { serial: 'P1' } }), id = begin.json().id
  await app.inject({ method: 'PUT', url: '/api/v1/captures/' + id + '?sequence=0', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(64000) })
  const probe = await open(join(folder, 'write-probe'), 'w'), prototype = Object.getPrototypeOf(probe)
  await probe.close()
  const writes = vi.spyOn(prototype, 'write').mockResolvedValue({ bytesWritten: 0 })
  try {
    const finished = await app.inject({ method: 'POST', url: '/api/v1/captures/' + id + '/finish', headers, payload: {} })
    expect(finished.statusCode, finished.body).toBe(400)
    expect((await readFile(join(folder, 'data', 'uploads', id + '.pcm'))).length).toBe(64000)
    expect((await rpc('library:list')).json().result).toHaveLength(0)
  } finally { writes.mockRestore() }
})
