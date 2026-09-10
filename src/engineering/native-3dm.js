/** openNURBS codec. Unsupported geometry is reported, never silently replaced by its support surface. */
let cached;
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
export function disposeNative(v){if(!v)return;for(let p=Object.getPrototypeOf(v);p;p=Object.getPrototypeOf(p)){if(Object.hasOwn(p,'isDeleted')&&Object.hasOwn(p,'delete')){if(!p.isDeleted.call(v))p.delete.call(v);return;}}v.delete?.();}
class Owners{values=[];own(v){if(!v)throw Error('Native .3dm operation failed.');this.values.push(v);return v;}close(){for(const v of this.values.reverse())try{disposeNative(v);}catch{}}}
const fullKnots=k=>[k.superfluousKnot(true),...k.toList(),k.superfluousKnot(false)];
function uniqueKnots(knots){const values=[],mult=[];for(const v of knots){if(!finite(v))throw Error('Invalid NURBS knot.');if(values.length&&v===values.at(-1))mult[mult.length-1]++;else{if(values.length&&v<values.at(-1))throw Error('Decreasing knots.');values.push(v);mult.push(1);}}return [values,mult];}
function controlPoint(p){if(!Array.isArray(p)||p.length!==4||!p.every(finite)||p[3]<=0)throw Error('Unsupported nonpositive or invalid homogeneous NURBS weight.');return {point:p.slice(0,3).map(v=>v/p[3]),weight:p[3]};}
export function extractNurbsSurface(surface,own){
  const s=own(surface.toNurbsSurface()),cp=own(s.points()),ku=own(s.knotsU()),kv=own(s.knotsV());
  if(cp.countU>64||cp.countV>64||s.degree(0)>12||s.degree(1)>12)throw Error('Surface exceeds the 64×64, degree-12 native import budget.');
  const poles=[],weights=[];for(let i=0;i<cp.countU;i++){const ps=[],ws=[];for(let j=0;j<cp.countV;j++){const c=controlPoint(cp.get(i,j));ps.push(c.point);ws.push(c.weight);}poles.push(ps);weights.push(ws);}
  const [uKnots,uMultiplicities]=uniqueKnots(fullKnots(ku)),[vKnots,vMultiplicities]=uniqueKnots(fullKnots(kv));
  // Full openNURBS knot vectors describe an equivalent non-periodic domain, including closed surfaces.
  return {poles,weights,uDegree:s.degree(0),vDegree:s.degree(1),uKnots,vKnots,uMultiplicities,vMultiplicities};
}
function extractCurve(curve,own){const c=own(curve.toNurbsCurve()),ps=own(c.points()),k=own(c.knots());if(ps.count>4096||c.degree>12)throw Error('Trim curve exceeds the import budget.');const poles=[],weights=[];for(let i=0;i<ps.count;i++){const p=controlPoint(ps.get(i));poles.push(p.point);weights.push(p.weight);}const[knots,multiplicities]=uniqueKnots(fullKnots(k));return {poles,weights,knots,multiplicities,degree:c.degree};}
function extractBrep(b,own){const fl=own(b.faces()),el=own(b.edges());if(fl.count>512||el.count>8192)throw Error('B-rep exceeds the .3dm translator topology budget.');const faces=[];for(let i=0;i<fl.count;i++){const f=own(fl.get(i)),surface=own(f.underlyingSurface()),loops=own(f.loops),wires=[];for(let j=0;j<loops.count;j++){const loop=own(loops.get(j)),trims=own(loop.trims),edges=[];if(trims.count>512)throw Error('Trim loop exceeds the edge budget.');for(let k=0;k<trims.count;k++){const t=own(trims.get(k));if(t.edgeIndex<0)throw Error('Singular .3dm trims are not yet supported; import this object through STEP instead.');if(t.edgeIndex>=el.count)throw Error('Invalid trim edge reference.');edges.push({...extractCurve(own(el.get(t.edgeIndex)),own),reverse:t.isReversed});}wires.push(edges);}faces.push({surface:extractNurbsSurface(surface,own),reverse:f.orientationIsReversed,wires});}return{faces,solid:b.isSolid};}
function matrix(r,m,own){if(!Array.isArray(m)||m.length!==16||!m.every(finite))throw Error('Invalid .3dm transform.');const t=own(new r.Transform(1));for(let i=0;i<4;i++)for(let j=0;j<4;j++)t[`m${i}${j}`]=m[j*4+i];return t;}
function meshData(m,own){const vs=own(m.vertices()),fs=own(m.faces());if(vs.count>500000||fs.count>500000)throw Error('.3dm mesh exceeds the import budget.');const positions=[],indices=[];for(let i=0;i<vs.count;i++){const p=vs.get(i);if(!p.every(finite))throw Error('Invalid mesh vertex.');positions.push(...p);}for(let i=0;i<fs.count;i++){const f=fs.get(i);if(f.some(x=>!Number.isInteger(x)||x<0||x>=vs.count))throw Error('Invalid mesh index.');indices.push(f[0],f[1],f[2]);if(f[2]!==f[3])indices.push(f[0],f[2],f[3]);}return {positions,indices};}
function createSurface(r,d,own){
  if(d.uPeriodic||d.vPeriodic)throw Error('New periodic surfaces must use STEP export; retained native .3dm surfaces can be re-exported.');
  const s=own(r.NurbsSurface.create(3,true,d.uDegree+1,d.vDegree+1,d.poles.length,d.poles[0].length)),ps=own(s.points());
  d.poles.forEach((row,i)=>row.forEach((p,j)=>{const w=d.weights?.[i]?.[j]??1;ps.set(i,j,[p[0]*w,p[1]*w,p[2]*w,w]);}));
  for(const dir of ['u','v']){const k=own(dir==='u'?s.knotsU():s.knotsV()),full=d[dir+'Knots'].flatMap((x,i)=>Array(d[dir+'Multiplicities'][i]).fill(x)).slice(1,-1);if(k.count!==full.length)throw Error('NURBS knot count mismatch.');full.forEach((v,i)=>k.set(i,v));}if(!s.isValid)throw Error('Invalid native .3dm surface.');return s;
}
export async function initialize3dm(options={}){
  if(!cached)cached=(async()=>{const init=(await import('../../vendor/rhino3dm/rhino3dm.mjs')).default;const url=new URL('../../vendor/rhino3dm/rhino3dm.wasm',import.meta.url);const wasmBinary=typeof process!=='undefined'&&process.versions?.node?await(await import('node:fs/promises')).readFile(url):new Uint8Array(await(await fetch(url)).arrayBuffer());return init({wasmBinary,locateFile:()=>url.href});})();
  const r=await cached;
  return {r,async run(command,args={}){const owners=new Owners(),own=v=>owners.own(v);try{
    if(command==='import3dm'){
      const bytes=args.bytes instanceof Uint8Array?args.bytes:new Uint8Array(args.bytes||[]);if(!bytes.length||bytes.length>32*1024*1024)throw Error('.3dm input must be 1 byte–32 MiB.');const f=own(r.File3dm.fromByteArray(bytes)),settings=own(f.settings()),units=settings.modelUnitSystem;
      const scales={Millimeters:1,Centimeters:10,Meters:1000,Inches:25.4,Feet:304.8,Microns:.001,Microinches:.0000254,Yards:914.4};let scale=Object.entries(scales).find(([key])=>units===r.UnitSystem[key])?.[1];if(args.unitsScale!==undefined)scale=args.unitsScale;if(!finite(scale)||scale<=0||scale>1e9)throw Error('Unsupported/unspecified .3dm units. Set an explicit millimetres-per-unit scale.');
      const table=own(f.objects());if(table.count>1000)throw Error('At most 1000 .3dm objects.');const objects=[],unsupported=[];
      for(let i=0;i<table.count;i++){
        const o=own(table.get(i)),g=own(o.geometry()),a=own(o.attributes()),name=a.name||'Object '+(i+1);
        try{
          if(scale!==1&&!g.transform(own(r.Transform.scale([0,0,0],scale))))throw Error('Unit conversion failed.');
          let item;if(g instanceof r.Mesh)item={kind:'mesh',mesh:meshData(g,own)};
          else if(g instanceof r.Brep)item={kind:'brep',brep:extractBrep(g,own)};
          else if(g instanceof r.Surface)item={kind:'surface',surface:extractNurbsSurface(g,own)};
          else if(g instanceof r.Extrusion){const b=own(g.toBrep(true));item={kind:'brep',brep:extractBrep(b,own)};}
          else throw Error('Unsupported object type (curves, blocks, SubD, text and plugin objects are not converted).');
          objects.push({...item,name,native3dm:g.encode(),layer:a.layerIndex});
        }catch(e){unsupported.push({index:i,name,reason:e.message||String(e)});}
      }
      if(unsupported.length&&!args.allowPartial)throw Error('Import refused to lose geometry: '+unsupported.map(x=>`${x.name}: ${x.reason}`).join('; '));if(!objects.length)throw Error('No supported .3dm geometry.');return{objects,unsupported,unitsScale:scale,format:'3dm'};
    }
    if(command==='export3dm'){
      const items=args.objects;if(!Array.isArray(items)||!items.length||items.length>1000)throw Error('Export 1–1000 objects.');const f=own(new r.File3dm()),settings=own(f.settings()),table=own(f.objects());settings.modelUnitSystem=r.UnitSystem.Millimeters;settings.modelAbsoluteTolerance=1e-6;const report=[];
      for(const item of items){let geometry,kind;if(item.native3dm){geometry=own(r.CommonObject.decode(item.native3dm));kind='retained native geometry';}
        else if(item.surface){geometry=createSurface(r,item.surface,own);kind='NURBS surface';}
        else{const m=item.mesh;if(!m||!Array.isArray(m.positions)||!Array.isArray(m.indices)||m.positions.length%3||m.indices.length%3||m.positions.length>1500000||m.indices.length>1500000||!m.positions.every(finite)||m.indices.some(i=>!Number.isInteger(i)||i<0||i>=m.positions.length/3))throw Error('Invalid mesh export.');geometry=own(new r.Mesh());const vs=own(geometry.vertices()),fs=own(geometry.faces());for(let i=0;i<m.positions.length;i+=3)vs.add(...m.positions.slice(i,i+3));for(let i=0;i<m.indices.length;i+=3)fs.addTriFace(...m.indices.slice(i,i+3));kind='display mesh (not analytic B-rep)';}
        if(item.pose&&!geometry.transform(matrix(r,item.pose,own)))throw Error('Native geometry transform failed.');const a=own(new r.ObjectAttributes());a.name=String(item.name||'Avolith object').slice(0,1000);a.setUserString('Avolith representation',kind);const id=table.add(geometry,a);if(!id)throw Error('Cannot write .3dm object.');report.push({name:a.name,representation:kind});
      }
      return {bytes:f.toByteArray(),report,format:'3dm'};
    }
    throw Error('Unknown .3dm command.');
  }finally{owners.close();}}};
}
