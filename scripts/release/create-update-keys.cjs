const fs = require('node:fs')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')
const { root } = require('./version.cjs')

function main() {
  const argument = process.argv[2]
  if (!argument || !path.isAbsolute(argument)) { throw new Error('Choose an absolute key directory outside the repository.') }
  fs.mkdirSync(argument, { recursive: true, mode: 0o700 })
  const directory = fs.realpathSync(argument), relative = path.relative(fs.realpathSync(root), directory)
  if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) { throw new Error('Signing keys must be kept outside the repository.') }
  const privatePath = path.join(directory, 'hidocknotes-update-private.pem'), publicPath = path.join(directory, 'hidocknotes-update-public.pem')
  if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) { throw new Error('Signing keys already exist; they were not replaced.') }
  const pair = generateKeyPairSync('ed25519')
  fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o600 })
  console.log('Created Ed25519 update signing keys outside the repository. Store the private key as a GitHub Actions secret and the public key as a repository variable.')
}
if (require.main === module) { try { main() } catch (error) { console.error(error.message); process.exitCode = 1 } }
