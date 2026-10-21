import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppUpdateService, compareReleaseVersion, updateAssetName, verifyReleaseManifest, type InstallerClient } from '../app-updates'

const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const installer = Buffer.from('signed fixture installer bytes')
const name = updateAssetName('0.11.0', 'win32', 'x64')
const manifest = { format: 1, version: '0.11.0', commit: 'a'.repeat(40), artifacts: [{ name, size: installer.length, sha256: createHash('sha256').update(installer).digest('hex') }] }
const bytes = Buffer.from(JSON.stringify(manifest)), signature = sign(null, bytes, keys.privateKey)
let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined })
function setup(options: { signed?: boolean; corruptSignature?: boolean; file?: string; feedVersion?: string } = {}) {
  const events = new Map<string, (value: { downloadedFile?: string; version?: string }) => void>()
  const client = { autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, disableWebInstaller: false, disableDifferentialDownload: false, setFeedURL: vi.fn(),
    on: vi.fn((event, listener) => { events.set(event, listener) }),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: options.feedVersion ?? '0.11.0' } })),
    downloadUpdate: vi.fn(async () => { events.get('update-downloaded')?.({ downloadedFile: options.file, version: '0.11.0' }); return [] }),
    quitAndInstall: vi.fn() } as InstallerClient
  const factory = vi.fn(() => client)
  const request = vi.fn(async (url: string) => new Response(url.endsWith('/latest') ? JSON.stringify({ tag_name: 'v0.11.0', draft: false, prerelease: false, body: '## Improvements\nTranscript editing.' }) : url.endsWith('.sig') ? (options.corruptSignature ? Buffer.alloc(64) : signature).toString('base64') : bytes, { status: 200 })) as unknown as typeof fetch
  const service = new AppUpdateService({ version: '0.10.0', platform: 'win32', arch: 'x64', packaged: true, appImage: false, policy: { signed: options.signed ?? true, publicKey, publisher: 'Fixture publisher' }, client: factory, changed: vi.fn(), fetch: request })
  return { service, client, factory, request }
}
describe('verified user-controlled application updates', () => {
  it('compares stable versions, rejects malformed tags and avoids downgrades', () => {
    expect(compareReleaseVersion('0.11.0', '0.10.0')).toBe(1)
    expect(compareReleaseVersion('0.10.0', '0.10.0')).toBe(0)
    expect(compareReleaseVersion('0.9.9', '0.10.0')).toBe(-1)
    expect(compareReleaseVersion('0.10.0', '0.10.0-beta.1')).toBe(1)
    expect(() => compareReleaseVersion('../installer', '0.10.0')).toThrow()
  })
  it('detects forged manifests, modified bytes, version mismatches and duplicate filenames', () => {
    expect(verifyReleaseManifest(bytes, signature, publicKey, '0.11.0').version).toBe('0.11.0')
    expect(() => verifyReleaseManifest(Buffer.from('changed'), signature, publicKey, '0.11.0')).toThrow('signature')
    expect(() => verifyReleaseManifest(bytes, signature, publicKey, '0.12.0')).toThrow('manifest')
    const duplicate = Buffer.from(JSON.stringify({ ...manifest, artifacts: [...manifest.artifacts, ...manifest.artifacts] }))
    expect(() => verifyReleaseManifest(duplicate, sign(null, duplicate, keys.privateKey), publicKey, '0.11.0')).toThrow('file list')
  })
  it('keeps unsigned builds on manual downloads and never initializes an installer client', async () => {
    const { service, factory } = setup({ signed: false })
    expect(await service.check()).toMatchObject({ phase: 'available', canInstall: false, nextVersion: '0.11.0' })
    expect(factory).not.toHaveBeenCalled()
    await expect(service.download()).rejects.toThrow('signed update')
  })
  it('blocks forged releases and installer feed mismatches before download', async () => {
    const forged = setup({ corruptSignature: true })
    await expect(forged.service.check()).rejects.toThrow('signature')
    expect(forged.factory).not.toHaveBeenCalled()
    const mismatch = setup({ feedVersion: '0.12.0' })
    await expect(mismatch.service.check()).rejects.toThrow('does not match')
    expect(mismatch.client.downloadUpdate).not.toHaveBeenCalled()
  })
  it('pins the verified version feed, disables automatic installation, checks downloaded bytes again, and leaves installation explicit', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hidock-update-test-'))
    const file = join(directory, 'installer.exe'); await writeFile(file, installer)
    const { service, client } = setup({ file })
    await service.check()
    expect(client.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://github.com/Amitai5/HiDockNotes/releases/download/v0.11.0/', channel: 'latest', useMultipleRangeRequest: false })
    expect(client).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false, allowPrerelease: false, disableWebInstaller: true })
    await service.download()
    expect(service.state().phase).toBe('downloaded')
    expect(client.quitAndInstall).not.toHaveBeenCalled()
    await writeFile(file, Buffer.from('modified after verification'))
    await expect(service.verifyDownloaded()).rejects.toThrow('size')
    expect(client.quitAndInstall).not.toHaveBeenCalled()
  })
  it('rejects corrupt downloads without reaching an installable state', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hidock-update-test-'))
    const file = join(directory, 'installer.exe'); await writeFile(file, Buffer.alloc(installer.length))
    const { service, client } = setup({ file }); await service.check()
    await expect(service.download()).rejects.toThrow('checksum')
    expect(service.state().phase).toBe('failed')
    expect(() => service.preparingInstall()).toThrow('verify')
    expect(client.quitAndInstall).not.toHaveBeenCalled()
  })
  it('requires a completed safety backup, preserves the installation gate on failure, and installs only after success', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hidock-update-test-'))
    const file = join(directory, 'installer.exe'); await writeFile(file, installer)
    const { service, client } = setup({ file }); await service.check(); await service.download()
    service.preparingInstall()
    expect(() => service.installAfterBackup()).toThrow('backup')
    await expect(service.prepareInstallation(async () => null)).rejects.toThrow('did not complete')
    expect(() => service.installAfterBackup()).toThrow('backup')
    expect(client.quitAndInstall).not.toHaveBeenCalled()
    await service.prepareInstallation(async () => ({ filePath: '/fixture/full-library.tar.gz', recordings: 25, bytes: 1000, changedAudio: 0 }))
    service.installAfterBackup()
    expect(client.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
