import {V,M,transformedPoint} from '../core/math.js';
import {uid} from '../core/document.js';
const types=new Set(['coincident','distance','parallel','angle','plane','pointPlane','concentric','revolute','slider','fixed']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vector=(v,n)=>{if(!Array.isArray(v)||v.length!==3||!v.every(finite))throw Error(`Invalid ${n}.`);return v;};
const unit=(v,n)=>{v=vector(v,n);if(V.len(v)<1e-8)throw Error(`${n} cannot be zero.`);return V.norm(v);};
const applyDir=(m,v)=>V.norm(M.point(m,v,0).slice(0,3));
const perpendicular=n=>V.norm(V.cross(n,Math.abs(n[2])<.8?[0,0,1]:[0,1,0]));
function rotvec(v){const a=V.len(v);return a>1e-14?M.rotate(V.mul(v,1/a),a):M.identity();}
function alignError(a,b){const c=V.cross(a,b),s=V.len(c),d=Math.max(-1,Math.min(1,V.dot(a,b)));if(s>1e-9)return V.mul(c,Math.atan2(s,d)/s);return d>0?[0,0,0]:V.mul(perpendicular(a),Math.PI);}
function solveLinear(a,b){
  a=a.map((r,i)=>[...r,b[i]]);const n=b.length;
  for(let c=0;c<n;c++){let p=c;for(let i=c+1;i<n;i++)if(Math.abs(a[i][c])>Math.abs(a[p][c]))p=i;if(Math.abs(a[p][c])<1e-18)return null;[a[c],a[p]]=[a[p],a[c]];const q=a[c][c];for(let j=c;j<=n;j++)a[c][j]/=q;for(let i=0;i<n;i++)if(i!==c){const q=a[i][c];for(let j=c;j<=n;j++)a[i][j]-=q*a[c][j];}}
  return a.map(r=>r[n]);
}
function matrixRank(input,tol=1e-7){
  if(!input.length||!input[0].length)return 0;const a=input.map(r=>r.slice()),cols=a[0].length;let row=0;
  const threshold=Math.max(1,...a.flat().map(Math.abs))*tol;
  for(let c=0;c<cols&&row<a.length;c++){let p=row;for(let i=row+1;i<a.length;i++)if(Math.abs(a[i][c])>Math.abs(a[p][c]))p=i;if(Math.abs(a[p][c])<threshold)continue;[a[row],a[p]]=[a[p],a[row]];const q=a[row][c];for(let j=c;j<cols;j++)a[row][j]/=q;for(let i=row+1;i<a.length;i++){const q=a[i][c];for(let j=c;j<cols;j++)a[i][j]-=q*a[row][j];}row++;}return row;
}
export function ensureReferenceFrame(body){
  if(!body.solid.meta.referenceKey){body.solid=body.solid.clone();body.solid.meta.referenceKey=uid('geometry');body.solid.meta.referenceFrame=M.translate(body.solid.bounds.center);}
  return body.solid.meta.referenceFrame;
}
export function assemblyReference(body,position=body.solid.bounds.center,axis=[0,0,1],xAxis=null){
  const frame=ensureReferenceFrame(body),inv=M.inverse(frame),n=unit(axis,'Reference axis');
  let x=xAxis?unit(xAxis,'Reference X axis'):perpendicular(n);x=V.norm(V.sub(x,V.mul(n,V.dot(x,n))));if(V.len(x)<.5)throw Error('Reference axes must not be parallel.');
  return {body:body.id,key:body.solid.meta.referenceKey,point:transformedPoint(inv,vector(position,'Anchor')),axis:applyDir(inv,n),xAxis:applyDir(inv,x)};
}
export function validateMate(m,bodyMap){
  if(!m||!types.has(m.type))throw Error('Unsupported assembly mate.');
  if(m.a?.body===m.b?.body)throw Error('A mate needs two different bodies.');
  for(const r of [m.a,m.b]){const body=bodyMap.get(r?.body);if(!body)throw Error('Mate references a missing body.');if(body.solid.meta.referenceKey!==r.key)throw Error(`Mate ${m.name||m.id||''} has a stale geometry reference. Reselect its datums after modeling changes.`);vector(r.point,'Mate point');unit(r.axis,'Mate axis');unit(r.xAxis,'Mate X axis');}
  if(m.value!==undefined&&!finite(m.value))throw Error('Mate value must be finite.');
  if(m.type==='distance'&&(m.value??0)<0)throw Error('Distance cannot be negative.');
  if(m.type==='angle'&&((m.value??0)<0||(m.value??0)>180))throw Error('Mate angle must be between 0 and 180 degrees.');
  return m;
}
/** Damped nonlinear least squares on rigid-body SE(3) increments. Local solver;
 * nonconvergence never applies a partially solved assembly. Distances are mm.
 */
export function solveAssembly(bodies,mates,grounded=[],options={}){
  if(!Array.isArray(mates)||!mates.length||mates.length>100)throw Error('Solve requires 1–100 mates.');
  const map=new Map(bodies.map(b=>[b.id,b]));mates.forEach(m=>validateMate(m,map));
  const used=[...new Set(mates.flatMap(m=>[m.a.body,m.b.body]))],fixed=new Set([...grounded,...bodies.filter(b=>b.locked).map(b=>b.id)]);
  if(used.length>32)throw Error('The interactive solver supports up to 32 bodies per solve.');
  if(!used.some(id=>fixed.has(id)))throw Error('Ground at least one body to remove the assembly’s global rigid motion.');
  const free=used.filter(id=>!fixed.has(id)),bases=new Map(used.map(id=>[id,map.get(id).solid.meta.referenceFrame||M.identity()])),index=new Map(free.map((id,i)=>[id,6*i]));
  const n=free.length*6,tolerance=options.tolerance??1e-5,angularScale=options.angularScale??10,maxIterations=options.maxIterations??80;
  if(!finite(tolerance)||tolerance<=0||tolerance>.1||!finite(angularScale)||angularScale<=0||angularScale>1e6||!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>200)throw Error('Invalid solver settings.');
  function frames(x){const out=new Map();for(const id of used){const base=bases.get(id),j=index.get(id);if(j===undefined){out.set(id,base);continue;}const t=base.slice(12,15).map((p,k)=>p+x[j+k]),rot=base.slice();rot[12]=rot[13]=rot[14]=0;out.set(id,M.mul(M.translate(t),M.mul(rotvec(x.slice(j+3,j+6)),rot)));}return out;}
  function residual(x){
    const f=frames(x),result=[];
    for(const m of mates){
      const a=f.get(m.a.body),b=f.get(m.b.body),pa=transformedPoint(a,m.a.point),pb=transformedPoint(b,m.b.point),delta=V.sub(pa,pb),na=applyDir(a,m.a.axis),nb=V.mul(applyDir(b,m.b.axis),m.flip?-1:1),xa=applyDir(a,m.a.xAxis),xb=applyDir(b,m.b.xAxis),align=V.mul(alignError(na,nb),angularScale);
      const axial=V.dot(delta,nb),radial=V.sub(delta,V.mul(nb,axial));
      switch(m.type){
        case 'coincident':result.push(...delta);break;
        case 'distance':result.push(V.len(delta)-(m.value??0));break;
        case 'parallel':result.push(...align);break;
        case 'angle':result.push((Math.acos(Math.max(-1,Math.min(1,V.dot(na,nb))))-(m.value??0)*Math.PI/180)*angularScale);break;
        case 'plane':result.push(...align,axial-(m.value??0));break;
        case 'pointPlane':result.push(axial-(m.value??0));break;
        case 'concentric':result.push(...align,...radial);break;
        case 'revolute':result.push(...align,...delta);break;
        case 'slider':result.push(...align,...radial,Math.atan2(V.dot(V.cross(xa,xb),nb),V.dot(xa,xb))*angularScale);break;
        case 'fixed':result.push(...align,...delta,Math.atan2(V.dot(V.cross(xa,xb),nb),V.dot(xa,xb))*angularScale);break;
      }
    }
    if(result.some(v=>!Number.isFinite(v)))throw Error('Assembly residual became non-finite.');return result;
  }
  const norm=r=>r.reduce((s,v)=>s+v*v,0),max=r=>r.reduce((s,v)=>Math.max(s,Math.abs(v)),0);
  function jacobian(x,r){const j=r.map(()=>Array(n).fill(0));for(let c=0;c<n;c++){const h=c%6<3?1e-4:1e-5,q=x.slice(),qm=x.slice();q[c]+=h;qm[c]-=h;const y=residual(q),ym=residual(qm);for(let k=0;k<r.length;k++)j[k][c]=(y[k]-ym[k])/(2*h);}return j;}
  let x=Array(n).fill(0),r=residual(x),cost=norm(r),lambda=1e-3,iterations=0;
  for(;iterations<maxIterations&&max(r)>tolerance&&n;iterations++){
    const j=jacobian(x,r),a=Array.from({length:n},()=>Array(n).fill(0)),g=Array(n).fill(0);
    for(let row=0;row<r.length;row++)for(let u=0;u<n;u++){g[u]-=j[row][u]*r[row];for(let v=0;v<=u;v++)a[u][v]+=j[row][u]*j[row][v];}
    for(let u=0;u<n;u++){for(let v=0;v<u;v++)a[v][u]=a[u][v];a[u][u]+=lambda*Math.max(1,a[u][u]);}
    const step=solveLinear(a,g);if(!step)break;
    let ratio=1;for(let c=0;c<n;c++)ratio=Math.min(ratio,(c%6<3?1000:.5)/Math.max(Math.abs(step[c]),1e-15));
    const y=x.map((v,c)=>v+step[c]*ratio),rr=residual(y),cc=norm(rr);
    if(cc<cost){x=y;r=rr;cost=cc;lambda=Math.max(1e-10,lambda*.3);}else lambda=Math.min(1e12,lambda*10);
    if(lambda>=1e12)break;
  }
  const rank=matrixRank(jacobian(x,r)),transforms={};for(const [id,frame]of frames(x))if(index.has(id))transforms[id]=M.mul(frame,M.inverse(bases.get(id)));
  return {converged:max(r)<=tolerance,iterations,maxResidual:max(r),rms:Math.sqrt(cost/Math.max(1,r.length)),degreesOfFreedom:n-rank,rank,variables:n,transforms,tolerance,angularToleranceRadians:tolerance/angularScale};
}
export function applyAssemblySolution(document,result){
  if(!result.converged)throw Error(`Assembly did not converge (residual ${result.maxResidual.toPrecision(4)}). Conflicting or singular mates were not applied.`);
  for(const [id,m]of Object.entries(result.transforms)){const b=document.find(id);if(!b||b.locked)throw Error('A solved body is missing or locked.');b.solid=b.solid.transform(m);}
}
