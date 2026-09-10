const CACHE='yuu-karaoke-performance-log-v1';
const BASE=new URL('./',self.location.href);
const ASSETS=['./','./index.html','./assets/app.js','./assets/app.css','./icon-192.png','./icon-512.png','./icon-180.png','./manifest.webmanifest'].map(p=>new URL(p,BASE).href);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yuu-karaoke-performance-log-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!ASSETS.includes(e.request.url))return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
