const { execFileSync } = require('node:child_process')

function githubClient(env = process.env, fetchImpl = fetch) {
  const repository = env.GITHUB_REPOSITORY
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository || '') || !env.GH_TOKEN) { throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.') }
  const api = env.GITHUB_API_URL || 'https://api.github.com'
  return async (endpoint, method = 'GET', body) => {
    const response = await fetchImpl(`${api}/repos/${repository}/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    })
    if (method === 'GET' && response.status === 404) { return null }
    if (!response.ok) { throw new Error(`GitHub ${method} ${endpoint} failed with HTTP ${response.status}. Check repository permissions and retry the workflow.`) }
    return response.status === 204 ? null : response.json()
  }
}

async function tagCommit(api, tag) {
  const ref = await api(`git/ref/tags/${encodeURIComponent(tag)}`)
  if (!ref) { return null }
  let object = ref.object
  for (let depth = 0; object.type === 'tag' && depth < 10; depth++) {
    const annotation = await api(`git/tags/${object.sha}`)
    if (!annotation) { throw new Error(`Cannot resolve annotated tag ${tag}.`) }
    object = annotation.object
  }
  if (object.type !== 'commit') { throw new Error(`Tag ${tag} must resolve to a commit.`) }
  return object.sha
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

module.exports = { githubClient, tagCommit, git }
