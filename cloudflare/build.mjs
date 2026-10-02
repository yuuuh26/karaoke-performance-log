import {build} from 'esbuild';
await build({entryPoints:['cloudflare/worker.ts'],bundle:true,format:'esm',platform:'browser',outfile:'cloudflare/dist/worker.js'});
