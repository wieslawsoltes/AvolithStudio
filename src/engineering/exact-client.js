import {Solid,Polygon} from '../core/kernel.js';
import {M} from '../core/math.js';

/** Stateless requests + worker restart make cancellation atomic and release native allocations. */
export class ExactClient extends EventTarget{
  constructor(workerURL=new URL('./exact-worker.js',import.meta.url)){super();this.workerURL=workerURL;this.worker=null;this.pending=new Map();this.nextId=0;this.ready=false;}
  start(){
    if(this.worker)return;
    if(typeof Worker==='undefined')throw Error('This browser does not support module workers.');
    this.worker=new Worker(this.workerURL,{type:'module',name:'Avolith exact kernel'});
    this.worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);if(data.error)p.reject(Error(data.error.message));else{this.ready=true;p.resolve(data.result);}this.dispatchEvent(new Event('change'));};
    this.worker.onerror=e=>{e.preventDefault();this.cancel('The exact-kernel worker could not start or stopped unexpectedly. Check that vendor assets are installed and use HTTP(S), not file://.');};
    this.worker.onmessageerror=()=>this.cancel('The worker returned an unreadable message.');
  }
  get busy(){return this.pending.size>0;}
  run(command,args={},timeout=120000){
    if(this.pending.size>3)return Promise.reject(Error('Too many exact operations queued. Complete or cancel the current operation.'));
    this.start();const id=++this.nextId;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.cancel('The exact operation exceeded its time budget. Simplify the operation and retry.'),timeout);this.pending.set(id,{resolve,reject,timer});try{this.worker.postMessage({id,command,args});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}this.dispatchEvent(new Event('change'));});
  }
  cancel(message='Exact operation cancelled. No pending edit was applied.'){
    this.worker?.terminate();this.worker=null;this.ready=false;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.dispatchEvent(new Event('change'));
  }
  dispose(){this.cancel('Exact kernel disposed.');}
}
export function solidFromExact(packet){
  const {mesh,...exact}=packet;
  if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.triangles)||mesh.triangles.length%3||mesh.triangles.length>600000)throw Error('Invalid or oversized exact tessellation.');
  const ps=[],faceMap=new Int32Array(mesh.triangles.length).fill(-1);
  for(const g of mesh.faceGroups){for(let k=g.start;k<g.start+g.count;k++)faceMap[k]=g.index;}
  for(let k=0;k<mesh.triangles.length;k+=3){const ids=mesh.triangles.slice(k,k+3);if(ids.some(i=>!Number.isInteger(i)||i<0||i*3+2>=mesh.vertices.length))throw Error('Invalid mesh index.');ps.push(new Polygon(ids.map(i=>mesh.vertices.slice(i*3,i*3+3)),`exact-face-${faceMap[k]}`,ids.map(i=>mesh.normals.slice(i*3,i*3+3))));}
  exact.pose=exact.pose||M.identity();
  return new Solid(ps,{type:'exact',exact});
}
export function exactInput(body){
  const e=body?.solid?.meta?.exact||body?.meta?.exact;
  if(!e)throw Error('This operation requires an exact body. Use Precision → Promote or import STEP/IGES. Faceted geometry is not silently treated as analytic CAD.');
  return {brep:e.brep,pose:e.pose,name:body.name,color:body.color};
}
export function exactFaceIndex(state,body){
  if((state.face?.body?.id||state.face?.body)!==body.id)return null;
  const id=state.face.tri?.face??state.face.face;const m=/^exact-face-(\d+)$/.exec(id||'');return m?Number(m[1]):null;
}
