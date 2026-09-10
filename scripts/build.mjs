/** Dependency-free deterministic bundler for this project's statically ordered ES modules. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modules=['core/math','core/kernel','core/sketch','core/document','core/io','core/examples','render/camera','render/shaders','render/renderer','ui/icons','ui/ribbon','ui/drawing','core/jobs','app'];
async function moduleSource(name){return (await fs.readFile(path.join(root,'src',name+'.js'),'utf8')).replace(/^import\s.+?;\s*$/gm,'').replace(/^export\s+(?=(?:class|function|const|let|var)\b)/gm,'');}
const worker=(await Promise.all(['core/math','core/kernel','core/worker'].map(moduleSource))).join('\n');
const code=`// Avolith Studio standalone — original source is in src/.\nglobalThis.AVOLITH_WORKER_SOURCE=${JSON.stringify(worker)};\n`+(await Promise.all(modules.map(moduleSource))).join('\n');
await fs.mkdir(path.join(root,'dist'),{recursive:true});
const check=path.join(root,'dist','syntax-check.mjs');await fs.writeFile(check,code);execFileSync(process.execPath,['--check',check],{stdio:'inherit'});await fs.unlink(check);
let html=await fs.readFile(path.join(root,'index.html'),'utf8'),css=await fs.readFile(path.join(root,'style.css'),'utf8');
html=html.replace(/<link[^>]*href="engineering\.css"[^>]*>/,'').replace(/<script type="module" src="src\/engineering\/(?:ui|workbench)\.js"><\/script>/g,'');
html=html.replace(/<link[^>]*href="style\.css"[^>]*>/,()=>`<style>\n${css}\n</style>`).replace(/<script type="module" src="src\/app\.js"><\/script>/,()=>`<script type="module">\n${code.replace(/<\/script/gi,'<\\/script')}\n</script>`);
if(html.includes('src="src/app.js"')||html.includes('href="style.css"'))throw Error('Build template changed: script or stylesheet was not inlined.');
html=html.replace('DIRECT MODELING <span', 'OFFLINE FACETED EDITION <span');
const output=path.join(root,'dist','Avolith-Studio.html');await fs.writeFile(output,html);console.log(`Built ${path.relative(root,output)} (${Buffer.byteLength(html).toLocaleString()} bytes), including inline geometry worker.`);
