import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { UpdateState } from '../../../src/shared/updates'
import type { BackupResult } from '../../../src/shared/backup'

export const RELEASES_URL = 'https://github.com/Amitai5/HiDockNotes/releases'
const API = 'https://api.github.com/repos/Amitai5/HiDockNotes/releases/latest'
export interface UpdatePolicy { signed: boolean; publicKey: string; publisher: string }
interface Release { tag_name: string; draft: boolean; prerelease: boolean; body: string }
interface UpdateAsset { name: string; size: number; sha256: string }
interface SignedRelease { format: number; version: string; commit: string; artifacts: UpdateAsset[] }
export interface InstallerClient {
  autoDownload: boolean; autoInstallOnAppQuit: boolean; allowDowngrade: boolean; allowPrerelease: boolean; disableWebInstaller: boolean; disableDifferentialDownload: boolean
  setFeedURL(value: { provider: 'generic'; url: string; channel: string; useMultipleRangeRequest: boolean }): void
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(silent?: boolean, runAfter?: boolean): void
  on(event: string, listener: (value: { percent?: number; downloadedFile?: string; version?: string }) => void): unknown
}
interface Dependencies {
  version: string; platform: NodeJS.Platform; arch: string; packaged: boolean; appImage: boolean
  policy: UpdatePolicy; client(): InstallerClient; changed(state: UpdateState): void
  fetch?: typeof fetch
}
export function compareReleaseVersion(next: string, current: string): number {
  if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error('The release version is invalid.')
  const a = next.split('.').map(Number), b = current.split('-')[0].split('.').map(Number)
  for (let index = 0; index < 3; index++) { if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1 }
  return current.includes('-') ? 1 : 0
}
export function updateAssetName(version: string, platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32' && arch === 'x64') return `HiDockNotes-${version}-windows-x64-setup.exe`
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return `HiDockNotes-${version}-macos-${arch}.zip`
  if (platform === 'linux' && arch === 'x64') return `HiDockNotes-${version}-linux-x64.AppImage`
  throw new Error('In-app installation is unavailable for this platform. Use the releases page.')
}
export function verifyReleaseManifest(bytes: Buffer, signature: Buffer, publicKey: string, version: string): SignedRelease {
  const key = createPublicKey(publicKey)
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !verify(null, bytes, key, signature)) throw new Error('The release signature could not be verified. Installation was blocked.')
  const value = JSON.parse(bytes.toString('utf8')) as SignedRelease
  if (value.format !== 1 || value.version !== version || !/^[0-9a-f]{40}$/.test(value.commit) || !Array.isArray(value.artifacts) || value.artifacts.length > 30) throw new Error('The signed release manifest is invalid.')
  const names = new Set<string>()
  for (const file of value.artifacts) {
    if (!file || typeof file.name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || !/^[0-9a-f]{64}$/.test(file.sha256) || names.has(file.name)) throw new Error('The signed update file list is invalid.')
    names.add(file.name)
  }
  return value
}
/** Installs only explicitly requested updates whose exact bytes match a trusted signed manifest. */
export class AppUpdateService {
  private view: UpdateState
  private client: InstallerClient | null = null
  private downloaded: string | null = null
  private asset: UpdateAsset | null = null
  private busy = false
  private backupReady = false
  private readonly request: typeof fetch
  constructor(private readonly dependencies: Dependencies) {
    this.request = dependencies.fetch ?? fetch
    const reason = !dependencies.packaged ? 'Install a packaged release to use in-app installation.' : !dependencies.policy.signed || !dependencies.policy.publicKey ? 'This build uses manual installer downloads. Signed updates have not been configured.' : dependencies.platform === 'linux' && !dependencies.appImage ? 'Use your package manager to update a Debian installation, or use the AppImage for in-app updates.' : dependencies.platform === 'win32' && !dependencies.policy.publisher ? 'The trusted Windows publisher is missing from this build.' : null
    this.view = { phase: 'idle', currentVersion: dependencies.version, nextVersion: null, releaseNotes: '', progress: 0, canInstall: !reason, reason, error: null, checkedAt: null }
  }
  state(): UpdateState { return { ...this.view } }
  private publish(patch: Partial<UpdateState>): void { this.view = { ...this.view, ...patch }; this.dependencies.changed(this.state()) }
  private async get(url: string, limit: number): Promise<Buffer> {
    const response = await this.request(url, { headers: { Accept: url === API ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'HiDockNotes-updates' }, signal: AbortSignal.timeout(30000) })
    if (!response.ok || !response.body) throw new Error(`The release could not be downloaded (HTTP ${response.status}). Try again later.`)
    const chunks: Buffer[] = []; let size = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const result = await reader.read(); if (result.done) break
        size += result.value.length
        if (size > limit) throw new Error('The update response exceeds the allowed size.')
        chunks.push(Buffer.from(result.value))
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    return Buffer.concat(chunks, size)
  }
  async check(): Promise<UpdateState> {
    if (this.busy || this.view.phase === 'installing') throw new Error('An update operation is already running.')
    this.busy = true; this.downloaded = null; this.asset = null; this.backupReady = false
    this.publish({ phase: 'checking', error: null, progress: 0 })
    try {
      const release = JSON.parse((await this.get(API, 2 * 1024 ** 2)).toString('utf8')) as Release
      if (release.draft || release.prerelease || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('A stable release was not available.')
      const version = release.tag_name.slice(1)
      if (compareReleaseVersion(version, this.dependencies.version) <= 0) { this.publish({ phase: 'current', nextVersion: null, releaseNotes: '', checkedAt: new Date().toISOString() }); return this.state() }
      this.publish({ nextVersion: version, releaseNotes: typeof release.body === 'string' ? release.body : '', checkedAt: new Date().toISOString() })
      if (this.view.canInstall) {
        const base = `${RELEASES_URL}/download/v${version}/`
        const [manifest, signature] = await Promise.all([this.get(base + 'updates.json', 2 * 1024 ** 2), this.get(base + 'updates.json.sig', 2048)])
        const signed = verifyReleaseManifest(manifest, Buffer.from(signature.toString('ascii').trim(), 'base64'), this.dependencies.policy.publicKey, version)
        this.asset = signed.artifacts.find(file => file.name === updateAssetName(version, this.dependencies.platform, this.dependencies.arch)) ?? null
        if (!this.asset) throw new Error('This release has no signed installer for this computer.')
        const client = this.dependencies.client(), firstUse = this.client !== client
        this.client = client
        client.autoDownload = false; client.autoInstallOnAppQuit = false; client.allowPrerelease = false; client.allowDowngrade = false; client.disableWebInstaller = true; client.disableDifferentialDownload = true
        client.setFeedURL({ provider: 'generic', url: base, channel: this.dependencies.platform === 'darwin' ? `latest-${this.dependencies.arch}` : 'latest', useMultipleRangeRequest: false })
        if (firstUse) {
          client.on('error', () => { if (this.view.phase !== 'installing') this.publish({ phase: 'failed', error: 'The update client stopped. Retry the update check.' }) })
          client.on('download-progress', value => { if (this.view.phase === 'downloading') this.publish({ progress: Math.max(0, Math.min(1, (value.percent ?? 0) / 100)) }) })
          client.on('update-downloaded', value => { if (value.version === this.view.nextVersion && typeof value.downloadedFile === 'string') this.downloaded = value.downloadedFile })
        }
        const result = await client.checkForUpdates()
        if (!result || result.updateInfo.version !== version) throw new Error('The installer feed does not match the signed release.')
      }
      this.publish({ phase: 'available' }); return this.state()
    } catch (error) { this.publish({ phase: 'failed', error: error instanceof Error ? error.message : 'Could not check for updates.' }); throw error }
    finally { this.busy = false }
  }
  async download(): Promise<void> {
    if (this.busy || this.view.phase !== 'available' || !this.view.canInstall || !this.client || !this.asset) throw new Error('Check for a signed update before downloading.')
    this.busy = true; this.downloaded = null; this.publish({ phase: 'downloading', error: null, progress: 0 })
    try { await this.client.downloadUpdate(); await this.verifyDownloaded(); this.publish({ phase: 'downloaded', progress: 1 }) }
    catch (error) { this.downloaded = null; this.publish({ phase: 'failed', error: error instanceof Error ? error.message : 'The update download failed.' }); throw error }
    finally { this.busy = false }
  }
  async verifyDownloaded(): Promise<void> {
    if (!this.downloaded || !this.asset || !this.view.canInstall) throw new Error('No verified update is ready.')
    const info = await stat(this.downloaded)
    if (!info.isFile() || info.size !== this.asset.size) throw new Error('The update file size does not match the signed release.')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(this.downloaded)) hash.update(chunk)
    if (hash.digest('hex') !== this.asset.sha256) throw new Error('The downloaded installer failed its signed checksum. Installation was blocked.')
  }
  preparingInstall(): void {
    if (this.busy || this.view.phase !== 'downloaded' || !this.client || !this.downloaded) throw new Error('Download and verify the update first.')
    this.backupReady = false; this.publish({ phase: 'installing' })
  }
  async prepareInstallation(backup: () => Promise<BackupResult | null>): Promise<void> {
    if (this.view.phase !== 'installing') throw new Error('Confirm the update before preparing its safety backup.')
    await this.verifyDownloaded()
    if (!await backup()) throw new Error('The safety backup did not complete. The update was not installed.')
    await this.verifyDownloaded()
    this.backupReady = true
  }
  installAfterBackup(): void { if (this.view.phase !== 'installing' || !this.client || !this.backupReady) throw new Error('Complete the safety backup before installing.'); this.client.quitAndInstall(false, true) }
}
