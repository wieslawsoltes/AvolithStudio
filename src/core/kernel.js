import {V,M,EPS,normalOf,bounds,transformedPoint,finiteNumber,clamp,BVH} from './math.js';
/**
 * Avolith faceted solid kernel. Coordinates remain float64 until GPU upload.
 * A face is an oriented planar polygon; curved surfaces are tessellated, NOT analytic B-reps.
 * Boolean tolerance is configurable. Operations never silently return the input on failure.
 */
export const KERNEL_VERSION='0.1.0';
let sequence=0;
const tag=()=>`f${++sequence}`;
export class Polygon {
  constructor(vertices,id=tag(),normals=null){
    this.vertices=vertices.map(p=>p.slice());this.id=id;this.normals=normals?.map(n=>V.norm(n))||null;
    this.normal=normalOf(this.vertices);this.w=V.dot(this.normal,this.vertices[0]||[0,0,0]);
  }
  clone(){return new Polygon(this.vertices,this.id,this.normals);}
  flip(){this.vertices.reverse();if(this.normals)this.normals.reverse().forEach((n,i)=>this.normals[i]=V.mul(n,-1));this.normal=V.mul(this.normal,-1);this.w=-this.w;return this;}
  get valid(){return this.vertices.length>=3&&V.len(this.normal)>.5;}
}
export class Solid {
  constructor(polygons=[],meta={}){this.polygons=polygons.filter(p=>p.valid);this.meta=structuredClone(meta);this.revision=0;}
  clone(){return new Solid(this.polygons.map(p=>p.clone()),this.meta);}
  get bounds(){return this._bounds??=bounds(this.polygons.flatMap(p=>p.vertices));}
  transform(matrix){
    const a=matrix,det=a[0]*(a[5]*a[10]-a[6]*a[9])-a[4]*(a[1]*a[10]-a[2]*a[9])+a[8]*(a[1]*a[6]-a[2]*a[5]);
    if(Math.abs(det)<1e-12)throw Error('A transform must not collapse a solid.');
    const inv=M.inverse(matrix),cols=[matrix.slice(0,3),matrix.slice(4,7),matrix.slice(8,11)],lens=cols.map(V.len),scale=Math.max(...lens);
    const similarity=scale>1e-10&&Math.min(...lens)>scale*(1-1e-7)&&cols.every((x,i)=>cols.every((y,j)=>i===j||Math.abs(V.dot(x,y))<scale*scale*1e-7));
    const meta={};
    if(this.meta.exact){if(!similarity)throw Error('Nonuniform scaling/shear of exact bodies is not supported. Explicitly convert to facets before applying this transform.');meta.exact={...this.meta.exact,pose:M.mul(matrix,this.meta.exact.pose||M.identity())};meta.type='exact';}
    if(this.meta.referenceKey&&similarity){meta.referenceKey=this.meta.referenceKey;meta.referenceFrame=M.mul(matrix,this.meta.referenceFrame||M.identity());}
    return new Solid(this.polygons.map(p=>{let v=p.vertices.map(x=>transformedPoint(matrix,x)),ns=p.normals?.map(n=>V.norm([inv[0]*n[0]+inv[1]*n[1]+inv[2]*n[2],inv[4]*n[0]+inv[5]*n[1]+inv[6]*n[2],inv[8]*n[0]+inv[9]*n[1]+inv[10]*n[2]]));if(det<0){v.reverse();ns?.reverse();}return new Polygon(v,p.id,ns);}),meta);
  }
  translate(p){const s=this.transform(M.translate(p));s.meta={...this.meta,...s.meta};if(s.meta.center)s.meta.center=V.add(s.meta.center,p);return s;}
  triangles(){
    if(this._triangles)return this._triangles;
    let out=[];for(const p of this.polygons){const ids=triangulate3D(p.vertices,p.normal);for(const [a,b,c] of ids){const vertices=[p.vertices[a],p.vertices[b],p.vertices[c]];if(V.len(V.cross(V.sub(vertices[1],vertices[0]),V.sub(vertices[2],vertices[0])))>1e-12)out.push({vertices,normal:p.normal,normals:p.normals?[p.normals[a],p.normals[b],p.normals[c]]:undefined,face:p.id});}}
    this._triangles=out;return out;
  }
  bvh(){return this._bvh??=new BVH(this.triangles().slice());}
  toJSON(){return {polygons:this.polygons.map(p=>({v:p.vertices,id:p.id,...(p.normals?{n:p.normals}:{})})),meta:this.meta};}
  static fromJSON(data){
    if(!data||!Array.isArray(data.polygons)||data.polygons.length>200000)throw Error('Invalid or oversized solid.');
    let count=0;const ps=data.polygons.map(p=>{if(!p||!Array.isArray(p.v)||p.v.length<3||p.v.length>10000||(count+=p.v.length)>1800000)throw Error('Invalid polygon.');return new Polygon(p.v.map(v=>{if(!Array.isArray(v)||v.length!==3||v.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e8))throw Error('Invalid vertex.');return v;}),String(p.id??tag()).slice(0,100),p.n?(Array.isArray(p.n)&&p.n.length===p.v.length&&p.n.every(n=>Array.isArray(n)&&n.length===3&&n.every(Number.isFinite))?p.n:(()=>{throw Error('Invalid surface normals.');})()):null);});
    if(data.meta?.exact){const e=data.meta.exact;if(typeof e.brep!=='string'||e.brep.length>33554432||!e.brep.includes('CASCADE Topology')||!Array.isArray(e.pose)||e.pose.length!==16||!e.pose.every(Number.isFinite)||!Array.isArray(e.edgeLines)||e.edgeLines.length>3000000||!e.edgeLines.every(Number.isFinite))throw Error('Invalid exact body data.');}
    return new Solid(ps,typeof data.meta==='object'&&data.meta!==null?data.meta:{});
  }
}
export function triangulate2D(points){
  if(points.length<3)return [];
  let area=0;for(let i=0;i<points.length;i++){let a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-b[0]*a[1];}
  const sign=area>=0?1:-1,cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  let indices=points.map((_,i)=>i),tris=[],guard=0;
  while(indices.length>3&&guard++<points.length*points.length){let found=false;for(let k=0;k<indices.length;k++){
    const a=indices[(k+indices.length-1)%indices.length],b=indices[k],c=indices[(k+1)%indices.length];
    if(cross(points[a],points[b],points[c])*sign<1e-10)continue;
    let inside=false;for(const j of indices){if(j===a||j===b||j===c)continue;const p=points[j];if(cross(points[a],points[b],p)*sign>1e-9&&cross(points[b],points[c],p)*sign>1e-9&&cross(points[c],points[a],p)*sign>1e-9){inside=true;break;}}
    if(!inside){tris.push([a,b,c]);indices.splice(k,1);found=true;break;}
  }if(!found){ // remove collinear vertices; never fill a self-intersecting contour with an arbitrary fan
    const k=indices.findIndex((b,i)=>Math.abs(cross(points[indices[(i+indices.length-1)%indices.length]],points[b],points[indices[(i+1)%indices.length]]))<1e-9);
    if(k>=0)indices.splice(k,1);else throw Error('Profile is self-intersecting or cannot be triangulated.');
  }}
  if(indices.length===3)tris.push(indices.slice());return tris;
}
export function triangulate3D(v,n=normalOf(v)){const axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));const p=v.map(x=>x.filter((_,i)=>i!==axis));return triangulate2D(p);}
export function cleanProfile(points){
  if(!Array.isArray(points)||points.length<3||points.length>4096)throw Error('A closed profile needs 3–4096 vertices.');
  let p=points.map(v=>[finiteNumber(v[0],'X'),finiteNumber(v[1],'Y')]).filter((v,i,a)=>!i||V.dist(v,a[i-1])>EPS);
  if(p.length>2&&V.dist(p[0],p.at(-1))<EPS)p.pop();
  let a=0;for(let i=0;i<p.length;i++)a+=p[i][0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*p[i][1];
  if(Math.abs(a)<EPS)throw Error('The sketch encloses no area.');if(a<0)p.reverse();triangulate2D(p);return p;
}
export function extrude(points,height=20,z=0){
  height=finiteNumber(height,'Height',.001,1e6);z=finiteNumber(z,'Base');let p=cleanProfile(points),lo=p.map(([x,y])=>[x,y,z]),hi=p.map(([x,y])=>[x,y,z+height]);
  let polys=[],bot=tag(),top=tag();for(const t of triangulate2D(p)){polys.push(new Polygon(t.map(i=>lo[i]).reverse(),bot),new Polygon(t.map(i=>hi[i]),top));}
  for(let i=0;i<p.length;i++){let j=(i+1)%p.length;polys.push(new Polygon([lo[i],lo[j],hi[j],hi[i]]));}
  return new Solid(polys,{type:'extrude',profile:p,height,z,center:[0,0,z+height/2]});
}
export function rectangleProfile(w,d,r=0,segments=8){
  w=finiteNumber(w,'Width',.001,1e6);d=finiteNumber(d,'Depth',.001,1e6);r=finiteNumber(r,'Radius',0,Math.min(w,d)/2);
  if(r<EPS)return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  let ps=[];for(let k=0;k<4;k++){let cx=(k===0||k===3?1:-1)*(w/2-r),cy=(k<2?1:-1)*(d/2-r);for(let i=0;i<=segments;i++){let a=k*Math.PI/2+i*Math.PI/2/segments;ps.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}}
  return ps;
}
export function box(w=40,d=30,h=25,center=[0,0,h/2],r=0){
  let s=extrude(rectangleProfile(w,d,r),h,-h/2).translate(center);s.meta={type:'box',w,d,h,r,center:center.slice()};return s;
}
export function cylinder(radius=15,height=30,center=[0,0,height/2],segments=64,r2=radius){
  radius=finiteNumber(radius,'Radius',.001,1e6);r2=finiteNumber(r2,'Top radius',0,1e6);height=finiteNumber(height,'Height',.001,1e6);segments=clamp(Math.round(segments),8,512);
  let lo=[],hi=[],polys=[],side=tag();for(let i=0;i<segments;i++){let a=i*Math.PI*2/segments;lo.push(V.add([radius*Math.cos(a),radius*Math.sin(a),-height/2],center));hi.push(V.add([r2*Math.cos(a),r2*Math.sin(a),height/2],center));}
  polys.push(new Polygon(lo.slice().reverse()));if(r2>EPS)polys.push(new Polygon(hi));for(let i=0;i<segments;i++){let j=(i+1)%segments;polys.push(new Polygon(r2>EPS?[lo[i],lo[j],hi[j],hi[i]]:[lo[i],lo[j],hi[i]],`${side}-${i}`));}
  return new Solid(polys,{type:r2===radius?'cylinder':'cone',radius,r2,height,center:center.slice(),segments});
}
export function sphere(radius=20,center=[0,0,radius],segments=48,rings=24){
  radius=finiteNumber(radius,'Radius',.001,1e6);segments=clamp(Math.round(segments),8,256);rings=clamp(Math.round(rings),4,128);
  const p=(i,j)=>V.add([radius*Math.sin(i*Math.PI/rings)*Math.cos(j*2*Math.PI/segments),radius*Math.sin(i*Math.PI/rings)*Math.sin(j*2*Math.PI/segments),radius*Math.cos(i*Math.PI/rings)],center);let polys=[];
  for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){let vs=i===0?[p(0,j),p(1,j),p(1,j+1)]:i===rings-1?[p(i,j),p(rings,j),p(i,j+1)]:[p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1)];polys.push(new Polygon(vs));}
  return new Solid(polys,{type:'sphere',radius,center});
}
export function torus(major=22,minor=5,center=[0,0,minor],segments=64,sides=20){
  major=finiteNumber(major,'Major radius',.002,1e6);minor=finiteNumber(minor,'Tube radius',.001,major-.0001);let polys=[];
  const p=(i,j)=>{let u=2*Math.PI*i/segments,v=2*Math.PI*j/sides,r=major+minor*Math.cos(v);return V.add([r*Math.cos(u),r*Math.sin(u),minor*Math.sin(v)],center);};
  for(let i=0;i<segments;i++)for(let j=0;j<sides;j++)polys.push(new Polygon([p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1)]));return new Solid(polys,{type:'torus',major,minor,center});
}
export function tube(outer=20,inner=14,height=30,center=[0,0,height/2],segments=64){
  outer=finiteNumber(outer,'Outer radius',.002,1e6);inner=finiteNumber(inner,'Inner radius',.001,outer-.001);let polys=[];
  const p=(r,z,i)=>V.add([r*Math.cos(i*2*Math.PI/segments),r*Math.sin(i*2*Math.PI/segments),z],center);
  const top=tag(),bot=tag();for(let i=0;i<segments;i++){let j=i+1,a=p(outer,-height/2,i),b=p(outer,-height/2,j),c=p(outer,height/2,j),d=p(outer,height/2,i),e=p(inner,-height/2,i),f=p(inner,-height/2,j),g=p(inner,height/2,j),h=p(inner,height/2,i);polys.push(new Polygon([a,b,c,d]),new Polygon([f,e,h,g]),new Polygon([d,c,g,h],top),new Polygon([b,a,e,f],bot));}
  return new Solid(polys,{type:'tube',outer,inner,height,center});
}
class Plane {
  constructor(n,w,eps){this.n=n;this.w=w;this.eps=eps;}
  clone(){return new Plane(this.n.slice(),this.w,this.eps);}
  flip(){this.n=V.mul(this.n,-1);this.w=-this.w;}
  split(p,cf,cb,front,back){
    const COP=0,FRONT=1,BACK=2;let type=0,types=p.vertices.map(v=>{let t=V.dot(this.n,v)-this.w,k=t < -this.eps?BACK:t>this.eps?FRONT:COP;type|=k;return k;});
    if(type===0)(V.dot(this.n,p.normal)>0?cf:cb).push(p);else if(type===1)front.push(p);else if(type===2)back.push(p);else{
      let f=[],b=[];for(let i=0;i<p.vertices.length;i++){let j=(i+1)%p.vertices.length,ti=types[i],tj=types[j],vi=p.vertices[i],vj=p.vertices[j];if(ti!==BACK)f.push(vi);if(ti!==FRONT)b.push(vi);if((ti|tj)===3){let t=(this.w-V.dot(this.n,vi))/V.dot(this.n,V.sub(vj,vi)),v=V.lerp(vi,vj,t);f.push(v);b.push(v);}}
      const clean=vs=>vs.filter((v,i)=>V.dist(v,vs[(i+vs.length-1)%vs.length])>this.eps*.1);
      if(f.length>=3){let q=new Polygon(clean(f),p.id);if(q.valid)front.push(q);}if(b.length>=3){let q=new Polygon(clean(b),p.id);if(q.valid)back.push(q);}
    }
  }
}
class BSP {
  constructor(polys=[],eps=1e-6,depth=0,budget={remaining:400000}){this.polys=[];this.plane=null;this.front=null;this.back=null;this.eps=eps;this.depth=depth;this.budget=budget;if(polys.length)this.build(polys);}
  all(){return [...this.polys,...(this.front?.all()||[]),...(this.back?.all()||[])];}
  invert(){for(const p of this.polys)p.flip();this.plane?.flip();this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
  clipPolys(polys){if(!this.plane)return polys.slice();let f=[],b=[];for(const p of polys)this.plane.split(p,f,b,f,b);if(this.front)f=this.front.clipPolys(f);if(this.back)b=this.back.clipPolys(b);else b=[];return f.concat(b);}
  clipTo(node){this.polys=node.clipPolys(this.polys);this.front?.clipTo(node);this.back?.clipTo(node);}
  build(polys){if(!polys.length)return;if(this.depth>480||(this.budget.remaining-=polys.length)<0)throw Error('Boolean complexity limit reached. Reduce facet density or split the operation.');
    if(!this.plane){ // Sample split planes and favor low spanning counts to avoid quadratic fragmentation.
      let chosen=polys[0],best=Infinity;for(let k=0;k<Math.min(8,polys.length);k++){const p=polys[Math.floor(k*polys.length/Math.min(8,polys.length))];let f=0,b=0,s=0;for(let j=0;j<polys.length;j+=Math.max(1,Math.floor(polys.length/64))){let front=false,back=false;for(const v of polys[j].vertices){let d=V.dot(p.normal,v)-p.w;if(d>this.eps)front=true;if(d<-this.eps)back=true;}if(front&&back)s++;else if(front)f++;else if(back)b++;}let score=s*4+Math.abs(f-b)*.3;if(score<best){best=score;chosen=p;}}this.plane=new Plane(chosen.normal.slice(),chosen.w,this.eps);}
    let f=[],b=[];for(const p of polys)this.plane.split(p,this.polys,this.polys,f,b);if(f.length){this.front??=new BSP([],this.eps,this.depth+1,this.budget);this.front.build(f);}if(b.length){this.back??=new BSP([],this.eps,this.depth+1,this.budget);this.back.build(b);}
  }
}
export function boolean(a,b,op='union',eps=1e-6){
  if(!['union','subtract','intersect'].includes(op))throw Error('Unknown Boolean operation.');
  if(!a.polygons.length)return op==='union'?b.clone():new Solid();if(!b.polygons.length)return op==='intersect'?new Solid():a.clone();
  const relabel=solid=>{const ids=new Map();return new Solid(solid.polygons.map(p=>{if(!ids.has(p.id))ids.set(p.id,tag());return new Polygon(p.vertices,ids.get(p.id));}),solid.meta);};
  a=relabel(a);b=relabel(b);
  const ba=a.bounds,bb=b.bounds;if([0,1,2].some(i=>ba.max[i]<bb.min[i]-eps||bb.max[i]<ba.min[i]-eps))return op==='union'?new Solid([...a.clone().polygons,...b.clone().polygons]):op==='subtract'?a.clone():new Solid();
  // BSP requires convex input polygons. Triangulate only concave faces at API boundary.
  const convex=solid=>solid.polygons.flatMap(p=>{let n=p.normal,sign=true;for(let i=0;i<p.vertices.length;i++){let a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],c=p.vertices[(i+2)%p.vertices.length];if(V.dot(V.cross(V.sub(b,a),V.sub(c,b)),n)<-eps){sign=false;break;}}return sign?[p.clone()]:triangulate3D(p.vertices,n).map(t=>new Polygon(t.map(i=>p.vertices[i]),p.id));});
  let A=new BSP(convex(a),eps),B=new BSP(convex(b),eps);
  if(op==='union'){A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());}
  else if(op==='subtract'){A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());A.invert();}
  else {A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.all());A.invert();}
  const out=new Solid(A.all(),{type:'boolean',operation:op,tolerance:eps});if(out.polygons.length>150000)throw Error('Boolean result exceeds the polygon budget.');return out;
}
export function revolve(profile,angle=360,segments=64){
  const p=cleanProfile(profile);if(p.some(q=>q[0]<0))throw Error('Revolve profile radii must be nonnegative.');
  angle=finiteNumber(angle,'Angle',.01,360);segments=clamp(Math.round(segments),8,256);const steps=Math.max(2,Math.round(segments*angle/360)),closed=angle===360,polys=[];
  const pt=(v,j)=>[v[0]*Math.cos(j*angle*Math.PI/180/steps),v[0]*Math.sin(j*angle*Math.PI/180/steps),v[1]];
  // A CCW radial-Z contour sweeps with reversed side winding.
  for(let j=0;j<steps;j++)for(let i=0;i<p.length;i++){const k=(i+1)%p.length;let vs=[pt(p[i],j),pt(p[i],j+1),pt(p[k],j+1),pt(p[k],j)];vs=vs.filter((v,k)=>V.dist(v,vs[(k+vs.length-1)%vs.length])>EPS);if(vs.length>=3)polys.push(new Polygon(vs));}
  if(!closed){for(const t of triangulate2D(p)){polys.push(new Polygon(t.map(i=>pt(p[i],0))),new Polygon(t.map(i=>pt(p[i],steps)).reverse()));}}
  let s=new Solid(polys,{type:'revolve',angle,profile:p});if(metrics(s).signedVolume<0)s=new Solid(s.polygons.map(p=>p.flip()),s.meta);return s;
}
export function loft(a,b,height=40,offset=[0,0],twist=0){
  a=cleanProfile(a);b=cleanProfile(b);if(a.length!==b.length)throw Error('Loft profiles must have the same vertex count.');
  let c=Math.cos(twist*Math.PI/180),s=Math.sin(twist*Math.PI/180),lo=a.map(([x,y])=>[x,y,0]),hi=b.map(([x,y])=>[x*c-y*s+offset[0],x*s+y*c+offset[1],height]),ps=[];
  for(let i=0;i<a.length;i++){let j=(i+1)%a.length;ps.push(new Polygon([lo[i],lo[j],hi[j]]),new Polygon([lo[i],hi[j],hi[i]]));}
  for(const t of triangulate2D(a))ps.push(new Polygon(t.map(i=>lo[i]).reverse()));for(const t of triangulate2D(b))ps.push(new Polygon(t.map(i=>hi[i])));return new Solid(ps,{type:'loft'});
}
export function sweep(profile,path){
  const p=cleanProfile(profile);if(!Array.isArray(path)||path.length<2||path.length>1024)throw Error('Sweep needs 2–1024 path points.');
  const ring=[],ps=[];let prevN=null;
  for(let i=0;i<path.length;i++){
    let t=V.norm(i===0?V.sub(path[1],path[0]):i===path.length-1?V.sub(path[i],path[i-1]):V.sub(path[i+1],path[i-1]));if(V.len(t)<.5)throw Error('Sweep path contains coincident or reversing segments.');
    let n=prevN?V.norm(V.sub(prevN,V.mul(t,V.dot(prevN,t)))):V.norm(V.cross(Math.abs(t[2])<.9?[0,0,1]:[0,1,0],t));if(V.len(n)<.5)n=V.norm(V.cross([1,0,0],t));let b=V.cross(t,n);prevN=n;
    ring.push(p.map(([x,y])=>V.add(path[i],V.add(V.mul(n,x),V.mul(b,y)))));
  }
  for(let j=0;j<ring.length-1;j++)for(let i=0;i<p.length;i++){let k=(i+1)%p.length;ps.push(new Polygon([ring[j][i],ring[j][k],ring[j+1][k]]),new Polygon([ring[j][i],ring[j+1][k],ring[j+1][i]]));}
  for(const t of triangulate2D(p)){ps.push(new Polygon(t.map(i=>ring[0][i]).reverse()),new Polygon(t.map(i=>ring.at(-1)[i])));}return new Solid(ps,{type:'sweep'});
}
export function pullFace(solid,faceId,distance){
  distance=finiteNumber(distance,'Pull distance',-1e6,1e6);const faces=solid.polygons.filter(p=>p.id===faceId);if(!faces.length)throw Error('Select a planar face to pull.');
  const n=faces[0].normal;if(faces.some(p=>V.dot(p.normal,n)<.99999||Math.abs(p.w-faces[0].w)>1e-5))throw Error('Pull currently supports planar faceted faces only.');
  const key=v=>v.map(x=>Math.round(x*1e6)).join(','),vertices=new Set(faces.flatMap(p=>p.vertices.map(key))),delta=V.mul(n,distance);
  const out=new Solid(solid.polygons.map(p=>new Polygon(p.vertices.map(v=>vertices.has(key(v))?V.add(v,delta):v),p.id)),{type:'direct-edit'});
  if(out.polygons.length<solid.polygons.length||metrics(out).signedVolume<=EPS)throw Error('Pull would collapse or invert the solid.');
  return out;
}
export function shell(solid,thickness=2){
  thickness=finiteNumber(thickness,'Thickness',.001,1e5);const m=solid.meta;
  if(m.type==='box'&&!m.r){if(thickness*2>=Math.min(m.w,m.d)||thickness>=m.h)throw Error('Thickness exceeds the body dimensions.');return boolean(solid,box(m.w-2*thickness,m.d-2*thickness,m.h,V.add(m.center,[0,0,thickness])), 'subtract');}
  if(m.type==='cylinder'){if(thickness>=Math.min(m.radius,m.height))throw Error('Thickness exceeds the body dimensions.');return boolean(solid,cylinder(m.radius-thickness,m.height,V.add(m.center,[0,0,thickness]),m.segments),'subtract');}
  throw Error('Open-top shell supports unrotated, unrounded box and cylinder primitives in this build.');
}
export function splitSolid(solid,axis=2,position=0){
  let b=solid.bounds,size=Math.max(...b.size)*4+10,c=b.center.slice();c[axis]=position+size/2;let dims=[size,size,size],cutter=box(...dims,c);return [boolean(solid,cutter,'subtract'),boolean(solid,cutter,'intersect')];
}
export function clipConvex(solid,normal,w){
  normal=V.norm(normal);let ps=[],cap=[];
  for(const p of solid.polygons){let out=[];for(let i=0;i<p.vertices.length;i++){let a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],da=V.dot(normal,a)-w,db=V.dot(normal,b)-w;if(da<=EPS)out.push(a);if((da< -EPS&&db>EPS)||(da>EPS&&db< -EPS)){let q=V.lerp(a,b,da/(da-db));out.push(q);cap.push(q);}}
    for(const v of out)if(Math.abs(V.dot(normal,v)-w)<=EPS*4)cap.push(v);
    if(out.length>=3){let q=new Polygon(out,p.id);if(q.valid)ps.push(q);}}
  let uniq=[...new Map(cap.map(p=>[p.map(v=>Math.round(v*1e6)).join(','),p])).values()];if(uniq.length>=3){let c=V.mul(uniq.reduce(V.add,[0,0,0]),1/uniq.length),u=V.norm(V.cross(Math.abs(normal[2])<.9?[0,0,1]:[0,1,0],normal)),v=V.cross(normal,u);uniq.sort((a,b)=>Math.atan2(V.dot(V.sub(a,c),v),V.dot(V.sub(a,c),u))-Math.atan2(V.dot(V.sub(b,c),v),V.dot(V.sub(b,c),u)));ps.push(new Polygon(uniq));}
  return new Solid(ps,{type:'chamfer'});
}
export function chamferBox(solid,distance=2){
  const m=solid.meta;if(m.type!=='box'||m.r)throw Error('All-edge chamfer supports unrounded box primitives.');distance=finiteNumber(distance,'Chamfer',.001,Math.min(m.w,m.d,m.h)/2-.0001);let s=solid.clone(),half=[m.w/2,m.d/2,m.h/2];
  for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(const sa of [-1,1])for(const sb of [-1,1]){let n=[0,0,0];n[a]=sa;n[b]=sb;n=V.norm(n);let w=V.dot(n,m.center)+(half[a]+half[b]-distance)/Math.SQRT2;s=clipConvex(s,n,w);}return new Solid(conformingPolygons(s.polygons).polygons,{type:'chamfer'});
}
export function roundCorners(solid,radius=3){
  const m=solid.meta;if(m.type!=='box')throw Error('Round corners supports the vertical corners of box primitives.');return box(m.w,m.d,m.h,m.center,finiteNumber(radius,'Radius',.001,Math.min(m.w,m.d)/2-.001));
}
export function metrics(solid){
  if(solid._metrics)return solid._metrics;
  let signedVolume=0,area=0,centroid=[0,0,0];for(const t of solid.triangles()){let [a,b,c]=t.vertices,vol=V.dot(a,V.cross(b,c))/6;signedVolume+=vol;centroid=V.add(centroid,V.mul(V.add(V.add(a,b),c),vol/4));area+=V.len(V.cross(V.sub(b,a),V.sub(c,a)))/2;}
  centroid=Math.abs(signedVolume)>EPS?V.mul(centroid,1/signedVolume):solid.bounds.center;
  return solid._metrics={volume:Math.abs(signedVolume),signedVolume,area,centroid,bounds:solid.bounds,triangles:solid.triangles().length,faces:new Set(solid.polygons.map(p=>p.id)).size};
}
export function topology(solid,tolerance=1e-5){
  const key=v=>v.map(x=>Math.round(x/tolerance)).join(','),vertices=new Map(),edges=new Map();let degenerate=0;
  for(let pi=0;pi<solid.polygons.length;pi++){const p=solid.polygons[pi];if(!p.valid)degenerate++;for(let i=0;i<p.vertices.length;i++){let a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],ka=key(a),kb=key(b);vertices.set(ka,a);vertices.set(kb,b);if(ka===kb)continue;let k=[ka,kb].sort().join('|');if(!edges.has(k))edges.set(k,{a,b,ka,kb,faces:[]});edges.get(k).faces.push({index:pi,normal:p.normal,forward:ka<kb});}}
  const es=[...edges.values()],boundary=es.filter(e=>e.faces.length===1),nonmanifold=es.filter(e=>e.faces.length>2),inconsistent=es.filter(e=>e.faces.length===2&&e.faces[0].forward===e.faces[1].forward);
  return {vertices,edges:es,boundary,nonmanifold,inconsistent,degenerate,closed:!boundary.length&&!nonmanifold.length&&!inconsistent.length};
}
/** Split polygon edges at existing collinear vertices with axis-sorted candidate queries. */
function conformingPolygons(polygons,tolerance=1e-5,maxChecks=12000000){
  const key=v=>v.map(x=>Math.round(x/tolerance)).join(','),unique=new Map();
  for(const p of polygons)for(const v of p.vertices)unique.set(key(v),v);
  const verts=[...unique.values()],sorted=[0,1,2].map(a=>verts.slice().sort((u,v)=>u[a]-v[a]));let inserted=0,checks=0;
  const lower=(a,x,axis)=>{let l=0,h=a.length;while(l<h){let m=(l+h)>>1;if(a[m][axis]<x)l=m+1;else h=m;}return l;};
  const result=polygons.map(p=>{let out=[];for(let i=0;i<p.vertices.length;i++){
    const a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],d=V.sub(b,a),ll=V.dot(d,d);out.push(a);if(ll<tolerance*tolerance)continue;
    const axis=d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs))),vs=sorted[axis],lo=Math.min(a[axis],b[axis])-tolerance,hi=Math.max(a[axis],b[axis])+tolerance,mid=[];
    for(let j=lower(vs,lo,axis);j<vs.length&&vs[j][axis]<=hi;j++){
      if(++checks>maxChecks)throw Error('Edge normalization complexity limit reached. Reduce the mesh before repairing it.');
      const v=vs[j];if([0,1,2].some(k=>v[k]<Math.min(a[k],b[k])-tolerance||v[k]>Math.max(a[k],b[k])+tolerance))continue;
      const t=V.dot(V.sub(v,a),d)/ll;if(t>1e-7&&t<1-1e-7&&V.dist(V.add(a,V.mul(d,t)),v)<tolerance)mid.push({t,v});
    }
    mid.sort((a,b)=>a.t-b.t);for(const q of mid)if(V.dist(out.at(-1),q.v)>tolerance*.1){out.push(q.v);inserted++;}
  }return new Polygon(out,p.id);});return {polygons:result,inserted};
}
export function featureEdges(solid,angle=25){
  if(solid.meta.exact?.edgeLines){if(!solid._exactEdges){const e=solid.meta.exact,lines=e.edgeLines;solid._exactEdges=[];for(let i=0;i<lines.length;i+=6)solid._exactEdges.push([transformedPoint(e.pose,lines.slice(i,i+3)),transformedPoint(e.pose,lines.slice(i+3,i+6))]);}return solid._exactEdges;}
  solid._featureEdges??=new Map();if(solid._featureEdges.has(angle))return solid._featureEdges.get(angle);
  let top=topology(solid);if(top.boundary.length&&top.vertices.size<12000){try{top=topology(new Solid(conformingPolygons(solid.polygons).polygons));}catch{/* Keep honest boundary edges when the display normalization budget is exceeded. */}}
  const cosine=Math.cos(angle*Math.PI/180),edges=top.edges.filter(e=>e.faces.length!==2||V.dot(e.faces[0].normal,e.faces[1].normal)<cosine).map(e=>[e.a,e.b]);
  solid._featureEdges.set(angle,edges);return edges;
}
export function repair(solid,tolerance=1e-5,splitTJunctions=true){
  tolerance=finiteNumber(tolerance,'Tolerance',1e-9,.1);const buckets=new Map(),key=v=>v.map(x=>Math.round(x/tolerance)).join(',');let welded=0,removed=0,seen=new Set();
  let ps=[];for(const p of solid.polygons){let vs=p.vertices.map(v=>{let k=key(v);if(buckets.has(k)){let q=buckets.get(k);if(V.dist(q,v)>0)welded++;return q;}buckets.set(k,v);return v;}).filter((v,i,a)=>!i||V.dist(v,a[i-1])>tolerance*.1);if(vs.length>2&&V.dist(vs[0],vs.at(-1))<tolerance*.1)vs.pop();let q=new Polygon(vs,p.id),sig=vs.map(key).sort().join('|');if(!q.valid||seen.has(sig)){removed++;continue;}seen.add(sig);ps.push(q);}
  let inserted=0;
  if(splitTJunctions){if(buckets.size>50000)throw Error('Conforming repair is limited to 50,000 vertices. Reduce the mesh first.');const result=conformingPolygons(ps,tolerance,40000000);ps=result.polygons;inserted=result.inserted;}
  let out=new Solid(ps,{type:'repaired'});return {solid:out,welded,removed,inserted,diagnostics:topology(out,tolerance)};
}
export function fillOpenings(solid,tolerance=1e-5){
  const top=topology(solid,tolerance);if(top.nonmanifold.length)throw Error('Repair nonmanifold edges before filling openings.');
  const links=new Map(),key=v=>v.map(x=>Math.round(x/tolerance)).join(',');for(const e of top.boundary){let face=solid.polygons[e.faces[0].index],i=face.vertices.findIndex(v=>key(v)===e.ka),a=face.vertices[i],b=face.vertices[(i+1)%face.vertices.length];links.set(key(b),{a:b,b:a});}
  let ps=solid.polygons.map(p=>p.clone()),count=0;while(links.size){let edge=links.values().next().value,start=key(edge.a),vs=[],cur=start,guard=0;do{let e=links.get(cur);if(!e)throw Error('Boundary is branched or contains a gap.');vs.push(e.a);links.delete(cur);cur=key(e.b);}while(cur!==start&&guard++<top.boundary.length+1);
    if(vs.length<3)continue;let n=normalOf(vs),w=V.dot(n,vs[0]);if(vs.some(v=>Math.abs(V.dot(n,v)-w)>tolerance*10))throw Error('Only planar boundary loops can be filled.');const id=tag();for(const tri of triangulate3D(vs,n))ps.push(new Polygon(tri.map(i=>vs[i]),id));count++;
  }
  return {solid:new Solid(ps,{type:'filled'}),count};
}
export function sheetMetal({width=70,base=50,flange=35,thickness=2,radius=4,angle=90,kfactor=.42,flat=false}={}){
  width=finiteNumber(width,'Width',.1,1e4);base=finiteNumber(base,'Base',.1,1e4);flange=finiteNumber(flange,'Flange',.1,1e4);thickness=finiteNumber(thickness,'Thickness',.01,1000);radius=finiteNumber(radius,'Bend radius',.01,10000);angle=finiteNumber(angle,'Bend angle',1,170);kfactor=finiteNumber(kfactor,'K-factor',0,1);
  let a=angle*Math.PI/180,allowance=a*(radius+kfactor*thickness),meta={type:'sheet',width,base,flange,thickness,radius,angle,kfactor,flat,allowance};
  if(flat){let s=box(base+allowance+flange,width,thickness,[(base+allowance+flange)/2,0,thickness/2]);s.meta=meta;return s;}
  // Cross-section: straight stock + annular bend + tangent flange; extruded across the width.
  let ri=radius,ro=radius+thickness,cx=base,cz=ro,outer=[[0,0],[base,0]],inner=[[0,thickness],[base,thickness]],steps=24;
  for(let i=1;i<=steps;i++){let t=i*a/steps;outer.push([cx+ro*Math.sin(t),cz-ro*Math.cos(t)]);inner.push([cx+ri*Math.sin(t),cz-ri*Math.cos(t)]);}
  const tangent=[Math.cos(a),Math.sin(a)];outer.push(V.add(outer.at(-1),V.mul(tangent,flange)));inner.push(V.add(inner.at(-1),V.mul(tangent,flange)));let profile=[...outer,...inner.reverse()];
  let s=extrude(profile,width,-width/2).transform([1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1]);s.meta=meta;return s;
}
export function simplifyVertexClusters(solid,cell=1){
  cell=finiteNumber(cell,'Cluster size',.0001,1e4);const cells=new Map(),key=v=>v.map(x=>Math.round(x/cell)).join(',');for(const p of solid.polygons)for(const v of p.vertices){const k=key(v),q=cells.get(k)||{sum:[0,0,0],n:0};q.sum=V.add(q.sum,v);q.n++;cells.set(k,q);}const points=new Map([...cells].map(([k,v])=>[k,V.mul(v.sum,1/v.n)]));
  let ps=solid.triangles().map(t=>new Polygon(t.vertices.map(v=>points.get(key(v))),t.face));return repair(new Solid(ps,{type:'mesh-reduction'}),1e-6,false).solid;
}
export function sectionSegments(solid,axis=2,position=0){
  let segments=[];for(const t of solid.triangles()){let hits=[];for(let i=0;i<3;i++){let a=t.vertices[i],b=t.vertices[(i+1)%3],da=a[axis]-position,db=b[axis]-position;if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS))hits.push(V.lerp(a,b,da/(da-db)));else if(Math.abs(da)<EPS)hits.push(a);}let uniq=[...new Map(hits.map(p=>[p.map(x=>x.toFixed(6)).join(','),p])).values()];if(uniq.length===2)segments.push(uniq);}return segments;
}
