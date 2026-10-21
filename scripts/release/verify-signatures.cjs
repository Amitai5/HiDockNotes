const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { root, readVersion } = require('./version.cjs')
const { signingPolicy } = require('./signing.cjs')

function main() {
  if (process.env.HIDOCKNOTES_SIGNED_RELEASE !== 'true') { console.log('Manual-download build: native signing was not requested.'); return }
  signingPolicy()
  const directory = path.join(root, 'release', readVersion())
  if (process.platform === 'win32') {
    const files = [path.join(directory, 'win-unpacked', 'HiDockNotes.exe'), path.join(directory, `HiDockNotes-${readVersion()}-windows-x64-setup.exe`)]
    const script = '$ErrorActionPreference = "Stop"; $sig = Get-AuthenticodeSignature -LiteralPath $env:HIDOCK_SIGNATURE_FILE; if ($sig.Status -ne "Valid") { throw "Installer signature is invalid" }; $name = $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false); if ($name -cne $env:WINDOWS_PUBLISHER_NAME) { throw "Installer publisher does not match" }'
    for (const file of files) { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit', env: { ...process.env, HIDOCK_SIGNATURE_FILE: file }, windowsHide: true }) }
  } else if (process.platform === 'darwin') {
    const app = path.join(directory, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'HiDockNotes.app')
    if (!fs.existsSync(app)) { throw new Error('The signed Mac app was not found.') }
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
  }
  console.log('Platform signature verification passed.')
}
if (require.main === module) { try { main() } catch (error) { console.error(error.message); process.exitCode = 1 } }
