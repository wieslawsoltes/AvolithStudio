import {V,M,transformedPoint} from '../core/math.js';
import {metrics,topology} from '../core/kernel.js';
import {MATERIALS} from '../core/document.js';
import {resolveAnnotation} from './pmi.js';
export function transformedExactProperties(body){
  const e=body.solid.meta.exact;if(!e)return null;const p=e.properties,m=e.pose||M.identity(),s=V.len(m.slice(0,3));
  return {...p,area:p.area*s*s,volume:p.volume*s*s*s,centroid:p.centroid?transformedPoint(m,p.centroid):null,bounds:[body.solid.bounds.min,body.solid.bounds.max],boundsSource:'display tessellation'};
}
export function indexedSurface(bodies,tolerance=1e-7){
  if(!Array.isArray(bodies)||!bodies.length||bodies.length>500)throw Error('Select 1–500 bodies.');
  if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.1)throw Error('Invalid mesh weld tolerance.');
  const vertices=[],triangles=[],groups=[],map=new Map();
  const vertex=(p,id)=>{const key=id+':'+p.map(v=>Math.round(v/tolerance)).join(',');if(!map.has(key)){map.set(key,vertices.length);vertices.push(p.slice());}return map.get(key);};
  for(const b of bodies){const begin=triangles.length;for(const t of b.solid.triangles()){const ids=t.vertices.map(p=>vertex(p,b.id));if(new Set(ids).size<3)continue;if(triangles.length>=500000)throw Error('Surface export exceeds 500,000 triangles.');triangles.push({indices:ids,body:b.id,face:t.face});}groups.push({body:b.id,name:b.name,start:begin,count:triangles.length-begin,material:b.material});}
  if(triangles.length>500000)throw Error('Surface export exceeds 500,000 triangles.');return {vertices,triangles,groups};
}
export function sampledThickness(solid,maxSamples=160){
  const tris=solid.triangles();if(!tris.length)return {minimum:null,samples:0};let minimum=Infinity,count=0;const stride=Math.max(1,Math.ceil(tris.length/maxSamples)),epsilon=Math.max(1e-6,V.len(solid.bounds.size)*1e-7);
  for(let i=0;i<tris.length;i+=stride){const t=tris[i],p=V.mul(t.vertices.reduce((a,b)=>V.add(a,b),[0,0,0]),1/3),origin=V.sub(p,V.mul(t.normal,epsilon)),hit=solid.bvh().hit(origin,V.mul(t.normal,-1));if(hit&&hit.t>epsilon){minimum=Math.min(minimum,hit.t+epsilon);count++;}}
  return {minimum:Number.isFinite(minimum)?minimum:null,samples:count,method:'Sampled display-mesh inward rays; not a guaranteed minimum wall thickness.'};
}
export function preflight(document,{minimumEdge=.05,minimumFace=.01,wallTarget=1,thickness=false}={}){
  if(![minimumEdge,minimumFace,wallTarget].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))throw Error('Preflight thresholds must be finite and nonnegative.');
  const findings=[],parts=[];
  for(const b of document.bodies){
    const e=b.solid.meta.exact,p=e?transformedExactProperties(b):metrics(b.solid),t=topology(b.solid),record={id:b.id,name:b.name,representation:e?'exact-brep':'faceted',triangles:b.solid.triangles().length,area:p.area,volume:p.volume,massGrams:p.volume*(MATERIALS[b.material]?.density||0),boundaryEdges:t.boundary.length,nonmanifoldEdges:t.nonmanifold.length};
    if(!e)findings.push({severity:'warning',code:'faceted',body:b.id,message:'Faceted body: no analytic-kernel validity or exact dimensions are available.'});
    if(e&&!e.properties.solidCount)findings.push({severity:'warning',body:b.id,message:'Open surface/shell. A watertight solid is required for volume meshing.'});
    if(e&&e.edges.some(x=>x.length*V.len(e.pose.slice(0,3))<minimumEdge))findings.push({severity:'warning',body:b.id,message:'Short topological edges are below the preparation threshold.'});
    if(e&&e.faces.some(x=>x.area*Math.pow(V.len(e.pose.slice(0,3)),2)<minimumFace))findings.push({severity:'warning',body:b.id,message:'Small/sliver faces are below the preparation threshold.'});
    if(t.nonmanifold.length)findings.push({severity:'error',body:b.id,message:'Display mesh has nonmanifold edges; inspect before mesh-based exchange.'});
    if(!e&&t.boundary.length)findings.push({severity:'warning',body:b.id,message:'Faceted surface has open boundaries.'});
    if(thickness){record.thickness=sampledThickness(b.solid);if(record.thickness.minimum!==null&&record.thickness.minimum<wallTarget)findings.push({severity:'warning',body:b.id,message:`Sampled wall ${record.thickness.minimum.toFixed(3)} mm is below ${wallTarget} mm. Verify on analytic geometry.`});}
    parts.push(record);
  }
  for(const a of document.engineering.annotations)if(resolveAnnotation(a,document.bodies).stale)findings.push({severity:'error',message:'PMI has a stale geometry reference: '+(a.label||a.id)});
  for(const m of document.engineering.mates)for(const ref of [m.a,m.b])if(document.find(ref?.body)?.solid.meta.referenceKey!==ref?.key)findings.push({severity:'error',message:'Assembly mate has a stale geometry reference: '+(m.name||m.id)});
  return {format:'avolith-preflight',version:1,units:'mm',model:document.name,revision:document.revision,parts,findings,passed:!findings.some(f=>f.severity==='error'),certified:false,notice:'Geometry preparation diagnostics only. This is not manufacturing, meshing, solver, safety or standards certification.'};
}
export function surfaceVTK(bodies){const m=indexedSurface(bodies);return `# vtk DataFile Version 3.0\nAvolith surface mesh - millimetres\nASCII\nDATASET POLYDATA\nPOINTS ${m.vertices.length} double\n${m.vertices.map(p=>p.join(' ')).join('\n')}\nPOLYGONS ${m.triangles.length} ${m.triangles.length*4}\n${m.triangles.map(t=>'3 '+t.indices.join(' ')).join('\n')}\nCELL_DATA ${m.triangles.length}\nSCALARS body_id int 1\nLOOKUP_TABLE default\n${m.triangles.map(t=>m.groups.findIndex(g=>g.body===t.body)+1).join('\n')}\n`;}
function csvEscape(s){s=String(s);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function bomCSV(document){return 'Body,Material,Representation,Volume_mm3,Area_mm2,Mass_g\n'+document.bodies.map(b=>{const p=transformedExactProperties(b)||metrics(b.solid);return [csvEscape(b.name),csvEscape(MATERIALS[b.material]?.name||b.material),b.solid.meta.exact?'exact B-rep':'faceted',p.volume,p.area,p.volume*(MATERIALS[b.material]?.density||0)].join(',');}).join('\n')+'\n';}
/** Exports the triangulated skin as S3 shell elements, never disguising it as a
 * volumetric finite-element mesh. User supplies shell section/material values. */
export function shellINP(bodies,{thickness=1,youngModulus=210000,poissonRatio=.3,density=7.85e-9}={}){
  if(![thickness,youngModulus,density].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(poissonRatio)||poissonRatio<=-1||poissonRatio>=.5)throw Error('Invalid shell material/section parameters.');
  const m=indexedSurface(bodies),lines=['*HEADING','Avolith S3 surface-shell model. Units: mm, N, tonne, s.','** No boundary conditions, contacts or loads are inferred.','** This is NOT a volume-solid discretization. Validate the idealization.','*NODE',...m.vertices.map((p,i)=>[i+1,...p].join(', ')),'*ELEMENT, TYPE=S3, ELSET=SKIN',...m.triangles.map((t,i)=>[i+1,...t.indices.map(n=>n+1)].join(', '))];
  for(let i=0;i<m.groups.length;i++){const g=m.groups[i];if(g.count)lines.push(`*ELSET, ELSET=BODY_${i+1}, GENERATE`,`${g.start+1}, ${g.start+g.count}, 1`);}
  lines.push('*MATERIAL, NAME=USER_MATERIAL','*ELASTIC',`${youngModulus}, ${poissonRatio}`,'*DENSITY',String(density),'*SHELL SECTION, ELSET=SKIN, MATERIAL=USER_MATERIAL',String(thickness));return lines.join('\n')+'\n';
}
