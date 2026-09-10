import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),site=path.join(root,'_site');
await fs.access(path.join(root,'vendor/exact/replicad_single.wasm'));await fs.access(path.join(root,'vendor/iges/opencascade.wasm.wasm'));
await fs.rm(site,{recursive:true,force:true});await fs.mkdir(site,{recursive:true});
for(const entry of ['index.html','style.css','engineering.css','src','vendor','examples','docs','LICENSE','README.md','THIRD_PARTY_NOTICES.md'])await fs.cp(path.join(root,entry),path.join(site,entry),{recursive:true});
await fs.copyFile(path.join(root,'dist/Avolith-Studio.html'),path.join(site,'Avolith-Studio-Offline.html'));
await fs.writeFile(path.join(site,'.nojekyll'),'');console.log('Built _site with self-hosted, verified CAD engines.');
