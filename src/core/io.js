import {Solid,Polygon,featureEdges} from './kernel.js';
import {MATERIALS} from './document.js';
import {normalOf,bounds} from './math.js';
export const MAX_IMPORT_BYTES=48*1024*1024;
function checkVertices(v){if(v.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e8)))throw Error('File contains invalid coordinates.');}
export function parseSTL(buffer){
  if(buffer.byteLength>MAX_IMPORT_BYTES)throw Error('STL exceeds the 48 MiB import limit.');let view=new DataView(buffer),ps=[];
  const n=buffer.byteLength>=84?view.getUint32(80,true):0,binary=buffer.byteLength>=84&&84+n*50===buffer.byteLength;
  if(binary){if(n>200000)throw Error('STL exceeds 200,000 triangles.');for(let i=0;i<n;i++){let o=84+i*50+12,vs=[];for(let j=0;j<3;j++)vs.push([view.getFloat32(o+j*12,true),view.getFloat32(o+j*12+4,true),view.getFloat32(o+j*12+8,true)]);checkVertices(vs);ps.push(new Polygon(vs));}}
  else {let text=new TextDecoder().decode(buffer);if(!/^\s*solid\b/i.test(text))throw Error('STL is truncated or has an invalid header.');let nums=[...text.matchAll(/\bvertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g)].map(m=>m.slice(1).map(Number));if(!nums.length||nums.length%3||nums.length>600000)throw Error('Invalid ASCII STL vertex count.');checkVertices(nums);for(let i=0;i<nums.length;i+=3)ps.push(new Polygon(nums.slice(i,i+3)));}
  if(!ps.length)throw Error('The STL contains no triangles.');return new Solid(ps,{type:'import',format:'stl'});
}
export function exportSTL(bodies){
  const triangles=bodies.flatMap(b=>b.solid.triangles()),buffer=new ArrayBuffer(84+triangles.length*50),v=new DataView(buffer);new Uint8Array(buffer,0,80).set(new TextEncoder().encode('Avolith Studio | millimeters | tessellated geometry'));v.setUint32(80,triangles.length,true);
  for(let i=0;i<triangles.length;i++){let t=triangles[i],values=[...normalOf(t.vertices),...t.vertices.flat()],o=84+i*50;values.forEach((x,j)=>v.setFloat32(o+j*4,x,true));v.setUint16(o+48,0,true);}return buffer;
}
export function parseOBJ(text){
  if(text.length>MAX_IMPORT_BYTES)throw Error('OBJ exceeds the import limit.');let vertices=[],ps=[],name='Imported OBJ';
  for(const line of text.split(/\r?\n/)){const parts=line.trim().split(/\s+/),kind=parts.shift();if(kind==='v'){if(parts.length<3)throw Error('Invalid OBJ vertex.');let v=parts.slice(0,3).map(Number);checkVertices([v]);vertices.push(v);if(vertices.length>1000000)throw Error('OBJ vertex limit exceeded.');}
    else if(kind==='f'){if(parts.length<3||parts.length>4096)throw Error('Invalid OBJ face.');const vs=parts.map(p=>{let i=Number(p.split('/')[0]);if(!Number.isInteger(i)||i===0)throw Error('Invalid OBJ index.');i=i<0?vertices.length+i:i-1;if(!vertices[i])throw Error('OBJ references a missing vertex.');return vertices[i];});ps.push(new Polygon(vs));if(ps.length>200000)throw Error('OBJ face limit exceeded.');}else if(kind==='o'&&parts.length)name=parts.join(' ');}
  if(!ps.length)throw Error('OBJ contains no polygon faces.');return {solid:new Solid(ps,{type:'import',format:'obj'}),name};
}
export function exportOBJ(bodies){
  let out=['# Avolith Studio — units: millimeters'],offset=1;
  for(const b of bodies){out.push(`o ${b.name.replace(/[^\w-]/g,'_')}`);let verts=[],faces=[],map=new Map();for(const p of b.solid.polygons){let f=[];for(const v of p.vertices){let k=v.join(',');if(!map.has(k)){map.set(k,verts.length+offset);verts.push(v);}f.push(map.get(k));}faces.push(f);}out.push(...verts.map(v=>`v ${v.join(' ')}`),...faces.map(f=>`f ${f.join(' ')}`));offset+=verts.length;}return out.join('\n');
}
export function parsePLY(text){
  if(!text.startsWith('ply')||!text.includes('format ascii 1.0'))throw Error('Only ASCII PLY 1.0 is supported.');const end=text.indexOf('end_header');if(end<0)throw Error('PLY has no header terminator.');let header=text.slice(0,end),nv=Number(header.match(/element vertex (\d+)/)?.[1]),nf=Number(header.match(/element face (\d+)/)?.[1]);if(!nv||!nf||nv>1000000||nf>200000)throw Error('Invalid or oversized PLY.');
  let vertexHeader=header.split(/element vertex \d+/)[1]?.split('element ')[0],props=[...vertexHeader.matchAll(/property \w+ (\w+)/g)].map(m=>m[1]),idx=['x','y','z'].map(a=>props.indexOf(a));if(idx.some(i=>i<0))throw Error('PLY needs X, Y and Z properties.');let lines=text.slice(end+10).trim().split(/\r?\n/),vs=lines.slice(0,nv).map(l=>{let v=l.trim().split(/\s+/).map(Number);return idx.map(i=>v[i]);});if(lines.length<nv+nf)throw Error('Truncated PLY vertex or face data.');checkVertices(vs);let ps=[];
  for(const l of lines.slice(nv,nv+nf)){let a=l.trim().split(/\s+/).map(Number),n=a.shift();if(!Number.isInteger(n)||n<3||n>4096||a.length<n)throw Error('Invalid PLY polygon.');ps.push(new Polygon(a.slice(0,n).map(i=>{if(!Number.isInteger(i)||!vs[i])throw Error('Invalid PLY index.');return vs[i];})));}return new Solid(ps,{type:'import',format:'ply'});
}
export function exportGLB(bodies){
  let json={asset:{version:'2.0',generator:'Avolith Studio'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]},chunks=[],offset=0;
  const add=data=>{let a=new Float32Array(data),idx=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:a.byteLength,target:34962});chunks.push(new Uint8Array(a.buffer));offset+=a.byteLength;return idx;};
  for(const b of bodies){let positions=[],normals=[];for(const t of b.solid.triangles())for(const v of t.vertices){positions.push(v[0]/1000,v[2]/1000,-v[1]/1000);normals.push(t.normal[0],t.normal[2],-t.normal[1]);}if(!positions.length)continue;
    let posView=add(positions),norView=add(normals),pidx=json.accessors.length,pts=[];for(let i=0;i<positions.length;i+=3)pts.push(positions.slice(i,i+3));let bb=bounds(pts);json.accessors.push({bufferView:posView,componentType:5126,count:positions.length/3,type:'VEC3',min:bb.min,max:bb.max},{bufferView:norView,componentType:5126,count:normals.length/3,type:'VEC3'});
    let color=[1,3,5].map(i=>parseInt(b.color.slice(i,i+2),16)/255),mat=MATERIALS[b.material]||MATERIALS.aluminum,mi=json.materials.length;json.materials.push({name:mat.name,pbrMetallicRoughness:{baseColorFactor:[...color,1],metallicFactor:mat.metallic,roughnessFactor:mat.roughness},doubleSided:false});let mesh=json.meshes.length;json.meshes.push({name:b.name,primitives:[{attributes:{POSITION:pidx,NORMAL:pidx+1},material:mi}]});json.scenes[0].nodes.push(json.nodes.length);json.nodes.push({mesh,name:b.name});
  }
  json.buffers[0].byteLength=offset;let raw=new TextEncoder().encode(JSON.stringify(json)),len=(raw.length+3)&~3,buffer=new ArrayBuffer(12+8+len+8+offset),dv=new DataView(buffer),u8=new Uint8Array(buffer);dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,buffer.byteLength,true);dv.setUint32(12,len,true);dv.setUint32(16,0x4e4f534a,true);u8.fill(32,20,20+len);u8.set(raw,20);dv.setUint32(20+len,offset,true);dv.setUint32(24+len,0x004e4942,true);let p=28+len;for(const c of chunks){u8.set(c,p);p+=c.byteLength;}return buffer;
}
export function exportDXF(bodies,sketches=[]){
  let out=['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES'];
  const line=(a,b,layer)=>out.push('0','LINE','8',layer,'10',String(a[0]),'20',String(a[1]),'30',String(a[2]||0),'11',String(b[0]),'21',String(b[1]),'31',String(b[2]||0));
  for(const b of bodies)for(const [a,c] of featureEdges(b.solid))line(a,c,b.name.replace(/[^\w-]/g,'_'));
  for(const s of sketches){const world=p=>s.plane==='XZ'?[p[0],s.origin||0,p[1]]:s.plane==='YZ'?[s.origin||0,p[0],p[1]]:[p[0],p[1],s.origin||0];for(let i=0;i<s.points.length-(s.closed?0:1);i++)line(world(s.points[i]),world(s.points[(i+1)%s.points.length]),'SKETCH');}out.push('0','ENDSEC','0','EOF');return out.join('\n');
}
export function parseDXF(text){
  let a=text.replace(/\r/g,'').split('\n'),entities=[],current=null;for(let i=0;i+1<a.length;i+=2){let code=Number(a[i].trim()),value=a[i+1].trim();if(code===0){if(current)entities.push(current);current={type:value,pairs:[]};}else current?.pairs.push([code,value]);}if(current)entities.push(current);let sketches=[];
  for(const e of entities){const get=(c,d=0)=>Number(e.pairs.find(p=>p[0]===c)?.[1]??d);if(e.type==='LINE')sketches.push({points:[[get(10),get(20)],[get(11),get(21)]],closed:false});
    if(e.type==='CIRCLE'){let x=get(10),y=get(20),r=get(40);if(r>0)sketches.push({points:Array.from({length:64},(_,i)=>[x+r*Math.cos(i*2*Math.PI/64),y+r*Math.sin(i*2*Math.PI/64)]),closed:true});}
    if(e.type==='LWPOLYLINE'){let ps=[];for(const [c,v] of e.pairs){if(c===10)ps.push([Number(v),0]);if(c===20&&ps.length)ps.at(-1)[1]=Number(v);if(c===42&&Number(v)!==0)throw Error('DXF bulge arcs are not supported; export straight polylines.');}if(ps.length>1)sketches.push({points:ps,closed:!!(get(70)&1)});}}
  if(!sketches.length)throw Error('DXF contains no supported LINE, CIRCLE or LWPOLYLINE entities.');for(const s of sketches)checkVertices(s.points);return sketches;
}
export function download(data,name,type='application/octet-stream'){
  const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function exportCSV(report){const quote=s=>'"'+(/^[=+@\-\t\r]/.test(String(s))?"'":'')+String(s).replaceAll('"','""')+'"';return ['Name,Material,Volume (mm3),Area (mm2),Mass (g),Triangles',...report.bodies.map(b=>[quote(b.name),quote(b.material),b.volume_mm3,b.area_mm2,b.mass_g,b.triangles].join(','))].join('\n');}
