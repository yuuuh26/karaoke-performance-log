import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('PWA更新は最新ファイルを取得し、クラウドAPIとIndexedDBを変更しない',async()=>{
  const listeners={},deleted=[],requested=[];
  let claimed=false;
  const scope='https://yuuuh26.github.io/karaoke-performance-log/';
  const context={URL,Request,self:{location:{href:scope+'sw.js'},clients:{claim(){claimed=true}},addEventListener(name,fn){listeners[name]=fn}},
    caches:{open:async()=>({addAll:async requests=>requested.push(...requests)}),keys:async()=>['yuu-karaoke-performance-log-v2','yuu-karaoke-performance-log-v3','yuu-karaoke-performance-log-v4','other-app'],delete:async key=>{deleted.push(key)},match:async()=>new Response('offline cached asset')},
    indexedDB:{deleteDatabase(){throw Error('IndexedDB must never be reset')}},fetch(){throw Error('Offline network')}};
  vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
  const wait=fn=>{let task;fn({waitUntil(promise){task=promise}});return task};
  await wait(listeners.install);assert.equal(requested.length,8);assert.ok(requested.every(r=>r.cache==='reload'));assert.ok(requested.every(r=>r.url.startsWith(scope)));
  await wait(listeners.activate);assert.deepEqual(deleted,['yuu-karaoke-performance-log-v2','yuu-karaoke-performance-log-v3']);assert.equal(claimed,true);
  let response;
  listeners.fetch({request:new Request(scope+'assets/app.js'),respondWith(promise){response=promise}});
  assert.equal(await (await response).text(),'offline cached asset');
  for(const request of [new Request('https://karaoke-performance-log-backups.dengana-10011212.workers.dev/v1/backups'),new Request(scope+'v1/backups'),new Request(scope+'assets/app.js',{method:'POST'})]){
    listeners.fetch({request,respondWith(){throw Error('Cloud responses and writes must never be cached')}});
  }
});
