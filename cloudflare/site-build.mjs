import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const files={'index.html':'text/html;charset=utf-8','update.html':'text/html;charset=utf-8','assets/app.js':'text/javascript;charset=utf-8','assets/app.css':'text/css;charset=utf-8','sw.js':'text/javascript;charset=utf-8','manifest.webmanifest':'application/manifest+json','icon-180.png':'image/png','icon-192.png':'image/png','icon-512.png':'image/png'};
const assets={};for(const [file,type] of Object.entries(files))assets['/'+file]={type,base64:(await readFile('dist/'+file)).toString('base64')};
await build({entryPoints:['cloudflare/site-worker.ts'],bundle:true,format:'esm',platform:'browser',minify:true,outfile:'cloudflare/dist/site-worker.js',plugins:[{name:'site-assets',setup(b){b.onResolve({filter:/^site-assets$/},()=>({path:'site-assets',namespace:'embedded'}));b.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}))}}]});
