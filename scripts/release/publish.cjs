const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { root, readVersion } = require('./version.cjs')
const { githubClient, tagCommit, git, findRelease } = require('./github.cjs')
const { verifyArtifacts, checksum } = require('./artifacts.cjs')
const { signManifest } = require('./signing.cjs')

function verifyUploadedAssets(assets, expected) {
  if (assets.length !== expected.length) { throw new Error('GitHub release has an unexpected set of assets; the draft will remain unpublished.') }
  for (const file of expected) {
    const asset = assets.find(item => item.name === file.name)
    if (!asset || asset.state !== 'uploaded' || asset.size !== file.size || (asset.digest && asset.digest !== `sha256:${file.sha256}`)) {
      throw new Error(`GitHub did not verify the complete ${file.name} upload; the draft will remain unpublished.`)
    }
  }
}

async function main() {
  const version = readVersion()
  const tag = `v${version}`
  const commit = git('rev-parse', 'HEAD')
  if (commit !== process.env.RELEASE_COMMIT || !/^[0-9a-f]{40}$/.test(commit)) { throw new Error('Release source must match the validated build commit.') }
  const api = githubClient()
  let release = await findRelease(api, tag)
  if (release && !release.draft) { console.log(`${tag} is already published.`); return }
  const directory = path.join(root, 'release', 'ci-assets')
  const signed = process.env.HIDOCKNOTES_SIGNED_RELEASE === 'true'
  const installers = await verifyArtifacts(directory, version, signed, process.env.HIDOCK_HOSTED_RELEASE === 'true')
  if (signed) {
    const result = signManifest({ format: 1, version, commit, artifacts: installers })
    for (const [name, bytes] of [['updates.json', result.bytes], ['updates.json.sig', result.signature]]) {
      const file = path.join(directory, name); fs.writeFileSync(file, bytes)
      installers.push({ name, size: bytes.length, sha256: await checksum(file) })
    }
  }
  const checksums = path.join(directory, 'SHA256SUMS.txt')
  fs.writeFileSync(checksums, installers.map(file => `${file.sha256}  ${file.name}\n`).join(''))
  const expected = [...installers, { name: 'SHA256SUMS.txt', size: fs.statSync(checksums).size, sha256: await checksum(checksums) }]
  const existingCommit = await tagCommit(api, tag)
  if (existingCommit && existingCommit !== commit) { throw new Error(`${tag} points to another commit and will not be changed.`) }
  if (!existingCommit) { await api('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: commit }) }

  const notes = path.join(root, 'release', 'release-notes.md')
  fs.writeFileSync(notes, `## Website, PWA and Docker\n\nPull \`ghcr.io/amitai5/hidocknotes:${version}\`. The web/PWA archive, compose.yaml and docker-image.json are attached. The image metadata includes its immutable digest. The desktop is a server-only client with native USB transport. On first launch, enter your server HTTPS address. Recordings, models, AI accounts and processing live on the server; a running server is required. Previous local library files are preserved but are no longer opened. Use a complete backup from 0.15.4 or earlier to migrate an existing local library. Configure MCP clients with the server HTTPS endpoint from Settings > Agent connections. Physical USB validation of the new desktop client remains pending.\n\n## Installers\n\n| Platform | Download |\n| --- | --- |\n| Windows (x64) | \`HiDockNotes-${version}-windows-x64-setup.exe\` |\n| Linux (x64) | \`HiDockNotes-${version}-linux-x64.AppImage\` or \`HiDockNotes-${version}-linux-x64.deb\` |\n| macOS (Intel) | \`HiDockNotes-${version}-macos-x64.dmg\` |\n| macOS (Apple Silicon) | \`HiDockNotes-${version}-macos-arm64.dmg\` |\n\nInstallers are built on native GitHub runners. SHA256SUMS.txt verifies the published installers and update assets. ${signed ? 'Windows installers are Authenticode signed; macOS apps are Developer ID signed and notarized. Linux downloads and update feeds are covered by the Ed25519-signed updates.json manifest. Update the desktop transport with the appropriate installer; library backups and application updates are managed on the server.' : 'Signing credentials are not configured for this build. Windows installers are unsigned; macOS apps are ad-hoc signed and not notarized. Use the manual installers; in-app installation is disabled.'}\n\nOn Linux, make the AppImage executable before opening it, or install the Debian package with your package manager. Speech models download inside the Docker server when first needed; desktop installers contain no local processing runtime.\n\nSource: [${commit}](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/tree/${commit}). App and bundled third-party licenses are included.\n`)
  const gh = (...args) => execFileSync('gh', [...args, '--repo', process.env.GITHUB_REPOSITORY], { stdio: 'inherit' })
  const prerelease = version.includes('-')
  if (!release) {
    release = await api('releases', 'POST', { tag_name: tag, target_commitish: commit, name: `HiDockNotes ${version}`, body: fs.readFileSync(notes, 'utf8'), generate_release_notes: true, draft: true, prerelease })
  }
  if (!release?.draft) { throw new Error('Expected an unpublished release draft.') }
  gh('release', 'upload', tag, ...expected.map(file => path.join(directory, file.name)), '--clobber')
  const assets = await api(`releases/${release.id}/assets?per_page=100`)
  verifyUploadedAssets(assets, expected)
  if (process.env.HIDOCK_HOSTED_RELEASE === 'true') {
    const image = JSON.parse(fs.readFileSync(path.join(directory, 'docker-image.json'), 'utf8'))
    const verified = require('./hosted.cjs').imageMetadata(version, image.digest, commit)
    if (JSON.stringify(image) !== JSON.stringify(verified)) throw new Error('Container metadata does not match the verified release.')
    // Promote the already-tested immutable image only after the version tag and assets are verified.
    execFileSync('docker', ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', verified.image, verified.pinnedImage], { stdio: 'inherit' })
  }
  const published = await api(`releases/${release.id}`, 'PATCH', { draft: false, prerelease, make_latest: prerelease ? 'false' : 'legacy' })
  console.log(`Published ${published.html_url}`)
  if (process.env.GITHUB_STEP_SUMMARY) { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published [HiDockNotes ${version}](${published.html_url}) with platform installers, update assets and SHA-256 checksums.\n`) }
}

if (require.main === module) { main().catch(error => { console.error(error.message); process.exitCode = 1 }) }
module.exports = { verifyUploadedAssets }
