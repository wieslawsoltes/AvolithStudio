import {Solid,boolean,repair,fillOpenings,splitSolid,simplifyVertexClusters,shell} from './kernel.js';
self.onmessage=e=>{
  const {id,op,solids,args={}}=e.data;
  try{
    let ss=solids.map(Solid.fromJSON),result,info={};
    switch(op){
      case 'boolean':result=ss.slice(1).reduce((a,b)=>boolean(a,b,args.operation,args.tolerance||1e-6),ss[0]);break;
      case 'repair':{let r=repair(ss[0],args.tolerance);result=r.solid;info={welded:r.welded,removed:r.removed,inserted:r.inserted,boundary:r.diagnostics.boundary.length,nonmanifold:r.diagnostics.nonmanifold.length};break;}
      case 'fill':{let r=fillOpenings(ss[0]);result=r.solid;info={filled:r.count};break;}
      case 'split':result=splitSolid(ss[0],args.axis,args.position);break;
      case 'reduce':result=simplifyVertexClusters(ss[0],args.cell);break;
      case 'shell':result=shell(ss[0],args.thickness);break;
      default:throw Error(`Unknown worker operation ${op}`);
    }
    self.postMessage({id,ok:true,solids:(Array.isArray(result)?result:[result]).map(s=>s.toJSON()),info});
  }catch(error){self.postMessage({id,ok:false,error:error.message});}
};
