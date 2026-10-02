import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['cloudflare/worker.ts','lib/snapshot.ts'],bundle:true,format:'esm',platform:'node',outdir:'.test-worker',outbase:'.'});
const worker=(await import('../.test-worker/cloudflare/worker.js')).default;
const {createBackup,digest}=await import('../.test-worker/lib/snapshot.js');
const migration=await readFile('cloudflare/migrations/0001_backups.sql','utf8');
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
