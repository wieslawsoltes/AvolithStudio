/** Reproducible, self-hosted CAD dependencies. No CDN requests at application runtime. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.resolve(process.env.AVOLITH_DEP_CACHE||path.join(root,'.cache/cad'));
const packages=[
 {spec:'rhino3dm@8.32.1',file:'rhino3dm-8.32.1.tgz',sha:'a2c2535b0bc1a5bb7d5bfab12cb80bb12b4e39382ca09a7a845c2ed0fdbaaab0',folder:'rhino',copy:[['rhino3dm.module.js','rhino3dm/rhino3dm.mjs'],['rhino3dm.wasm','rhino3dm/rhino3dm.wasm']]},
 {spec:'replicad@1.1.0',file:'replicad-1.1.0.tgz',sha:'51128e58f49ffa950bee8b8804cc0104d968c9712b0b3e9e04957e8eda75950a',folder:'replicad',copy:[['dist/replicad.js','exact/replicad.js'],['dist/casting-rs4QjB74.js','exact/casting-rs4QjB74.js'],['LICENSE','licenses/replicad-MIT.txt']]},
 {spec:'replicad-opencascadejs@1.1.0',file:'replicad-opencascadejs-1.1.0.tgz',sha:'be73ff9e1bd95f021d01d50dcfe85094e6c6d1ad876283694bbca2ef00f446d9',folder:'occ',copy:[['dist/replicad_single.js','exact/replicad_single.js'],['dist/replicad_single.wasm','exact/replicad_single.wasm'],['LICENSE','licenses/replicad-opencascadejs-LGPL.txt']]},
 {spec:'opencascade.js@1.1.1',file:'opencascade.js-1.1.1.tgz',sha:'2731aeb6c07c120f21733640155225f5802f1475cdd135d94f2cb41db3cfb587',folder:'iges',copy:[['dist/opencascade.wasm.js','iges/opencascade.wasm.js'],['dist/opencascade.wasm.wasm','iges/opencascade.wasm.wasm'],['LICENSE','licenses/opencascade.js-LGPL.txt']]}
];
function exec(command,args,cwd){const p=spawnSync(command,args,{cwd,stdio:'inherit'});if(p.status!==0)throw Error(`${command} failed with code ${p.status}: ${p.error||''}`);}
await fs.mkdir(cache,{recursive:true});
for(const p of packages){
 const archive=path.join(cache,p.file);
 try{await fs.access(archive);}catch{exec(process.platform==='win32'?'npm.cmd':'npm',['pack',p.spec,'--ignore-scripts'],cache);}
 const hash=createHash('sha256').update(await fs.readFile(archive)).digest('hex');if(hash!==p.sha)throw Error('Dependency checksum mismatch: '+p.file);
 const extracted=path.join(cache,p.folder);await fs.mkdir(extracted,{recursive:true});exec('tar',['-xzf',archive,'-C',extracted],root);
 for(const [from,to] of p.copy){const out=path.join(root,'vendor',to);await fs.mkdir(path.dirname(out),{recursive:true});await fs.copyFile(path.join(extracted,'package',from),out);}
 console.log(`Verified and installed ${p.spec}`);
}
await fs.copyFile(path.join(root,'licenses/rhino3dm-LICENSE.txt'),path.join(root,'vendor/licenses/rhino3dm-MIT.txt'));
await fs.writeFile(path.join(root,'vendor/manifest.json'),JSON.stringify({packages:packages.map(({spec,sha})=>({spec,sha256:sha})),builtAt:new Date().toISOString()},null,2));
