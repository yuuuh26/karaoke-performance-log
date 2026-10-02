import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/cloud-auth.ts','lib/cloud-backup.ts'],bundle:true,format:'esm',platform:'node',outdir:'.test-auth',outbase:'.'});
const auth=await import('../.test-auth/lib/cloud-auth.js'),backups=await import('../.test-auth/lib/cloud-backup.js');
test('専用アドレスでだけCookie認証を使い、通常通信に復旧キーを含めない',async()=>{
  const originalFetch=globalThis.fetch,originalLocation=globalThis.location;const calls=[];
  try{
    globalThis.location={origin:auth.CLOUD_ORIGIN};globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.endsWith('/v1/backups')?{backups:[],next_cursor:null}:{connected:true,sessions:[]}))};
    const key='x'.repeat(43);await auth.login(key,'スマホ');await auth.sessionStatus();await backups.listBackups({url:auth.CLOUD_ORIGIN});await auth.listSessions(key);await auth.revokeSession(key,'00000000-0000-4000-8000-000000000000');await auth.logout();
    assert.ok(calls.every(c=>c.init.credentials==='same-origin'&&c.init.cache==='no-store'&&c.init.redirect==='error'));
    assert.equal(calls[0].init.headers.Authorization,'Bearer '+key);assert.ok(!calls[1].init.headers.Authorization);assert.ok(!calls[2].init.headers.Authorization);assert.equal(calls[3].init.method,'POST');
    await assert.rejects(backups.listBackups({url:'https://other.workers.dev'}));
    globalThis.location={origin:'https://yuuuh26.github.io'};const count=calls.length;
    await assert.rejects(auth.sessionStatus());await assert.rejects(backups.listBackups({url:auth.CLOUD_ORIGIN}));assert.equal(calls.length,count);
    await backups.listBackups({url:auth.CLOUD_ORIGIN,token:key});assert.equal(calls.at(-1).init.credentials,'omit');assert.equal(calls.at(-1).init.headers.Authorization,'Bearer '+key);
  }finally{globalThis.fetch=originalFetch;if(originalLocation===undefined)delete globalThis.location;else globalThis.location=originalLocation}
});
