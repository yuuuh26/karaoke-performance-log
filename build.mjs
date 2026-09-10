import {build} from 'esbuild';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['app/main.tsx'],bundle:true,minify:true,sourcemap:false,outdir:'dist/assets',entryNames:'app',assetNames:'[name]',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'});
await cp('public','dist',{recursive:true});
await cp('index.html','dist/index.html');
await writeFile('dist/.nojekyll','');
