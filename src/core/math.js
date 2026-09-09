/** Double-precision geometry utilities. Matrices are column-major; camera depth is WebGPU [0,1]. */
export const EPS = 1e-7;
export const V = {
  add: (a,b)=>a.map((v,i)=>v+b[i]), sub:(a,b)=>a.map((v,i)=>v-b[i]),
  mul:(a,s)=>a.map(v=>v*s), dot:(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(...a), norm:a=>{const l=Math.hypot(...a);return l>1e-15?a.map(v=>v/l):a.map(()=>0)},
  lerp:(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t), dist:(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i])),
  min:(a,b)=>a.map((v,i)=>Math.min(v,b[i])), max:(a,b)=>a.map((v,i)=>Math.max(v,b[i]))
};
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function finiteNumber(v,name='value',min=-1e8,max=1e8){
  v=Number(v); if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${name} must be between ${min} and ${max}.`);return v;
}
export function normalOf(vs){
  // Newell's method remains stable for polygons whose first three points are collinear.
  let n=[0,0,0];for(let i=0;i<vs.length;i++){let a=vs[i],b=vs[(i+1)%vs.length];n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);}return V.norm(n);
}
export const M = {
  identity:()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
  mul:(a,b)=>{let o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;},
  point:(m,p,w=1)=>{let a=[...p,w],o=[0,0,0,0];for(let r=0;r<4;r++)for(let c=0;c<4;c++)o[r]+=m[c*4+r]*a[c];return o;},
  translate:p=>[1,0,0,0,0,1,0,0,0,0,1,0,...p,1],
  scale:p=>[p[0],0,0,0,0,p[1],0,0,0,0,p[2],0,0,0,0,1],
  rotate:(axis,a)=>{let [x,y,z]=V.norm(axis),c=Math.cos(a),s=Math.sin(a),t=1-c;return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1];},
  lookAt:(eye,target,up=[0,0,1])=>{let z=V.norm(V.sub(eye,target)),x=V.norm(V.cross(up,z));if(V.len(x)<EPS)x=[1,0,0];let y=V.cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-V.dot(x,eye),-V.dot(y,eye),-V.dot(z,eye),1];},
  ortho:(l,r,b,t,n,f)=>[2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,1/(n-f),0,(l+r)/(l-r),(t+b)/(b-t),n/(n-f),1],
  perspective:(fovy,aspect,n,f)=>{let q=1/Math.tan(fovy/2);return [q/aspect,0,0,0,0,q,0,0,0,0,f/(n-f),-1,0,0,f*n/(n-f),0]},
  inverse:m=>{let a=Array.from({length:4},(_,r)=>[...Array.from({length:4},(_,c)=>m[c*4+r]),...Array.from({length:4},(_,c)=>r===c?1:0)]);for(let c=0;c<4;c++){let p=c;for(let r=c+1;r<4;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;if(Math.abs(a[p][c])<1e-15)throw Error('Singular matrix');[a[p],a[c]]=[a[c],a[p]];let d=a[c][c];a[c]=a[c].map(x=>x/d);for(let r=0;r<4;r++)if(r!==c){let k=a[r][c];a[r]=a[r].map((v,i)=>v-k*a[c][i]);}}return Array.from({length:16},(_,i)=>a[i%4][4+Math.floor(i/4)]);}
};
export function transformedPoint(m,p){const q=M.point(m,p);return q.slice(0,3).map(x=>x/q[3]);}
export function bounds(points){let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points){min=V.min(min,p);max=V.max(max,p);}if(!Number.isFinite(min[0]))min=max=[0,0,0];return {min,max,center:V.mul(V.add(min,max),.5),size:V.sub(max,min)};}
export function mergeBounds(list){return bounds(list.flatMap(b=>[b.min,b.max]));}
export function rayBox(o,d,b,maxT=Infinity){let lo=0,hi=maxT;for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-15){if(o[i]<b.min[i]||o[i]>b.max[i])return false;continue;}let a=(b.min[i]-o[i])/d[i],z=(b.max[i]-o[i])/d[i];if(a>z)[a,z]=[z,a];lo=Math.max(lo,a);hi=Math.min(hi,z);if(hi<lo)return false;}return true;}
export function rayTriangle(o,d,a,b,c){let e1=V.sub(b,a),e2=V.sub(c,a),p=V.cross(d,e2),det=V.dot(e1,p);if(Math.abs(det)<1e-12)return null;let inv=1/det,s=V.sub(o,a),u=V.dot(s,p)*inv;if(u<0||u>1)return null;let q=V.cross(s,e1),v=V.dot(d,q)*inv;if(v<0||u+v>1)return null;let t=V.dot(e2,q)*inv;return t>1e-6?{t,u,v,point:V.add(o,V.mul(d,t))}:null;}
export class BVH {
  constructor(triangles,depth=0){this.bounds=bounds(triangles.flatMap(t=>t.vertices));if(triangles.length<=12||depth>30){this.triangles=triangles;return;}const size=this.bounds.size,axis=size.indexOf(Math.max(...size));triangles.sort((a,b)=>a.vertices.reduce((s,p)=>s+p[axis],0)-b.vertices.reduce((s,p)=>s+p[axis],0));let i=triangles.length>>1;this.left=new BVH(triangles.slice(0,i),depth+1);this.right=new BVH(triangles.slice(i),depth+1);}
  hit(o,d,maxT=Infinity,filter=()=>true){if(!rayBox(o,d,this.bounds,maxT))return null;let hit=null;if(this.triangles){for(const tri of this.triangles){let h=rayTriangle(o,d,...tri.vertices);if(h&&h.t<maxT&&filter(h.point)){maxT=h.t;hit={...h,tri};}}}else{hit=this.left.hit(o,d,maxT,filter);let b=this.right.hit(o,d,hit?.t??maxT,filter);if(b)hit=b;}return hit;}
}
