import {V,finiteNumber} from './math.js';
/** Damped nonlinear least squares for explicit 2D point constraints. No hidden constraint inference. */
export class Sketch {
  constructor(points=[],closed=true,plane='XY',origin=0){this.points=points.map(p=>p.slice());this.closed=closed;this.plane=plane;this.origin=origin;this.constraints=[];}
  add(type,a,b,value){this.constraints.push({type,a,b,value});return this;}
  residuals(x){
    const p=i=>{if(!Number.isInteger(i)||i<0||i>=x.length/2)throw Error('Constraint point index is out of range.');return [x[2*i],x[2*i+1]];};
    const edge=i=>V.sub(p((i+1)%(x.length/2)),p(i));let r=[];
    for(const c of this.constraints){const a=p(c.a),b=p(c.b??((c.a+1)%(x.length/2)));switch(c.type){
      case 'horizontal':r.push(b[1]-a[1]);break;
      case 'vertical':r.push(b[0]-a[0]);break;
      case 'distance':r.push(V.dist(a,b)-finiteNumber(c.value,'Distance',0,1e6));break;
      case 'coincident':r.push(a[0]-b[0],a[1]-b[1]);break;
      case 'fixed':r.push(a[0]-c.value[0],a[1]-c.value[1]);break;
      case 'parallel':{let u=V.norm(edge(c.a)),v=V.norm(edge(c.b));r.push(10*(u[0]*v[1]-u[1]*v[0]));break;}
      case 'perpendicular':r.push(10*V.dot(V.norm(edge(c.a)),V.norm(edge(c.b))));break;
      case 'equal':r.push(V.len(edge(c.a))-V.len(edge(c.b)));break;
      case 'angle':{let u=V.norm(edge(c.a)),v=V.norm(edge(c.b));r.push(10*(V.dot(u,v)-Math.cos(c.value*Math.PI/180)));break;}
      default:throw Error(`Unsupported constraint: ${c.type}`);
    }}return r;
  }
  solve({iterations=100,tolerance=1e-6}={}){
    let x=this.points.flat(),lambda=.001,steps=0;
    if(x.length>512)throw Error('Constraint solve is limited to 256 sketch points.');
    const norm=r=>Math.sqrt(r.reduce((s,v)=>s+v*v,0));let r=this.residuals(x),error=norm(r),n=x.length;
    for(;steps<iterations&&error>tolerance;steps++){
      const J=Array.from({length:r.length},()=>Array(n).fill(0));for(let j=0;j<n;j++){let h=1e-5*Math.max(1,Math.abs(x[j])),xx=x.slice();xx[j]+=h;let rr=this.residuals(xx);for(let i=0;i<r.length;i++)J[i][j]=(rr[i]-r[i])/h;}
      let A=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
      for(let i=0;i<n;i++){for(let j=0;j<=i;j++){let v=0;for(let k=0;k<r.length;k++)v+=J[k][i]*J[k][j];A[i][j]=A[j][i]=v;}A[i][i]+=lambda;for(let k=0;k<r.length;k++)b[i]-=J[k][i]*r[k];}
      let dx=solveSPD(A,b),xx=x.map((v,i)=>v+dx[i]),rr=this.residuals(xx),ee=norm(rr);
      if(ee<error){x=xx;r=rr;error=ee;lambda=Math.max(1e-10,lambda/3);}else lambda=Math.min(1e9,lambda*10);
    }
    const converged=error<=tolerance;if(converged)this.points=Array.from({length:x.length/2},(_,i)=>x.slice(i*2,i*2+2));
    return {converged,error,iterations:steps,variables:x.length,equations:r.length,points:Array.from({length:x.length/2},(_,i)=>x.slice(i*2,i*2+2))};
  }
  worldPoint(p){return this.plane==='XY'?[p[0],p[1],this.origin]:this.plane==='XZ'?[p[0],this.origin,p[1]]:[this.origin,p[0],p[1]];}
}
function solveSPD(A,b){
  let n=b.length,L=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(1e-16,s)):s/L[j][j];}
  let y=Array(n).fill(0),x=y.slice();for(let i=0;i<n;i++){let s=b[i];for(let j=0;j<i;j++)s-=L[i][j]*y[j];y[i]=s/L[i][i];}for(let i=n-1;i>=0;i--){let s=y[i];for(let j=i+1;j<n;j++)s-=L[j][i]*x[j];x[i]=s/L[i][i];}return x;
}
export function snapPoint(p,step=5,existing=[],tolerance=1){
  for(const q of existing)if(V.dist(p,q)<tolerance)return {point:q.slice(),type:'vertex'};
  let q=p.map(v=>Math.round(v/step)*step);return {point:q,type:'grid'};
}
