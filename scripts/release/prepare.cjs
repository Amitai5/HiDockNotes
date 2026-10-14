const { appendFileSync } = require('node:fs')
const { readVersion } = require('./version.cjs')
const { githubClient, tagCommit, git } = require('./github.cjs')

async function releasePlan(api, version, commit) {
  const tag = `v${version}`
  const release = await api(`releases/tags/${tag}`)
  if (release && !release.draft) { return { version, tag, commit, publish: 'false' } }
  const existingCommit = await tagCommit(api, tag)
  if (existingCommit && existingCommit !== commit) { throw new Error(`${tag} already points to another commit. Bump the version; published version tags are never moved.`) }
  return { version, tag, commit, publish: 'true' }
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/production') { throw new Error('Releases must run from production.') }
  const version = readVersion()
  const commit = git('rev-parse', 'HEAD')
  if (commit !== process.env.GITHUB_SHA) { throw new Error('The checked-out source does not match the workflow commit.') }
  const plan = await releasePlan(githubClient(), version, commit)
  if (!process.env.GITHUB_OUTPUT) { throw new Error('GITHUB_OUTPUT is required.') }
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''))
  console.log(plan.publish === 'true' ? `Build ${plan.tag} from ${commit}.` : `${plan.tag} is already published; no installers will be replaced.`)
}

if (require.main === module) { main().catch(error => { console.error(error.message); process.exitCode = 1 }) }
module.exports = { releasePlan }
