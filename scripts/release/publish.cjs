const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { root, readVersion } = require('./version.cjs')
const { githubClient, tagCommit, git, findRelease } = require('./github.cjs')
const { verifyArtifacts, checksum } = require('./artifacts.cjs')

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
  const installers = await verifyArtifacts(directory, version)
  const checksums = path.join(directory, 'SHA256SUMS.txt')
  fs.writeFileSync(checksums, installers.map(file => `${file.sha256}  ${file.name}\n`).join(''))
  const expected = [...installers, { name: 'SHA256SUMS.txt', size: fs.statSync(checksums).size, sha256: await checksum(checksums) }]
  const existingCommit = await tagCommit(api, tag)
  if (existingCommit && existingCommit !== commit) { throw new Error(`${tag} points to another commit and will not be changed.`) }
  if (!existingCommit) { await api('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: commit }) }

  const notes = path.join(root, 'release', 'release-notes.md')
  fs.writeFileSync(notes, `## Installers\n\n| Platform | Download |\n| --- | --- |\n| Windows (x64) | \`HiDockNotes-${version}-windows-x64-setup.exe\` |\n| Linux (x64) | \`HiDockNotes-${version}-linux-x64.AppImage\` or \`HiDockNotes-${version}-linux-x64.deb\` |\n| macOS (Intel) | \`HiDockNotes-${version}-macos-x64.dmg\` |\n| macOS (Apple Silicon) | \`HiDockNotes-${version}-macos-arm64.dmg\` |\n\nInstallers are built on native GitHub runners. SHA256SUMS.txt verifies all five downloads. Windows installers are unsigned; macOS apps are ad-hoc signed and not notarized, so operating-system security prompts may appear.\n\nOn Linux, make the AppImage executable before opening it, or install the Debian package with your package manager. Local speech models download when first needed.\n\nSource: [${commit}](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/tree/${commit}). App and bundled third-party licenses are included.\n`)
  const gh = (...args) => execFileSync('gh', [...args, '--repo', process.env.GITHUB_REPOSITORY], { stdio: 'inherit' })
  const prerelease = version.includes('-')
  if (!release) {
    release = await api('releases', 'POST', { tag_name: tag, target_commitish: commit, name: `HiDockNotes ${version}`, body: fs.readFileSync(notes, 'utf8'), generate_release_notes: true, draft: true, prerelease })
  }
  if (!release?.draft) { throw new Error('Expected an unpublished release draft.') }
  gh('release', 'upload', tag, ...expected.map(file => path.join(directory, file.name)), '--clobber')
  const assets = await api(`releases/${release.id}/assets?per_page=100`)
  verifyUploadedAssets(assets, expected)
  const published = await api(`releases/${release.id}`, 'PATCH', { draft: false, prerelease, make_latest: prerelease ? 'false' : 'legacy' })
  console.log(`Published ${published.html_url}`)
  if (process.env.GITHUB_STEP_SUMMARY) { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published [HiDockNotes ${version}](${published.html_url}) with five installers and SHA-256 checksums.\n`) }
}

if (require.main === module) { main().catch(error => { console.error(error.message); process.exitCode = 1 }) }
module.exports = { verifyUploadedAssets }
