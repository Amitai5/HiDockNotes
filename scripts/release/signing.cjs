const fs = require('node:fs')
const path = require('node:path')
const { createPublicKey, createPrivateKey, sign, verify } = require('node:crypto')

function keyFrom(value, privateKey = false) {
  if (!value) { throw new Error('Configure the Ed25519 update signing key before enabling signed releases.') }
  const key = (privateKey ? createPrivateKey : createPublicKey)(value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8'))
  if (key.asymmetricKeyType !== 'ed25519') { throw new Error('Update signing requires an Ed25519 key.') }
  return key
}
function signingPolicy(env = process.env, platform = process.platform) {
  const signed = env.HIDOCKNOTES_SIGNED_RELEASE === 'true'
  if (!signed) { return { signed: false, publicKey: '', publisher: '' } }
  const publicKey = keyFrom(env.UPDATE_SIGNING_PUBLIC_KEY).export({ type: 'spki', format: 'pem' }).toString()
  const required = platform === 'win32' ? ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'WINDOWS_PUBLISHER_NAME'] : platform === 'darwin' ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] : []
  for (const name of required) { if (!env[name]) { throw new Error(`Missing required signing configuration: ${name}`) } }
  return { signed: true, publicKey, publisher: env.WINDOWS_PUBLISHER_NAME || '' }
}
function writePolicy(appRoot, env = process.env, platform = process.platform) {
  const policy = signingPolicy(env, platform)
  const dependencies = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).dependencies
  if (policy.signed && !dependencies['electron-updater']) { throw new Error('Signed in-app releases require the electron-updater production dependency.') }
  fs.writeFileSync(path.join(appRoot, 'resources', 'update-policy.json'), JSON.stringify(policy, null, 2) + '\n')
  return policy
}
function signManifest(manifest, env = process.env) {
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  const signature = sign(null, bytes, keyFrom(env.UPDATE_SIGNING_PRIVATE_KEY, true))
  if (!verify(null, bytes, keyFrom(env.UPDATE_SIGNING_PUBLIC_KEY), signature)) { throw new Error('The update signing keys do not match.') }
  return { bytes, signature: Buffer.from(signature.toString('base64') + '\n') }
}
module.exports = { signingPolicy, writePolicy, signManifest }
