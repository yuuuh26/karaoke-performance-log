import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['cloudflare/worker.ts','lib/snapshot.ts'],bundle:true,format:'esm',platform:'node',outdir:'.test-worker',outbase:'.'});
const worker=(await import('../.test-worker/cloudflare/worker.js')).default;
const {createBackup,digest}=await import('../.test-worker/lib/snapshot.js');
const migration=await readFile('cloudflare/migrations/0001_backups.sql','utf8')+await readFile('cloudflare/migrations/0002_sessions.sql','utf8');
class D1 {
  db=new DatabaseSync(':memory:'); calls=0; failBatch=false;
  constructor(){this.db.exec(migration)}
  prepare(sql){const owner=this;return {sql,args:[],bind(...args){this.args=args;return this},async first(){owner.calls++;return owner.db.prepare(sql).get(...this.args)??null},async all(){owner.calls++;return {results:owner.db.prepare(sql).all(...this.args)}}}}
  async batch(statements){this.db.exec('BEGIN');try{for(const [i,s] of statements.entries()){this.calls++;this.db.prepare(s.sql).run(...s.args);if(this.failBatch&&i===0)throw Error('interrupted batch')}this.db.exec('COMMIT');return statements.map(()=>({success:true}))}catch(e){this.db.exec('ROLLBACK');throw e}}
}
const token='test-only-token-'.padEnd(43,'x');
const origin='https://yuuuh26.github.io';
const state={songs:[],tags:[{id:1,name:'🎤'.repeat(120000),extra:'保持'}],machines:[],revision:0,lastSavedAt:'',lastMachine:'',peakCount:0,readMilestone:0,jsonMilestone:0};
async function setup(){const DB=new D1();return {DB,BACKUP_TOKEN_SHA256:await digest(token)}}
function request(path,method='GET',body,headers={}){return new Request('https://test.workers.dev'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})}
test('認証・CORSを拒否した要求はD1に触れず、設定不足は閉じた状態を維持する',async()=>{
  const env=await setup();
  for(const [headers,expected] of [[{Authorization:''},401],[{Authorization:'Bearer '+'z'.repeat(43)},401],[{Origin:'https://evil.example'},403]]) {
    assert.equal((await worker.fetch(request('/v1/backups','GET',null,headers),env)).status,expected);
  }
  assert.equal((await worker.fetch(request('/v1/backups'),{...env,BACKUP_TOKEN_SHA256:''})).status,503);
  assert.equal(env.DB.calls,0);
  const preflight=await worker.fetch(request('/v1/backups','OPTIONS',null,{'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Authorization,Content-Type'}),env);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
  assert.equal((await worker.fetch(request('/v1/backups','OPTIONS',null,{'Access-Control-Request-Method':'DELETE'}),env)).status,405);
});
test('複数チャンクの履歴保存・読み戻し・再試行・上書き拒否とバッチ失敗の原子性',async()=>{
  const env=await setup();const captured={format:'karaoke-performance-log.snapshot',schema_version:1,state,recovery:null};
  const backup=await createBackup(captured,crypto.randomUUID());
  assert.ok(backup.byte_length>200000);
  const path='/v1/backups/'+backup.backup_id;
  assert.equal((await worker.fetch(request(path,'PUT',backup),env)).status,200);
  const response=await worker.fetch(request(path),env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const saved=await response.json();assert.equal(saved.backup_json,backup.backup_json);assert.equal(saved.sha256,backup.sha256);
  assert.ok(env.DB.db.prepare('SELECT chunk_count FROM backups').get().chunk_count>1);
  assert.equal((await worker.fetch(request(path,'PUT',backup),env)).status,200);
  const changed=await createBackup({...captured,state:{...state,lastMachine:'変更'}});changed.backup_id=backup.backup_id;
  assert.equal((await worker.fetch(request(path,'PUT',changed),env)).status,409);
  assert.equal((await worker.fetch(request(path,'DELETE'),env)).status,405);
  assert.throws(()=>env.DB.db.exec('DELETE FROM backups'));assert.throws(()=>env.DB.db.exec("UPDATE backup_chunks SET backup_json='broken'"));
  const second=await createBackup(captured);env.DB.failBatch=true;
  assert.equal((await worker.fetch(request('/v1/backups/'+second.backup_id,'PUT',second),env)).status,503);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM backups').get().n,1);
  assert.equal((await worker.fetch(request('/v1/backups/'+second.backup_id),env)).status,404);
  env.DB.failBatch=false;
  assert.equal((await worker.fetch(request('/v1/backups/'+second.backup_id,'PUT',second),env)).status,200);
  const list=await (await worker.fetch(request('/v1/backups'),env)).json();assert.equal(list.backups.length,2);assert.equal(list.next_cursor,null);assert.ok(list.backups.every(row=>!('backup_json' in row)));
  assert.equal((await worker.fetch(request('/v1/backups?cursor=invalid'),env)).status,400);
  assert.equal((await worker.fetch(request('/v1/backups/'+crypto.randomUUID(),'PUT',{...backup,backup_json:'broken'}),env)).status,400);
});
const own='https://test.workers.dev';
function sessionRequest(path,method='GET',body,headers={}){return new Request(own+path,{method,headers:{Origin:own,'Sec-Fetch-Site':'same-origin',...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})}
async function signIn(env,name='この端末',cookie){const response=await worker.fetch(sessionRequest('/v1/session','POST',{deviceName:name},{Authorization:'Bearer '+token,...(cookie?{Cookie:cookie}:{})}),env);assert.equal(response.status,200);return {cookie:response.headers.get('Set-Cookie').split(';')[0],data:await response.json(),headers:response.headers}}
test('端末通行証は秘密Cookieで保持し、期限なし・アプリ限定・別オリジン拒否を守る',async()=>{
  const env=await setup();
  assert.equal((await worker.fetch(sessionRequest('/v1/session','POST',{deviceName:'test'}),env)).status,401);assert.equal(env.DB.calls,0);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','POST',null,{Authorization:'Bearer '+token}),env)).status,415);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','POST',[],{Authorization:'Bearer '+token}),env)).status,400);
  const first=await signIn(env);
  const header=first.headers.get('Set-Cookie');assert.match(header,/^__Host-karaoke-session=/);assert.match(header,/; Secure;/);assert.match(header,/; HttpOnly;/);assert.match(header,/SameSite=Strict/);assert.match(header,/Max-Age=34560000/);assert.doesNotMatch(header,/Domain=/);assert.doesNotMatch(header,new RegExp(token));
  const plaintext=first.cookie.split('=')[1],row=env.DB.db.prepare('SELECT * FROM auth_sessions').get();
  assert.equal(row.token_sha256,await digest(plaintext));assert.notEqual(row.token_sha256,plaintext);assert.ok(!JSON.stringify(first.data).includes(plaintext));
  // Even very old dates are not an expiration policy.
  env.DB.db.prepare("UPDATE auth_sessions SET created_at='1900-01-01T00:00:00.000Z',last_used_at='1900-01-01T00:00:00.000Z'").run();
  assert.equal((await worker.fetch(sessionRequest('/v1/backups','GET',null,{Cookie:first.cookie}),env)).status,200);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:first.cookie,Origin:'','Sec-Fetch-Site':'none'}),env)).status,200);
  for(const headers of [{Origin:'https://other.test.workers.dev'},{'Sec-Fetch-Site':'same-site'},{Cookie:first.cookie+'; '+first.cookie},{Origin:origin}]){
    assert.ok([401,403].includes((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:first.cookie,...headers}),env)).status));
  }
  assert.equal((await worker.fetch(sessionRequest('/v1/backups/'+crypto.randomUUID(),'PUT',{}, {Cookie:first.cookie,Origin:''}),env)).status,403);
  assert.equal((await worker.fetch(sessionRequest('/v1/sessions','POST',{}, {Cookie:first.cookie}),env)).status,401);
  env.DB.db.prepare("UPDATE auth_sessions SET app_id='other-app'").run();
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:first.cookie}),env)).status,401);
});
test('復旧キーでだけ端末管理ができ、個別解除・全解除・再接続・ログアウトが機能する',async()=>{
  const env=await setup(),a=await signIn(env,'スマホ'),b=await signIn(env,'PC');
  const admin={Authorization:'Bearer '+token,Cookie:a.cookie};
  const response=await worker.fetch(sessionRequest('/v1/sessions','POST',{},admin),env);const list=await response.json();
  assert.equal(list.sessions.length,2);assert.equal(list.sessions.find(s=>s.id===a.data.sessionId).current,true);
  assert.ok(list.sessions.every(s=>!('token_sha256' in s)&&!('token' in s)));
  assert.equal((await worker.fetch(sessionRequest('/v1/sessions/revoke','POST',{sessionId:a.data.sessionId},{Cookie:a.cookie}),env)).status,401);
  assert.equal((await worker.fetch(sessionRequest('/v1/sessions/revoke','POST',{sessionId:a.data.sessionId},{...admin,Origin:'https://evil.example'}),env)).status,403);
  assert.equal((await worker.fetch(sessionRequest('/v1/sessions/revoke','POST',{sessionId:b.data.sessionId},admin),env)).status,200);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:b.cookie}),env)).status,401);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:a.cookie}),env)).status,200);
  const rotated=await signIn(env,'スマホ再接続',a.cookie);
  assert.notEqual(rotated.cookie,a.cookie);assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:a.cookie}),env)).status,401);
  const backup=await createBackup({format:'karaoke-performance-log.snapshot',schema_version:1,state:{...state,tags:[]},recovery:null});
  assert.equal((await worker.fetch(sessionRequest('/v1/backups/'+backup.backup_id,'PUT',backup,{Cookie:rotated.cookie}),env)).status,200);
  assert.equal((await worker.fetch(sessionRequest('/v1/backups/'+backup.backup_id,'GET',null,{Cookie:rotated.cookie}),env)).status,200);
  const loggedOut=await worker.fetch(sessionRequest('/v1/session/logout','POST',{}, {Cookie:rotated.cookie}),env);assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:rotated.cookie}),env)).status,401);
  const c=await signIn(env,'タブレット'),d=await signIn(env,'予備');
  assert.equal((await worker.fetch(sessionRequest('/v1/sessions/revoke','POST',{all:true},admin),env)).status,200);
  for(const device of [c,d])assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:device.cookie}),env)).status,401);
  // Revoke affects authentication only; original recovery access + data survive.
  assert.equal((await worker.fetch(request('/v1/backups/'+backup.backup_id),env)).status,200);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM backups').get().n,1);
});
test('再認証中のDB失敗は旧端末通行証を原子的に保持する',async()=>{
  const env=await setup(),old=await signIn(env);env.DB.failBatch=true;
  assert.equal((await worker.fetch(sessionRequest('/v1/session','POST',{deviceName:'再接続'},{Authorization:'Bearer '+token,Cookie:old.cookie}),env)).status,500);
  env.DB.failBatch=false;
  assert.equal((await worker.fetch(sessionRequest('/v1/session','GET',null,{Cookie:old.cookie}),env)).status,200);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
});
