import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApplication } from '../application'
it('prints the short setup code on an unconfigured server and accepts lowercase input', async () => {
  const folder = await mkdtemp(join(tmpdir(),'hidock-setup-')), messages: string[] = []
  const app = await createApplication({dataPath:join(folder,'data'),backupPath:join(folder,'backups'),origin:'http://localhost:3000',processing:false,setupLog:message=>messages.push(message)})
  try {
    const code = await readFile(join(folder,'data','secrets','setup-code'),'utf8')
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(messages).toEqual(['HiDockNotes first-run setup. Read /data/secrets/setup-code in the container. Setup code: '+code])
    expect((await readFile(join(folder,'data','secrets','server.key'))).length).toBe(32)
    const setup = await app.inject({method:'POST',url:'/api/v1/auth/setup',headers:{origin:'http://localhost:3000'},payload:{token:code.toLowerCase(),username:'owner',password:'a-long-test-password'}})
    expect(setup.statusCode).toBe(200)
  } finally { await app.close(); await rm(folder,{recursive:true,force:true}) }
})
