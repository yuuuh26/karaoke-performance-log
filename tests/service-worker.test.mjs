import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('PWA更新は最新ファイルを取得し、クラウドAPIとIndexedDBを変更しない',async()=>{
  const listeners={},deleted=[],requested=[];
  let claimed=false;
  const scope='https://yuuuh26.github.io/karaoke-performance-log/';
  const context={URL,Request,self:{location:{href:scope+'sw.js'},clients:{claim(){claimed=true}},addEventListener(name,fn){listeners[name]=fn}},
    caches:{open:async()=>({addAll:async requests=>requested.push(...requests)}),keys:async()=>['yuu-karaoke-performance-log-v2','yuu-karaoke-performance-log-v3','yuu-karaoke-performance-log-v4','yuu-karaoke-performance-log-v5','yuu-karaoke-performance-log-v6','yuu-karaoke-performance-log-v7','yuu-karaoke-performance-log-v8','other-app'],delete:async key=>{deleted.push(key)},match:async request=>requested.some(r=>r.url===request.url)?new Response('offline cached asset'):undefined},
    indexedDB:{deleteDatabase(){throw Error('IndexedDB must never be reset')}},fetch(){throw Error('Offline network')}};
  vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
  const wait=fn=>{let task;fn({waitUntil(promise){task=promise}});return task};
  await wait(listeners.install);assert.ok(requested.every(r=>r.cache==='reload'));assert.ok(requested.every(r=>r.url.startsWith(scope)));
  await wait(listeners.activate);assert.deepEqual(deleted,['yuu-karaoke-performance-log-v2','yuu-karaoke-performance-log-v3','yuu-karaoke-performance-log-v4','yuu-karaoke-performance-log-v5','yuu-karaoke-performance-log-v6','yuu-karaoke-performance-log-v7']);assert.equal(claimed,true);
  let response;
  listeners.fetch({request:new Request(scope+'assets/app.js'),respondWith(promise){response=promise}});
  assert.equal(await (await response).text(),'offline cached asset');
  const entry=await readFile('index.html','utf8');
  const escape=await readFile('public/update.html','utf8');assert.equal(escape,entry);
  const policy=entry.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const connectSources=policy.match(/connect-src ([^;]+);/)[1].split(' ');
  assert.deepEqual(connectSources,["'self'",'https://karaoke-performance-log-backups.dengana-10011212.workers.dev']);
  const versionedAssets=[...entry.matchAll(/(?:href|src)="(\.\/assets\/[^"\s]+)"/g)].map(m=>new URL(m[1],scope).href);
  assert.equal(versionedAssets.length,2);assert.ok(versionedAssets.every(url=>new URL(url).search));
  for(const url of [...versionedAssets,scope+'update.html']){
    listeners.fetch({request:new Request(url),respondWith(promise){response=promise}});
    assert.equal(await (await response).text(),'offline cached asset');
  }
  for(const request of [new Request('https://karaoke-performance-log-backups.dengana-10011212.workers.dev/v1/backups'),new Request(scope+'v1/backups'),new Request(scope+'assets/app.js',{method:'POST'})]){
    listeners.fetch({request,respondWith(){throw Error('Cloud responses and writes must never be cached')}});
  }
});
