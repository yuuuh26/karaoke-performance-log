import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {createElement,useState,act} from 'react';
await build({entryPoints:['app/cloud-backups.tsx','lib/local-store.ts'],bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react-dom/client'],outdir:'.test-layout',outbase:'.'});
const CloudBackups=(await import('../.test-layout/app/cloud-backups.js')).default;
const store=await import('../.test-layout/lib/local-store.js');
const song={id:1,title:'テストの歌',artist:'歌手',releaseYear:null,sungAt:'2026-10-03T00:00:00.000Z',key:null,score:null,machine:'',posture:'',familiarity:null,tempo:null,throatLoad:null,memo:'',createdAt:'2026-10-03T00:00:00.000Z',tags:[]};
async function settle(until=()=>true){for(let i=0;i<200;i++){await act(async()=>{await new Promise(r=>setTimeout(r,20))});if(until())return}throw Error('Timed out waiting for cloud state')}
async function harness(fn,{hosted=true}={}){
  await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(store.DB_NAME);r.onsuccess=resolve;r.onerror=reject});
  const dom=new JSDOM('<div id="form">記録フォーム</div><details id="settings"><summary>設定・データ管理</summary></details><div id="cloud"></div><footer>署名</footer>',{url:hosted?'https://karaoke-performance-log-backups.dengana-10011212.workers.dev/':'https://yuuuh26.github.io/karaoke-performance-log/'});
  const original={window:globalThis.window,document:globalThis.document,location:globalThis.location,fetch:globalThis.fetch,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT,requestAnimationFrame:globalThis.requestAnimationFrame};
  const doc=dom.window.document,container=doc.getElementById('cloud'),backups=new Map(),puts=[];let online=true,fail=false,unauthorized=false,hold=null,root,setLocal;
  Object.defineProperty(dom.window.navigator,'onLine',{get:()=>online});
  try{
    globalThis.requestAnimationFrame=fn=>fn();dom.window.HTMLElement.prototype.scrollIntoView=()=>{};globalThis.window=dom.window;globalThis.document=doc;globalThis.location=dom.window.location;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    globalThis.fetch=async(url,init={})=>{
      if(url.endsWith('/v1/session'))return new Response(JSON.stringify({connected:true,deviceName:'テスト端末'}));
      if(url.endsWith('/v1/backups'))return new Response(JSON.stringify({backups:[...backups.values()],next_cursor:null}));
      if(init.method==='PUT'){const backup=JSON.parse(init.body);puts.push(backup);if(unauthorized)return new Response('{}',{status:401});if(fail)return new Response('{}',{status:503});backups.set(backup.backup_id,backup);if(hold)await hold;return new Response('{}')}
      return new Response(JSON.stringify(backups.get(url.split('/').at(-1))));
    };
    const {createRoot}=await import('react-dom/client');
    function Harness({initial}){const [local,update]=useState(initial);setLocal=update;return createElement(CloudBackups,{local,disabled:false,onSaved:update,onRestored:update})}
    async function mount(){const initial=await store.readLocal()??await store.initializeLocal();root=createRoot(container);await act(async()=>{root.render(createElement(Harness,{initial}));await new Promise(r=>setTimeout(r,40))})}
    await mount();
    const api={doc,container,puts,backups,dom,
      async save(records){await act(async()=>{const local=await store.readLocal();setLocal(await store.saveRecords({...local,...records},local.revision))})},
      async online(value){online=value;await act(async()=>dom.window.dispatchEvent(new dom.window.Event(value?'online':'offline')))},
      fail(value){fail=value},unauthorized(value){unauthorized=value},hold(value){hold=value},
      async remount(){await act(async()=>root.unmount());await mount()},
      async clickSend(){await act(async()=>container.querySelector('.cloudSendButton').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})))},
    };
    await fn(api);
  }finally{if(root)await act(async()=>root.unmount());dom.window.close();for(const [name,value] of Object.entries(original)){if(value===undefined)delete globalThis[name];else globalThis[name]=value}}
}

test('追加・編集を自動送信し、入力中の再描画や日付変更で重複送信せずボタンを最下段に維持',()=>harness(async({doc,container,puts,save,dom})=>{
  await settle();assert.equal(puts.length,0,'空の初期状態は自動送信しない');
  assert.equal(container.lastElementChild.className,'cloudQuick cloudQuickBottom');assert.equal(doc.getElementById('settings').nextElementSibling,container);
  await save({songs:[song]});await settle(()=>puts.length===1&&container.textContent.includes('未送信の変更：0件'));
  assert.equal(JSON.parse(puts[0].backup_json).state.songs[0].title,song.title);
  await save({songs:[{...song,memo:'編集後のコメント',score:95}]});await settle(()=>puts.length===2&&container.textContent.includes('未送信の変更：0件'));
  assert.equal(JSON.parse(puts[1].backup_json).state.songs[0].memo,'編集後のコメント');assert.equal(JSON.parse(puts[1].backup_json).state.songs[0].score,95);
  await act(async()=>dom.window.dispatchEvent(new dom.window.Event('focus')));await settle();assert.equal(puts.length,2);assert.equal(container.lastElementChild.className,'cloudQuick cloudQuickBottom');
  assert.equal(await store.readPendingUpload(),undefined);
}));

test('オフライン保存と失敗した送信を再起動後に同じIDで再試行し、その後の編集も自動で送信',()=>harness(async({container,puts,save,online,fail,remount})=>{
  await online(false);await save({songs:[song]});await settle();assert.equal(puts.length,0);assert.equal((await store.readLocal()).songs.length,1);
  fail(true);await online(true);await settle(()=>puts.length===1&&container.textContent.includes('自動バックアップは未完了'));
  const pending=await store.readPendingUpload();assert.equal(pending.backup_id,puts[0].backup_id);assert.equal((await store.readLocal()).cloudBackup,undefined);
  await online(false);await save({songs:[{...song,memo:'通信失敗後にも編集'}]});fail(false);await remount();await online(true);
  await settle(()=>puts.length===3&&container.textContent.includes('未送信の変更：0件'));
  assert.equal(puts[1].backup_id,puts[0].backup_id);assert.notEqual(puts[2].backup_id,puts[0].backup_id);assert.equal(JSON.parse(puts[2].backup_json).state.songs[0].memo,'通信失敗後にも編集');
  assert.equal(await store.readPendingUpload(),undefined);
}));

test('送信中の追加編集を失わず続けて送信し、401では自動送信を止めて再接続を案内',()=>harness(async({container,puts,save,hold,unauthorized,online})=>{
  let release;hold(new Promise(r=>release=r));await save({songs:[song]});await settle(()=>puts.length===1);
  await save({songs:[{...song,memo:'送信中に保存した変更'}]});hold(null);release();await settle(()=>puts.length===2&&container.textContent.includes('未送信の変更：0件'));
  assert.equal((await store.readLocal()).songs[0].memo,'送信中に保存した変更');assert.equal(JSON.parse(puts[1].backup_json).state.songs[0].memo,'送信中に保存した変更');
  unauthorized(true);await save({songs:[{...song,memo:'ログイン解除後の変更'}]});await settle(()=>puts.length===3&&container.textContent.includes('再接続が必要'));
  await online(true);await settle();assert.equal(puts.length,3);assert.ok(await store.readPendingUpload());assert.equal((await store.readLocal()).songs[0].memo,'ログイン解除後の変更');
}));

test('GitHub Pagesは未接続時に自動送信せず、手動ボタンから接続設定を開く',()=>harness(async({container,puts,save,clickSend})=>{
  await save({songs:[song]});await settle();assert.equal(puts.length,0);await clickSend();assert.ok(container.querySelector('.cloudSettings').open);assert.match(container.textContent,/復旧キーで接続すると/);
},{hosted:false}));
