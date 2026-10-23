const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const image = process.argv[2]
if (!image || !/^[a-zA-Z0-9_./:@-]+$/.test(image)) throw new Error('Provide a built container image.')
const name = 'hidocknotes-ci-' + process.pid
const docker = (...args) => execFileSync(process.env.DOCKER_EXECUTABLE || 'docker', args, { encoding: 'utf8', windowsHide: true }).trim()
async function main() {
  try {
    docker('run','-d','--name',name,'--read-only','--tmpfs','/tmp:size=256m,mode=1777','--tmpfs','/data:uid=1000,gid=1000,mode=0700','--tmpfs','/backups:uid=1000,gid=1000,mode=0700','--cap-drop','ALL','--security-opt','no-new-privileges','-e','APP_ORIGIN=http://localhost:3000',image)
    let healthy = false
    for (let attempt=0;attempt<30;attempt++) { try { const health=JSON.parse(docker('exec',name,'node','-e',"fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))")); if(health.status==='ok'){healthy=true;break} } catch { /* Startup is bounded; print container logs on final failure. */ }; await new Promise(resolve=>setTimeout(resolve,1000)) }
    assert.ok(healthy, 'The image did not become healthy.')
    docker('exec',name,'node','-e',`Promise.all([fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)throw Error('Missing website')}),fetch('http://127.0.0.1:3000/manifest.webmanifest').then(r=>r.json()).then(m=>{if(m.display!=='standalone')throw Error('Missing PWA manifest')}),fetch('http://127.0.0.1:3000/api/v1/device/manifest?serial=test').then(r=>{if(r.status!==401)throw Error('Unprotected library')})]).catch(e=>{console.error(e);process.exit(1)})`)
    console.log('Container website, PWA manifest and authenticated API passed.')
  } catch (error) { console.error(docker('logs',name)); throw error }
  finally { try { docker('rm','-f',name) } catch { /* Never remove unrelated containers. */ } }
}
void main().catch(error=>{console.error(error.message);process.exitCode=1})
