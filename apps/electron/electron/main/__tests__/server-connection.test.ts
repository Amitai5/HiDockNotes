import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerConnection, saveServerConnection, validateServerOrigin } from '../server-connection'
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
describe('desktop server connection preference', () => {
  it('normalizes HTTPS origins and permits loopback HTTP for local development', () => { expect(validateServerOrigin(' https://notes.example.com/ ')).toBe('https://notes.example.com'); expect(validateServerOrigin('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234') })
  it.each(['http://truenas.local:10708', 'file:///tmp/site', 'javascript:alert(1)', 'https://owner:secret@example.com', 'https://example.com/path', 'https://example.com?token=secret', 'https://example.com/#/sync', '', undefined])('rejects unsafe or insecure server addresses: %s', value => { expect(() => validateServerOrigin(value)).toThrow() })
  it('treats an old local installation as unconfigured and preserves its library files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hidock-server-preference-')); directories.push(directory)
    writeFileSync(join(directory, 'library.fixture'), 'untouched')
    expect(readServerConnection(directory)).toEqual({ origin: null })
    saveServerConnection(directory, 'https://notes.example.com'); expect(readServerConnection(directory)).toEqual({ origin: 'https://notes.example.com' })
    expect(() => saveServerConnection(directory, null as unknown as string)).toThrow('HTTPS')
    expect(readServerConnection(directory)).toEqual({ origin: 'https://notes.example.com' })
    expect(readFileSync(join(directory, 'library.fixture'), 'utf8')).toBe('untouched')
    writeFileSync(join(directory, 'server-connection.json'), JSON.stringify({ origin: null }))
    expect(readServerConnection(directory)).toEqual({ origin: null })
  })
})
