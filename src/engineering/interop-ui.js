/** Atomic .3dm import and explicit representation-aware export. All conversion stays in workers. */
import {ExactClient,solidFromExact} from './exact-client.js';
import {Solid,Polygon} from '../core/kernel.js';
import {M} from '../core/math.js';
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
await new Promise(resolve=>{const poll=()=>window.avolith?.engineering?.advanced?resolve():setTimeout(poll,25);poll();});
const app=window.avolith,eng=app.engineering,client=new ExactClient(new URL('./native-3dm-worker.js',import.meta.url)),{modal,field,download,toast}=app.ui;
const oldCancel=eng.cancel;eng.cancel=()=>{oldCancel();client.cancel();};
let report=[];
const current=()=>{const d=app.document,r=d.revision;return ()=>{if(d!==app.document||r!==d.revision)throw Error('Document changed during conversion. No imported geometry was applied.');};};
async function import3dm(file,options={}){
 if(!file||file.size>32*1024*1024)throw Error('Select a .3dm file up to 32 MiB.');
 const check=current(),result=await eng.query('import3dm',{bytes:new Uint8Array(await file.arrayBuffer()),...options},client),pending=[];
 for(const item of result.objects){
  let s;
  if(item.kind==='mesh'){const {positions:p,indices:i}=item.mesh;s=new Solid(Array.from({length:i.length/3},(_,k)=>new Polygon(i.slice(k*3,k*3+3).map(n=>p.slice(n*3,n*3+3)))),{type:'imported3dmMesh'});}
  else{const p=await eng.query(item.kind==='surface'?'nurbs':'from3dmBrep',item.kind==='surface'?item.surface:{brep:item.brep});p.native3dm=item.native3dm;p.native3dmPose=M.identity();s=solidFromExact(p);}
  pending.push({s,name:item.name});
 }
 check();const ids=[];app.document.transact('Import native .3dm',()=>{for(const p of pending)ids.push(app.document.add(p.s,p.name,'aluminum',app.document.components[0]?.id||'parts').id);});
 report=result.unsupported;app.setSelection(ids);app.renderer.camera.fit(app.document.bounds());app.renderer.request();toast(`Imported ${ids.length} native objects. ${report.length} explicitly skipped.`);return ids;
}
async function export3dm(){
 const bs=app.ui.selectedBodies().length?app.ui.selectedBodies():app.document.visible();if(!bs.length)throw Error('Select or create geometry first.');
 const objects=bs.map(b=>{const e=b.solid.meta.exact;
  if(e?.native3dm)return{name:b.name,native3dm:e.native3dm,pose:M.mul(e.pose,e.native3dmPose||M.identity())};
  if(e?.surfaceDefinition&&!e.surfaceDefinition.uPeriodic&&!e.surfaceDefinition.vPeriodic)return{name:b.name,surface:e.surfaceDefinition,pose:M.mul(e.pose,e.surfacePose||M.identity())};
  const positions=[],indices=[];for(const t of b.solid.triangles()){for(const v of t.vertices){indices.push(positions.length/3);positions.push(...v);}}return{name:b.name,mesh:{positions,indices}};
 });
 const out=await eng.query('export3dm',{objects},client);report=out.report;download(out.bytes,app.document.name+'.3dm','application/octet-stream');return out;
}
const actions={
 'native3dm-import':()=>{const i=document.createElement('input');i.type='file';i.accept='.3dm';i.onchange=()=>import3dm(i.files[0]).catch(e=>toast(e.message,true));i.click();},
 'native3dm-export':()=>modal('Export native .3dm',`<div class="note">Retained .3dm objects and untrimmed NURBS patches export analytically. Other edited bodies export as explicitly labeled display meshes. Use STEP to preserve arbitrary edited B-rep solids. This command does not pretend a triangle mesh is an analytic solid.</div>`+field('ack','I accept this representation policy',false,{type:'checkbox',inline:true}),async d=>{if(!d.has('ack'))throw Error('Confirm the representation policy before exporting.');await export3dm();},'Export',true),
 'native3dm-report':()=>modal('Native exchange report',`<pre class="engineering-report">${esc(JSON.stringify(report,null,2))}</pre>`,null,'Close',true)
};
const oldImport=eng.importFile,oldSupport=eng.supportsFile;eng.supportsFile=name=>/\.3dm$/i.test(name)||oldSupport(name);eng.importFile=file=>/\.3dm$/i.test(file?.name)?import3dm(file):oldImport(file);
const input=document.querySelector('#file-input');if(input)input.accept+=',.3dm';
app.registerCommands({'native3dm-import':['Import 3dm','import','Strict native NURBS, trimmed B-rep and mesh import'],'native3dm-export':['Export 3dm','export','Native geometry or explicitly labeled mesh export'],'native3dm-report':['Exchange report','diagnose','View converted representations and skipped objects']},{Exchange:[['Native objects',['native3dm-import','native3dm-export','native3dm-report'].map(id=>({id,size:'large'}))]]},actions);
Object.assign(eng.actions,actions);eng.native3dm={client,importFile:import3dm,exportFile:export3dm,get report(){return report;}};
