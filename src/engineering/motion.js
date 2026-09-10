/** Quasi-static joint studies. Frames are solved on clones; source geometry is never mutated. */
import {M} from '../core/math.js';
import {Solid} from '../core/kernel.js';
import {solveAssembly,applyAssemblySolution} from './assembly.js';
export function motionStudy(bodyData,mates,grounded,{mateId,from=0,to=90,frames=21}={}){
  if(!Number.isInteger(frames)||frames<2||frames>121||![from,to].every(Number.isFinite))throw Error('Motion needs 2–121 frames and finite endpoints.');
  if(!Array.isArray(bodyData)||bodyData.length>32)throw Error('At most 32 bodies per motion study.');
  const bodies=bodyData.map(b=>({...b,solid:b.solid instanceof Solid?b.solid.clone():Solid.fromJSON(b.solid)})),constraints=structuredClone(mates),drive=constraints.find(m=>m.id===mateId);
  if(!drive||!['drivenRevolute','drivenSlider'].includes(drive.type))throw Error('Choose a driven revolute or slider mate.');
  const doc={find:id=>bodies.find(b=>b.id===id)},transforms=Object.fromEntries(bodies.map(b=>[b.id,M.identity()])),output=[];
  for(let i=0;i<frames;i++){
    drive.value=from+(to-from)*i/(frames-1);const r=solveAssembly(bodies,constraints,grounded,{maxIterations:120});
    if(!r.converged)throw Error(`Motion frame ${i+1} failed (residual ${r.maxResidual}). No source changes were applied.`);
    applyAssemblySolution(doc,r);for(const [id,m]of Object.entries(r.transforms))transforms[id]=M.mul(m,transforms[id]);
    output.push({index:i,value:drive.value,transforms:structuredClone(transforms),maxResidual:r.maxResidual,degreesOfFreedom:r.degreesOfFreedom});
  }
  return {version:1,mateId,type:drive.type,from,to,frames:output,notice:'Quasi-static constraint continuation. No inertia, dynamics, collision avoidance or multi-turn unwrapping.'};
}
