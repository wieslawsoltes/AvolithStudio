import {Solid} from './kernel.js';
export class GeometryJobs {
  constructor(){this.pending=null;this.serial=0;}
  run(op,solids,args={}){
    if(this.pending)return Promise.reject(Error('A geometry operation is already running.'));
    return new Promise((resolve,reject)=>{
      const blobURL=globalThis.AVOLITH_WORKER_SOURCE?URL.createObjectURL(new Blob([globalThis.AVOLITH_WORKER_SOURCE],{type:'text/javascript'})):null;
      const worker=blobURL?new Worker(blobURL):new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
      let timer=setTimeout(()=>this.cancel('The geometry job exceeded 45 seconds. Simplify its inputs.'),45000);
      const finish=()=>{clearTimeout(timer);worker.terminate();if(blobURL)URL.revokeObjectURL(blobURL);this.pending=null;};
      this.pending={worker,reject,finish};worker.onmessage=e=>{finish();if(!e.data.ok)reject(Error(e.data.error));else resolve({solids:e.data.solids.map(Solid.fromJSON),info:e.data.info});};
      worker.onerror=e=>{finish();reject(Error(e.message||'Geometry worker failed.'));};worker.postMessage({id:++this.serial,op,solids:solids.map(s=>s.toJSON()),args});
    });
  }
  cancel(message='Geometry operation canceled.'){if(this.pending){let p=this.pending;p.finish();p.reject(Error(message));}}
}
