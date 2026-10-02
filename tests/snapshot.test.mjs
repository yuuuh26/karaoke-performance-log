import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import 'fake-indexeddb/auto';
await build({entryPoints:['lib/local-store.ts','lib/snapshot.ts','lib/cloud-backup.ts','lib/cloud-restore.ts'],bundle:true,format:'esm',platform:'node',outdir:'.test-snapshots'});
const local=await import('../.test-snapshots/local-store.js');
const snapshot=await import('../.test-snapshots/snapshot.js');
const cloud=await import('../.test-snapshots/cloud-backup.js');
const coordinator=await import('../.test-snapshots/cloud-restore.js');
const sample=id=>({id,title:'大切な記録',artist:'歌手',sungAt:'2026-09-10',createdAt:'2026-09-10T10:00:00Z',key:0,score:93.716,machine:'DAM',familiarity:5,throatLoad:2,releaseYear:2020,tempo:null,memo:'日本語と改行\n絵文字🎤',tags:[],posture:'立位',extra:{original:'保持'}});
test('スナップショットの生成・検証は既存記録と退避データを変更しない',async()=>{
  let s=await local.initializeLocal();
  s=await local.saveRecords({...s,songs:[sample(1)],tags:[{id:2,name:'タグ',extra:'保持'}]},s.revision,'DAM');
  const previous=structuredClone(s);
  s=await local.restoreRecords({records:{songs:[sample(3)],tags:[],machines:s.machines},lastMachine:'JOY'},s.revision);
  const before=await local.readLocal();
  const oldRecovery=await local.recoveryBackup();
  const captured=await local.captureSnapshot();
  assert.deepEqual(captured.state,before);
  assert.deepEqual(captured.recovery,previous);
  const b=await snapshot.createBackup(captured,crypto.randomUUID());
  assert.equal(b.app_id,'karaoke-performance-log');
  assert.equal(b.record_count,1);
  assert.deepEqual(await snapshot.validateBackup(b),captured);
  assert.deepEqual(await local.readLocal(),before);
  assert.deepEqual(await local.recoveryBackup(),oldRecovery);
  const second=await snapshot.createBackup(captured);assert.notEqual(second.backup_id,b.backup_id);
  for(const broken of [{...b,app_id:'other'},{...b,schema_version:2},{...b,record_count:9},{...b,source_revision:0},
    {...b,sha256:'0'.repeat(64)},{...b,backup_json:'{broken'},
    {...b,backup_json:JSON.stringify({...captured,state:{...captured.state,songs:[sample(1),sample(1)]}})},
    {...b,backup_json:JSON.stringify({...captured,state:{...captured.state,revision:-1}})},
    {...b,backup_json:JSON.stringify({...captured,recovery:{}})}]) {
    await assert.rejects(snapshot.validateBackup(broken));
  }
  assert.deepEqual(await local.readLocal(),before);
});
test('意味のある記録だけを数え、出力や並び替え・選択状態は数えない',async()=>{
  let s=await local.readLocal();const first=s.importantChanges??0;
  s=await local.saveRecords({...s,songs:[...s.songs].reverse()},s.revision,'UIの採点機選択');
  assert.equal(s.importantChanges,first);
  s=await local.markExport('json',s.revision);assert.equal(s.importantChanges,first);
  const captured=await local.captureSnapshot(),b=await snapshot.createBackup(captured);
  s=await local.saveRecords({...s,songs:s.songs.map((r,i)=>i===0?{...r,memo:'重要な編集'}:r)},s.revision);
  assert.equal(s.importantChanges,first+1);
  const sentAfter=Date.now();
  s=await local.markCloudBackup({...b,created_at:'2020-01-01T00:00:00.000Z'},captured.state.importantChanges??0);
  assert.ok(Date.parse(s.cloudBackup.sentAt)>=sentAfter,'前回送信日時は古いスナップショット作成日時ではなく、保存確認時刻');
  assert.equal((await local.readLocal()).cloudBackup.sentAt,s.cloudBackup.sentAt,'再起動後も送信日時を保持');
  assert.equal(s.importantChanges-s.cloudBackup.backedUpChanges,1,'出力中の新しい変更を未バックアップとして残す');
});
test('クラウド復元は退避・読み戻しが成功するまで置き換えず、途中の編集も維持する',async()=>{
  const original=globalThis.fetch;
  const connection={url:'https://backup.example.workers.dev',token:'a'.repeat(43)};
  const captured=await local.captureSnapshot();
  const target=await snapshot.createBackup(captured);
  let current=await local.saveRecords({...captured.state,songs:[...captured.state.songs,sample(88)]},captured.state.revision);
  const before=await local.readLocal(),recovery=await local.recoveryBackup();
  try{
    globalThis.fetch=async()=>{throw Error('offline')};
    await assert.rejects(coordinator.restoreFromCloud(connection,target,current.revision));
    assert.deepEqual(await local.readLocal(),before);assert.deepEqual(await local.recoveryBackup(),recovery);
    const saved=new Map();let concurrent=false;
    globalThis.fetch=async(url,init)=>{
      const id=new URL(url).pathname.split('/').at(-1);
      if(init.method==='PUT'){
        saved.set(id,JSON.parse(init.body));
        if(concurrent){const now=await local.readLocal();current=await local.saveRecords({...now,songs:[...now.songs,sample(89)]},now.revision);concurrent=false}
        return Response.json({});
      }
      return Response.json(saved.get(id));
    };
    concurrent=true;
    await assert.rejects(coordinator.restoreFromCloud(connection,target,current.revision));
    assert.deepEqual(await local.readLocal(),current);assert.deepEqual(await local.recoveryBackup(),recovery);
    const result=await coordinator.restoreFromCloud(connection,target,current.revision);
    assert.deepEqual(result.state.songs,captured.state.songs);
    assert.deepEqual(await local.recoveryBackup(),current);
    assert.deepEqual(JSON.parse(saved.get(result.protectedBackupId).backup_json).state,current);
  }finally{globalThis.fetch=original}
});
test('復元は全記録・追加項目・設定を保持し同時更新を拒否する',async()=>{
  const captured=await local.captureSnapshot();
  const first=await local.readLocal();
  const newer=await local.saveRecords({...first,songs:[...first.songs,sample(99)]},first.revision);
  await assert.rejects(local.restoreSnapshot(captured,first.revision));
  assert.deepEqual(await local.readLocal(),newer);
  const restored=await local.restoreSnapshot(captured,newer.revision);
  for(const key of ['songs','tags','machines','lastMachine','peakCount','readMilestone','jsonMilestone'])assert.deepEqual(restored[key],captured.state[key]);
  assert.deepEqual(await local.recoveryBackup(),newer);
  assert.equal(restored.revision,newer.revision+1);
  const before=await local.readLocal();
  await assert.rejects(local.restoreSnapshot({...captured,state:{...captured.state,songs:[sample(1),sample(1)]}},before.revision));
  assert.deepEqual(await local.readLocal(),before);
});
test('通信失敗・認証失敗・保存後の破損を拒否しIndexedDBを維持する',async()=>{
  const original=globalThis.fetch;
  const connection={url:'https://backup.example.workers.dev',token:'a'.repeat(43)};
  const captured=await local.captureSnapshot();
  const backup=await snapshot.createBackup(captured);
  const before=await local.readLocal();
  const recovery=await local.recoveryBackup();
  try{
    globalThis.fetch=async()=>{throw Error('offline')};
    await assert.rejects(cloud.uploadBackup(connection,backup));
    globalThis.fetch=async()=>new Response('{}',{status:401});
    await assert.rejects(cloud.listBackups(connection));
    globalThis.fetch=async(url,init)=>{assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return Response.json(init.method==='PUT'?{}:{...backup,sha256:'0'.repeat(64)})};
    await assert.rejects(cloud.uploadBackup(connection,backup));
    globalThis.fetch=async(url,init)=>Response.json(init.method==='PUT'?{}:backup);
    assert.deepEqual(await cloud.uploadBackup(connection,backup),backup);
    await assert.rejects(cloud.uploadBackup({...connection,url:'https://evil.example'},backup));
    assert.deepEqual(await local.readLocal(),before);
    assert.deepEqual(await local.recoveryBackup(),recovery);
  }finally{globalThis.fetch=original}
});
