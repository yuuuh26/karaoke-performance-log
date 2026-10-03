import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import {createElement,useState,act} from 'react';
await build({entryPoints:['app/cloud-backups.tsx','lib/local-store.ts'],bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react-dom','react-dom/client'],outdir:'.test-layout',outbase:'.'});
const CloudBackups=(await import('../.test-layout/app/cloud-backups.js')).default;
const store=await import('../.test-layout/lib/local-store.js');
test('送信成功でボタンが下段へ移り、入力した管理キーと設定を保持して、日付変更で上段へ戻る',async()=>{
  const dom=new JSDOM('<div id="top"></div><div id="form">記録フォーム</div><div id="bottom"></div><details id="settings"><summary>設定・データ管理</summary></details>',{url:'https://karaoke-performance-log-backups.dengana-10011212.workers.dev/'});
  const original={window:globalThis.window,document:globalThis.document,location:globalThis.location,fetch:globalThis.fetch,Date:globalThis.Date,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  let clock=original.Date.parse('2026-10-03T00:00:00.000Z'),savedBackup,savedState,root;const key='test-management-key'.padEnd(43,'x');
  const doc=dom.window.document,top=doc.getElementById('top'),bottom=doc.getElementById('bottom');
  try{
    globalThis.window=dom.window;globalThis.document=doc;globalThis.location=dom.window.location;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    globalThis.Date=class extends original.Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
    globalThis.fetch=async(url,init={})=>{
      if(url.endsWith('/v1/session'))return new Response(JSON.stringify({connected:true,deviceName:'テスト端末'}));
      if(url.endsWith('/v1/backups'))return new Response(JSON.stringify({backups:[],next_cursor:null}));
      if(init.method==='PUT'){savedBackup=JSON.parse(init.body);return new Response('{}')}
      return new Response(JSON.stringify(savedBackup));
    };
    const initial=await store.initializeLocal();
    function Harness(){const [local,setLocal]=useState(initial);return createElement(CloudBackups,{local,topTarget:top,disabled:false,onSaved:s=>{savedState=s;setLocal(s)},onRestored:setLocal})}
    const {createRoot}=await import('react-dom/client');root=createRoot(bottom);
    await act(async()=>{root.render(createElement(Harness));await new Promise(r=>setTimeout(r,30))});
    assert.equal(top.querySelectorAll('.cloudSendButton').length,1);assert.equal(bottom.querySelectorAll('.cloudQuick').length,0);
    const details=bottom.querySelector('details.cloudSettings');details.open=true;
    // React's input tracking requires the native setter for synthetic events.
    const password=bottom.querySelector('input[type="password"]');
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(password,key);password.dispatchEvent(new dom.window.Event('input',{bubbles:true}))});
    const send=top.querySelector('.cloudSendButton');assert.ok(!send.disabled);
    await act(async()=>{send.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));for(let i=0;i<100&&!savedState;i++)await new Promise(r=>setTimeout(r,5));await new Promise(r=>setTimeout(r,10))});
    assert.ok(savedState,'full upload and local success marking completed');
    assert.equal(top.querySelectorAll('.cloudQuick').length,0);assert.equal(bottom.querySelectorAll('.cloudQuickBottom').length,1);
    assert.ok(details.open);assert.equal(bottom.querySelector('input[type="password"]').value,key);assert.match(bottom.textContent,/ログイン保持中/);assert.match(bottom.textContent,/送信が完了/);
    assert.equal(doc.getElementById('settings').previousElementSibling,bottom);
    clock=original.Date.parse('2026-10-03T15:00:00.000Z');
    await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'))});
    assert.equal(top.querySelectorAll('.cloudQuickTop').length,1);assert.equal(bottom.querySelectorAll('.cloudQuick').length,0);assert.ok(details.open);
    assert.equal(bottom.querySelector('input[type="password"]').value,key);
    assert.equal((await store.readLocal()).cloudBackup.sentAt,savedState.cloudBackup.sentAt);
  }finally{
    if(root)await act(async()=>root.unmount());dom.window.close();
    for(const [name,value] of Object.entries({window:original.window,document:original.document,location:original.location,fetch:original.fetch,Date:original.Date,IS_REACT_ACT_ENVIRONMENT:original.act})){if(value===undefined)delete globalThis[name];else globalThis[name]=value}
  }
});
