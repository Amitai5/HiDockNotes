const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const image = process.argv[2]
if (!image || !/^[a-zA-Z0-9_./:@-]+$/.test(image)) throw new Error('Provide a built container image.')
const name = 'hidocknotes-ci-' + process.pid
const docker = (...args) => execFileSync(process.env.DOCKER_EXECUTABLE || 'docker', args, { encoding: 'utf8', windowsHide: true }).trim()
async function main() {
  try {
    docker('run','-d','--name',name,'--user','568:568','--read-only','--tmpfs','/tmp:size=256m,mode=1777','--tmpfs','/data:uid=568,gid=568,mode=0700','--tmpfs','/backups:uid=568,gid=568,mode=0700','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PORT=10708','-e','APP_ORIGIN=https://notes.example.com','-e','APP_ALLOWED_ORIGINS=http://truenas.local:10708',image)
    let healthy = false
    for (let attempt=0;attempt<30;attempt++) { try { const health=JSON.parse(docker('exec',name,'node','-e',"fetch('http://127.0.0.1:10708/healthz').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))")); if(health.status==='ok'){healthy=true;break} } catch { /* Startup is bounded; print container logs on final failure. */ }; await new Promise(resolve=>setTimeout(resolve,1000)) }
    assert.ok(healthy, 'The image did not become healthy.')
    const healthcheck = JSON.parse(docker('inspect','--format','{{json .Config.Healthcheck.Test}}',name))
    docker('exec',name,'sh','-c',healthcheck[1])
    docker('exec',name,'node','-e',`Promise.all([fetch('http://127.0.0.1:10708/').then(r=>{if(!r.ok)throw Error('Missing website')}),fetch('http://127.0.0.1:10708/manifest.webmanifest').then(r=>r.json()).then(m=>{if(m.display!=='standalone')throw Error('Missing PWA manifest')}),fetch('http://127.0.0.1:10708/api/v1/device/manifest?serial=test').then(r=>{if(r.status!==401)throw Error('Unprotected library')})]).catch(e=>{console.error(e);process.exit(1)})`)
    docker('exec',name,'node','-e',`
      const assert = require('node:assert/strict'), fs = require('node:fs');
      async function verify() {
        const origin = 'http://truenas.local:10708', base = 'http://127.0.0.1:10708', token = fs.readFileSync('/data/secrets/setup-code','utf8');
        assert.match(token, /^[A-HJ-NP-Z2-9]{8}$/);
        const credentials = { username: 'smoke-owner', password: 'isolated-smoke-test-password' };
        const setup = await fetch(base+'/api/v1/auth/setup', { method:'POST', headers:{origin,'content-type':'application/json'}, body:JSON.stringify({...credentials,token}) });
        assert.equal(setup.status,200); const session = await setup.json(), cookie = setup.headers.get('set-cookie');
        assert.match(cookie,/hidock_local_session=/); assert.doesNotMatch(cookie,/; Secure/i); assert.match(cookie,/HttpOnly/);
        const headers = { origin, cookie:cookie.split(';')[0], 'x-csrf-token':session.csrf, 'content-type':'application/json' };
        const command = (operation,args=[]) => fetch(base+'/api/v1/rpc/'+operation,{method:'POST',headers,body:JSON.stringify({args})});
        assert.equal((await fetch(base+'/auth/callback?code=unused&state=unused')).status,404);
        assert.equal((await command('chatgpt:sign-in',[null])).status,200);
        const callback = await fetch(base+'/auth/callback?code=unused&state=wrong');
        assert.equal(callback.status,400); assert.equal(callback.headers.get('cache-control'),'no-store');
        assert.equal((await (await command('ai:state')).json()).result.chatgpt.signingIn,true);
        assert.equal((await command('chatgpt:cancel-sign-in')).status,200);
        assert.equal((await fetch(base+'/auth/callback?code=unused&state=unused')).status,404);
        const rpc = () => fetch(base+'/api/v1/rpc/library:list',{method:'POST',headers,body:JSON.stringify({args:[]})});
        assert.equal((await rpc()).status,200);
        headers.origin = 'http://unconfigured.local:10708'; assert.equal((await rpc()).status,403);
        const login = await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{origin:'https://notes.example.com','content-type':'application/json'},body:JSON.stringify(credentials)});
        assert.equal(login.status,200); assert.match(login.headers.get('set-cookie'),/hidock_session=/); assert.match(login.headers.get('set-cookie'),/; Secure/i);
      }
      verify().catch(error=>{console.error(error);process.exitCode=1});
    `)
    console.log('Container UID 568, port 10708, image healthcheck, website, PWA, local HTTP setup, secure public login, rejected origins and OAuth callback relay passed.')
  } catch (error) { console.error(docker('logs',name)); throw error }
  finally { try { docker('rm','-f',name) } catch { /* Never remove unrelated containers. */ } }
}
void main().catch(error=>{console.error(error.message);process.exitCode=1})
