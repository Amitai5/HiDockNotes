const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const directory = mkdtempSync(join(tmpdir(), 'hidock-archive-smoke-'))
try {
  const archive = join(directory, 'model.tar.bz2')
  writeFileSync(archive, Buffer.from('QlpoOTFBWSZTWTbx68sAAEDbkdISQAF/hAIAb2+fQAQAIAAACCAAdCJlA0eoaAyAZGj1BKSaaaNAAAAAbwpvyDWAhJwwFiECDtHFKhk8Gu+YtykK2vCAtFTpJhBjmyi5hNECMVsJYmrFpgTNYRlf1QjwqmhIaHGNtI/AiVEH06LKsslK/F3JFOFCQNvHryw=', 'base64'))
  const tar = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar'
  assert.equal(execFileSync(tar, ['-tf', archive], { encoding: 'utf8', windowsHide: true }).trim(), 'fixture.txt')
  execFileSync(tar, ['-xjf', archive, '-C', directory, 'fixture.txt'], { windowsHide: true })
  assert.equal(readFileSync(join(directory, 'fixture.txt'), 'utf8').trim(), 'model archive extraction check')
  console.log('Local model tar.bz2 listing and extraction passed.')
} finally { rmSync(directory, { recursive: true, force: true }) }
