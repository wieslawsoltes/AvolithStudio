/** Exact B-rep operations. Rendering meshes are derived data, never the modeling source.
 * OpenCascade/Replicad run in a dedicated worker. All quantities are millimetres.
 */
import {M,V} from '../core/math.js';
import {makeExactSheet} from './sheet-metal.js';

export const EXACT_VERSION='1.0';
export const EXACT_LIMITS=Object.freeze({fileBytes:32*1024*1024,triangles:200000,faces:20000,edges:50000,controlPoints:4096});
export const number=(value,name,min=-1e7,max=1e7)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`${name} must be a finite number in [${min}, ${max}].`);
  return value;
};
const positive=(x,name)=>number(x,name,1e-5,1e6);
export function point(value,name='Point'){
  if(!Array.isArray(value)||value.length!==3)throw Error(`${name} needs three coordinates.`);
  return value.map(x=>number(x,name));
}
const direction=(v)=>{v=point(v,'Direction');if(V.len(v)<1e-10)throw Error('Direction cannot be zero.');return V.norm(v);};
const dispose=(x)=>{try{x?.delete?.();}catch{/* Consuming sketch operations already release their handles. */}};
class Scope{
  constructor(){this.items=new Set();}
  own(x){if(x&&typeof x.delete==='function')this.items.add(x);return x;}
  all(xs){xs.forEach(x=>this.own(x));return xs;}
  close(){for(const x of [...this.items].reverse())dispose(x);this.items.clear();}
}
export function validatePose(m){
  if(!Array.isArray(m)||m.length!==16||m.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid exact-body transform.');
  if(Math.abs(m[3])+Math.abs(m[7])+Math.abs(m[11])+Math.abs(m[15]-1)>1e-9)throw Error('Only affine transforms are supported.');
  const c=[m.slice(0,3),m.slice(4,7),m.slice(8,11)],l=c.map(V.len),scale=Math.max(...l);
  if(scale<1e-10||Math.min(...l)<scale*(1-1e-7)||c.some((a,i)=>c.some((b,j)=>i!==j&&Math.abs(V.dot(a,b))>scale*scale*1e-7)))throw Error('Exact transforms must be rigid or uniformly scaled. Nonuniform scaling requires a different operation.');
  return m;
}
export function validateNURBS(data){
  const {poles,uDegree,vDegree,uKnots,vKnots,uMultiplicities,vMultiplicities}=data;
  if(!Array.isArray(poles)||poles.length<2||!Array.isArray(poles[0])||poles[0].length<2||poles.length*poles[0].length>EXACT_LIMITS.controlPoints)throw Error('Invalid NURBS control net.');
  const nu=poles.length,nv=poles[0].length;
  for(const row of poles){if(!Array.isArray(row)||row.length!==nv)throw Error('NURBS control net must be rectangular.');row.forEach(p=>point(p,'Control point'));}
  function knots(k,m,d,n,name){
    if(!Number.isInteger(d)||d<1||d>Math.min(25,n-1))throw Error(`${name} degree is invalid.`);
    if(!Array.isArray(k)||!Array.isArray(m)||k.length!==m.length||k.length<2||k.length>n+2)throw Error(`${name} knot vector is invalid.`);
    k.forEach((x,i)=>{number(x,`${name} knot`);if(i&&x<=k[i-1])throw Error('Knots must increase strictly.');if(!Number.isInteger(m[i])||m[i]<1||m[i]>(i===0||i===k.length-1?d+1:d))throw Error('Invalid knot multiplicity.');});
    if(m.reduce((a,b)=>a+b,0)!==n+d+1)throw Error(`${name} multiplicities must sum to pole count + degree + 1.`);
  }
  knots(uKnots,uMultiplicities,uDegree,nu,'U');knots(vKnots,vMultiplicities,vDegree,nv,'V');
  const weights=data.weights||poles.map(row=>row.map(()=>1));
  if(!Array.isArray(weights)||weights.length!==nu||weights.some(row=>!Array.isArray(row)||row.length!==nv))throw Error('Weights must match the control net.');
  weights.forEach(row=>row.forEach(w=>positive(w,'NURBS weight')));
  return {...data,weights};
}

export async function initializeExact(options={}){
  const base=options.baseURL||new URL('../../vendor/exact/',import.meta.url);
  const [{default:init},r]=await Promise.all([import(new URL('replicad_single.js',base)),import(new URL('replicad.js',base))]);
  const oc=await init({locateFile:name=>new URL(name,base).href,print:options.log||(()=>{}),printErr:options.log||(()=>{})});
  r.setOC(oc);
  let sequence=0;
  const engine={oc,r,version:EXACT_VERSION};
  function valid(shape,scope){
    if(!shape||shape.isNull)throw Error('The exact operation produced no geometry.');
    const check=scope.own(new oc.BRepCheck_Analyzer(shape.wrapped,true,false,true));
    if(!check.IsValid())throw Error('OpenCascade rejected the result: invalid B-rep topology or geometry. No edit was applied.');
    return shape;
  }
  function applyPose(shape,m,scope){
    if(!m)return shape;validatePose(m);
    if(m.every((x,i)=>Math.abs(x-M.identity()[i])<1e-13))return shape;
    const t=scope.own(new oc.gp_Trsf());
    t.SetValues(m[0],m[4],m[8],m[12],m[1],m[5],m[9],m[13],m[2],m[6],m[10],m[14]);
    const tr=scope.own(new oc.BRepBuilderAPI_Transform(shape.wrapped,t,true));
    return scope.own(r.cast(tr.Shape()));
  }
  function load(input,scope){
    if(!input||typeof input.brep!=='string'||!input.brep.includes('CASCADE Topology')||input.brep.length>EXACT_LIMITS.fileBytes)throw Error('An exact B-rep body is required. Promote an eligible primitive or import STEP/IGES first.');
    const s=scope.own(r.deserializeShape(input.brep));return valid(applyPose(s,input.pose,scope),scope);
  }
  function meshOptions(config={}){
    return {tolerance:number(config.tolerance??.12,'Display chord tolerance',.001,10),angularTolerance:number(config.angularTolerance??.22,'Angular tolerance',.02,1)};
  }
  function analyticData(entity,surface=true){
    const scope=new Scope();
    try{
      const adapter=scope.own(surface?new oc.BRepAdaptor_Surface(entity.wrapped,true):new oc.BRepAdaptor_Curve(entity.wrapped));
      const kind=entity.geomType,method=surface?({PLANE:'Plane',CYLINDRE:'Cylinder',CYLINDER:'Cylinder',CONE:'Cone',SPHERE:'Sphere',TORUS:'Torus'}[kind]):({CIRCLE:'Circle',ELLIPSE:'Ellipse'}[kind]);if(!method)return null;
      const geometry=scope.own(adapter[method]()),location=scope.own(geometry.Location()),axis=geometry.Axis?scope.own(geometry.Axis()):null,direction=axis?scope.own(axis.Direction()):null;
      const result={origin:[location.X(),location.Y(),location.Z()]};if(direction)result.axis=[direction.X(),direction.Y(),direction.Z()];
      for(const [method,key]of [['Radius','radius'],['MajorRadius','majorRadius'],['MinorRadius','minorRadius'],['SemiAngle','semiAngle']])if(typeof geometry[method]==='function')result[key]=geometry[method]();return result;
    }catch{return null;}finally{scope.close();}
  }
  function packet(shape,scope,config={},metadata={}){
    valid(shape,scope);
    const mesh=shape.mesh(meshOptions(config)),faces=scope.all(shape.faces),edges=scope.all(shape.edges),solids=scope.all(shape.solids);
    if(mesh.triangles.length/3>EXACT_LIMITS.triangles||faces.length>EXACT_LIMITS.faces||edges.length>EXACT_LIMITS.edges)throw Error('Display mesh exceeds the application budget. Increase the display tolerance.');
    if(mesh.vertices.some(x=>!Number.isFinite(x)||Math.abs(x)>1e8))throw Error('Invalid tessellation coordinates.');
    const index=new Map(faces.map((f,i)=>[f.hashCode,i]));
    const faceInfo=faces.map((f,i)=>{
      const center=scope.own(f.center),normal=scope.own(f.normalAt());
      return {index:i,type:f.geomType,center:center.toTuple(),normal:normal.toTuple(),area:r.measureArea(f),orientation:f.orientation,analytic:analyticData(f,true)};
    });
    const edgeMesh=shape.meshEdges(meshOptions(config));
    const edgeInfo=edges.map((e,i)=>({index:i,type:e.geomType,length:e.length,start:scope.own(e.startPoint).toTuple(),end:scope.own(e.endPoint).toTuple(),center:scope.own(e.pointAt(.5)).toTuple(),analytic:analyticData(e,false)}));
    const ep=new Map(edges.map((e,i)=>[e.hashCode,i]));
    const box=scope.own(shape.boundingBox);
    let volume=0,center=null;
    if(solids.length){for(const solid of solids){const prop=scope.own(r.measureShapeVolumeProperties(solid));const v=Math.abs(prop.volume);center=V.add(center||[0,0,0],V.mul(prop.centerOfMass,v));volume+=v;}if(volume>1e-12)center=V.mul(center,1/volume);}
    const area=faceInfo.reduce((a,f)=>a+f.area,0);if(!center){const surfaceProperties=scope.own(r.measureShapeSurfaceProperties(shape));center=surfaceProperties.centerOfMass;}
    return {version:EXACT_VERSION,brep:shape.serialize(),pose:M.identity(),mesh:{vertices:mesh.vertices,normals:mesh.normals,triangles:mesh.triangles,faceGroups:mesh.faceGroups.map(g=>({...g,index:index.get(g.faceId)??-1}))},edgeLines:edgeMesh.lines,edgeGroups:edgeMesh.edgeGroups.map(g=>({...g,index:ep.get(g.edgeId)??-1})),faces:faceInfo,edges:edgeInfo,properties:{area,volume,centroid:center,bounds:box.bounds,solidCount:solids.length,faceCount:faces.length,edgeCount:edges.length,valid:true},...metadata};
  }
  function sketch(profile,scope){
    if(!profile||typeof profile!=='object')throw Error('Missing sketch profile.');
    const origin=profile.origin??0,plane=profile.plane||'XY';
    if(!['XY','XZ','YZ'].includes(plane))throw Error('Unsupported sketch plane.');
    const config={plane,origin:typeof origin==='number'?number(origin,'Plane offset'):point(origin)};
    if(profile.type==='circle')return scope.own(r.sketchCircle(positive(profile.radius,'Radius'),config));
    if(profile.type==='ellipse')return scope.own(r.sketchEllipse(positive(profile.rx,'X radius'),positive(profile.ry,'Y radius'),config));
    if(profile.type==='rectangle')return scope.own(r.drawRectangle(positive(profile.width,'Width'),positive(profile.height,'Height')).sketchOnPlane(plane,origin));
    const pts=profile.points;
    if(!Array.isArray(pts)||pts.length<3||pts.length>4096)throw Error('A profile needs 3–4096 points.');
    pts.forEach(p=>{if(!Array.isArray(p)||p.length!==2)throw Error('Invalid profile point.');p.forEach(v=>number(v,'Profile coordinate'));});
    let pen=r.draw(pts[0]);for(const p of pts.slice(1))pen=pen.lineTo(p);
    return scope.own(pen.close().sketchOnPlane(plane,origin));
  }
  function primitive(args,scope){
    const p=args.parameters||args,at=point(p.center||[0,0,0]);let s;
    switch(args.kind){
      case 'box':{const size=[positive(p.width??p.w??40,'Width'),positive(p.depth??p.d??30,'Depth'),positive(p.height??p.h??25,'Height')];s=r.makeBox(V.sub(at,V.mul(size,.5)),V.add(at,V.mul(size,.5)));break;}
      case 'cylinder':s=r.makeCylinder(positive(p.radius??15,'Radius'),positive(p.height??30,'Height'),V.sub(at,[0,0,(p.height??30)/2]),[0,0,1]);break;
      case 'sphere':s=r.makeSphere(positive(p.radius??20,'Radius')).translate(at);break;
      case 'cone':{const radius=positive(p.radius??20,'Radius'),top=number(p.topRadius??0,'Top radius',0,1e6),height=positive(p.height??35,'Height');const profile=[[0,-height/2],[radius,-height/2],...(top>0?[[top,height/2]]:[]),[0,height/2]];s=sketch({points:profile,plane:'XZ'},scope).revolve([0,0,1],{origin:[0,0,0],angle:360}).translate(at);break;}
      case 'torus':{const major=positive(p.major??22,'Major radius'),minor=number(p.minor??5,'Minor radius',.001,major-.001);const maker=scope.own(new oc.BRepPrimAPI_MakeTorus(major,minor));s=r.cast(maker.Shape()).translate(at);break;}
      case 'tube':{const ro=positive(p.outer??20,'Outer radius'),ri=number(p.inner??14,'Inner radius',.001,ro-.001),h=positive(p.height??30,'Height');const a=scope.own(r.makeCylinder(ro,h)),b=scope.own(r.makeCylinder(ri,h));s=a.cut(b).translate(V.sub(at,[0,0,h/2]));break;}
      default:throw Error('Unknown exact primitive: '+args.kind);
    }
    return scope.own(s);
  }
  function edgeList(shape,ids,scope){
    const all=scope.all(shape.edges);
    if(!Array.isArray(ids)||!ids.length)return all;
    if(ids.length>all.length||ids.some(i=>!Number.isInteger(i)||i<0||i>=all.length))throw Error('An edge reference is invalid. Reselect edges after topology changes.');
    return [...new Set(ids)].map(i=>all[i]);
  }
  function faceList(shape,ids,scope){
    const all=scope.all(shape.faces);
    if(!Array.isArray(ids)||!ids.length)throw Error('Select at least one exact face.');
    if(ids.some(i=>!Number.isInteger(i)||i<0||i>=all.length))throw Error('A face reference is invalid. Reselect faces after topology changes.');
    return [...new Set(ids)].map(i=>all[i]);
  }
  function nurbs(input,scope){
    const d=validateNURBS(input),nu=d.poles.length,nv=d.poles[0].length;
    const poles=scope.own(new oc.NCollection_Array2_gp_Pnt(1,nu,1,nv)),weights=scope.own(new oc.NCollection_Array2_double(1,nu,1,nv));
    d.poles.forEach((row,i)=>row.forEach((p,j)=>{const q=scope.own(new oc.gp_Pnt(...p));poles.SetValue(i+1,j+1,q);weights.SetValue(i+1,j+1,d.weights[i][j]);}));
    const arr=(type,values)=>{const a=scope.own(new type(1,values.length));values.forEach((x,i)=>a.SetValue(i+1,x));return a;};
    const surface=scope.own(new oc.Geom_BSplineSurface(poles,weights,arr(oc.NCollection_Array1_double,d.uKnots),arr(oc.NCollection_Array1_double,d.vKnots),arr(oc.NCollection_Array1_int,d.uMultiplicities),arr(oc.NCollection_Array1_int,d.vMultiplicities),d.uDegree,d.vDegree,false,false));
    const maker=scope.own(new oc.BRepBuilderAPI_MakeFace(surface,1e-7));
    if(!maker.IsDone())throw Error('Cannot construct the trimmed NURBS face.');
    return scope.own(r.cast(maker.Face()));
  }
  async function readSTEP(data,scope){
    if(typeof data!=='string'||data.length>EXACT_LIMITS.fileBytes||!data.includes('ISO-10303-21'))throw Error('Invalid or oversized STEP file.');
    const filename=`/avolith-${++sequence}.step`;const reader=scope.own(new oc.STEPControl_Reader());
    oc.FS.writeFile(filename,data);
    try{
      const status=reader.ReadFile(filename);
      if(status!==oc.IFSelect_ReturnStatus.IFSelect_RetDone)throw Error('The STEP reader could not parse this file.');
      const transferred=reader.TransferRoots();if(!transferred)throw Error('No STEP roots could be transferred.');
      return scope.own(r.cast(reader.OneShape()));
    }finally{oc.FS.unlink(filename);}
  }
  async function run(command,args={}){
    const scope=new Scope();const started=performance.now();
    try{
      let result,metadata={};
      if(command==='sheetMetal'){const sheet=makeExactSheet(r,scope,args.definition,!!args.flat);result=sheet.shape;if(args.pose)result=applyPose(result,args.pose,scope);metadata={sheetDefinition:sheet.layout.definition,sheetFlat:!!args.flat,sheetPose:args.pose||M.identity(),bendTable:sheet.layout.bendTable,flatLength:sheet.layout.flatLength};}
      else if(command==='primitive')result=primitive(args,scope);
      else if(command==='facetBrep'){
        if(!Array.isArray(args.polygons)||!args.polygons.length||args.polygons.length>5000)throw Error('Planar B-rep conversion supports 1–5,000 polygons per operation.');
        const faces=args.polygons.map(poly=>{if(!Array.isArray(poly)||poly.length<3||poly.length>256)throw Error('Invalid mesh polygon.');const pts=poly.map(p=>point(p)),edges=scope.all(pts.map((p,i)=>r.makeLine(p,pts[(i+1)%pts.length]))),wire=scope.own(r.assembleWire(edges));return scope.own(r.makeFace(wire));});result=scope.own(r.makeSolid(faces));metadata={reconstruction:'planar faces from mesh; no curved-surface recovery'};
      }
      else if(command==='nurbs'){result=nurbs(args,scope);metadata.surfaceDefinition=validateNURBS(args);}
      else if(command==='extrude'){
        const s=sketch(args.profile,scope);const opts={};
        if(args.direction)opts.extrusionDirection=direction(args.direction);
        if(args.twist)opts.twistAngle=number(args.twist,'Twist angle',-3600,3600);
        if(args.endFactor!==undefined)opts.extrusionProfile={profile:'linear',endFactor:positive(args.endFactor,'End factor')};
        result=scope.own(s.extrude(number(args.distance??20,'Extrusion distance',-1e6,1e6),opts));
      }else if(command==='revolve')result=scope.own(sketch(args.profile,scope).revolve(direction(args.axis||[0,0,1]),{origin:point(args.origin||[0,0,0]),angle:number(args.angle??360,'Angle',.001,360)}));
      else if(command==='loft'){
        if(!Array.isArray(args.profiles)||args.profiles.length<2||args.profiles.length>50)throw Error('Loft requires 2–50 profiles.');
        const ss=args.profiles.map(p=>sketch(p,scope));result=scope.own(ss[0].loftWith(ss.slice(1),{ruled:!!args.ruled},!!args.surface));
      }else if(command==='sweep'){
        if(!Array.isArray(args.path)||args.path.length<2||args.path.length>512)throw Error('Sweep path needs 2–512 points.');
        const pts=args.path.map(p=>point(p));const es=pts.slice(1).map((p,i)=>scope.own(r.makeLine(pts[i],p)));
        const wire=scope.own(r.assembleWire(es)),spine=scope.own(new r.Sketch(wire,{defaultOrigin:pts[0],defaultDirection:Math.abs(direction(V.sub(pts[1],pts[0]))[2])<.9?[0,0,1]:[0,1,0]}));
        result=scope.own(spine.sweepSketch(plane=>r.sketchCircle(positive(args.radius??3,'Sweep radius'),{plane}),{transitionMode:'round'}));
      }else if(command==='importSTEP'){
        result=await readSTEP(args.data,scope);
      }else if(command==='importBREP')result=load({brep:args.data},scope);
      else if(command==='sew'){
        if(!Array.isArray(args.shapes)||args.shapes.length<1||args.shapes.length>500)throw Error('Select faces/shells to sew.');
        const shapes=args.shapes.map(s=>load(s,scope)),faces=shapes.flatMap(s=>scope.all(s.faces));
        result=scope.own(args.solid?r.makeSolid(faces):r.weldShellsAndFaces(faces));
      }else if(command==='exportSTEP'){
        if(!Array.isArray(args.shapes)||!args.shapes.length||args.shapes.length>500)throw Error('Select exact bodies to export.');
        const shapes=args.shapes.map((s,i)=>({shape:load(s,scope),name:String(s.name||`Body ${i+1}`).slice(0,200),color:/^#[a-f0-9]{6}$/i.test(s.color)?s.color:'#7e9ca9'}));
        if(args.bridge){
          const writer=scope.own(new oc.STEPControl_Writer()),filename=`/bridge-${++sequence}.step`;
          oc.Interface_Static.SetIVal('write.step.schema',3);oc.Interface_Static.SetCVal('write.step.unit','MM');
          try{for(const {shape} of shapes)if(writer.Transfer(shape.wrapped,oc.STEPControl_StepModelType.STEPControl_AsIs,true)!==oc.IFSelect_ReturnStatus.IFSelect_RetDone)throw Error('STEP bridge transfer failed.');
          if(writer.Write(filename)!==oc.IFSelect_ReturnStatus.IFSelect_RetDone)throw Error('STEP bridge write failed.');
          return {data:oc.FS.readFile(filename,{encoding:'utf8'}),mime:'application/step',extension:'step'};
          }finally{try{oc.FS.unlink(filename);}catch{}oc.Interface_Static.SetIVal('write.step.schema',5);}
        }
        const blob=r.exportSTEP(shapes,{unit:'MM',modelUnit:'MM'});
        return {data:await blob.text(),mime:'application/step',extension:'step',elapsedMs:performance.now()-started};
      }else if(command==='projection'){
        if(!Array.isArray(args.shapes)||!args.shapes.length)throw Error('Select exact bodies for hidden-line projection.');
        const shapes=args.shapes.map(s=>load(s,scope));const compound=scope.own(r.makeCompound(shapes));
        const views=[];
        for(const view of (args.views||['front','top','right'])){
          if(!['front','back','top','bottom','left','right'].includes(view))throw Error('Invalid projection view.');
          const drawings=r.drawProjection(compound,view);
          scope.own(drawings.visible);scope.own(drawings.hidden);
          views.push({name:view,visible:drawings.visible.toSVGPaths().flat(Infinity),hidden:drawings.hidden.toSVGPaths().flat(Infinity),viewBox:drawings.visible.toSVGViewBox(2)});
        }
        return {views,elapsedMs:performance.now()-started};
      }else{
        const s=load(args.shape,scope);
        switch(command){
          case 'mesh':case 'properties':result=s;break;
          case 'boolean':{const t=load(args.tool,scope);if(!['union','subtract','intersect'].includes(args.operation))throw Error('Invalid Boolean operation.');result=scope.own(args.operation==='union'?s.fuse(t):args.operation==='subtract'?s.cut(t):s.intersect(t));break;}
          case 'fillet':case 'chamfer':{
            const edges=edgeList(s,args.edges,scope),radius=positive(args.radius??2,'Radius/distance');
            const finder=scope.own(new r.EdgeFinder()).inList(edges.map(e=>e.clone()));
            result=scope.own(s[command]({radius,filter:finder,keep:true}));break;
          }
          case 'shell':{
            const faces=faceList(s,args.faces,scope),t=number(args.thickness??-2,'Shell thickness',-1e5,1e5);if(Math.abs(t)<1e-5)throw Error('Shell thickness cannot be zero.');
            result=scope.own(s.shell(t,f=>f.inList(faces.map(x=>x.clone())),number(args.tolerance??1e-5,'Shell tolerance',1e-8,.01)));break;
          }
          case 'draft':{const faces=faceList(s,args.faces,scope);result=scope.own(s.draft(number(args.angle??3,'Draft angle',-80,80),f=>f.inList(faces.map(x=>x.clone())),args.plane||'XY'));break;}
          case 'transform':result=applyPose(s,args.matrix,scope);break;
          case 'split':{
            if(!['XY','XZ','YZ'].includes(args.plane))throw Error('Invalid split plane.');
            const split=s.split(args.plane,number(args.offset??0,'Plane offset'),number(args.tolerance??1e-6,'Tolerance',1e-8,.01));
            const parts=[split.positive,split.negative].filter(Boolean).map(p=>scope.own(p));
            if(parts.length<2)throw Error('The plane does not split this solid into two nonempty sides.');
            return {shapes:parts.map(p=>packet(p,scope,args)),elapsedMs:performance.now()-started};
          }
          case 'offsetSurface':{
            const selected=faceList(s,args.faces,scope);if(selected.length!==1)throw Error('Select one face for surface offset.');
            result=scope.own(r.makeOffset(selected[0],number(args.distance??2,'Offset distance')));break;
          }
          case 'thicken':{
            if(scope.all(s.solids).length)throw Error('Thicken expects an open face or shell, not a solid.');
            const maker=scope.own(new oc.BRepOffsetAPI_MakeThickSolid());
            const thickness=number(args.thickness??2,'Thickness',-1e5,1e5);if(Math.abs(thickness)<1e-5)throw Error('Thickness cannot be zero.');
            maker.MakeThickSolidBySimple(s.wrapped,thickness);
            if(!maker.IsDone())throw Error('Surface thickening failed.');result=scope.own(r.cast(maker.Shape()));if(!scope.all(result.solids).length)throw Error('Thickening did not form a solid.');break;
          }
          case 'faceExtrude':{
            const faces=faceList(s,args.faces,scope);if(faces.length!==1)throw Error('Select one planar face.');const face=faces[0];if(face.geomType!=='PLANE')throw Error('Face extrusion requires an analytic planar face.');
            const d=number(args.distance??5,'Pull distance',-1e5,1e5);if(Math.abs(d)<1e-5)throw Error('Pull distance cannot be zero.');const n=scope.own(face.normalAt()).toTuple();
            const prism=scope.own(r.basicFaceExtrusion(scope.own(face.clone()),scope.own(new r.Vector(V.mul(n,d)))));result=scope.own(d>0?s.fuse(prism):s.cut(prism));break;
          }
          case 'interference':{const other=load(args.other,scope),distance=r.measureDistanceBetween(s,other);let volume=0;if(distance<1e-7){const common=scope.own(s.intersect(other));for(const solid of scope.all(common.solids)){const p=scope.own(r.measureShapeVolumeProperties(solid));volume+=p.volume;}}return {distance,volume,interfering:volume>1e-8,units:'mm',volumeUnits:'mm3'};}
          case 'distance':{const other=load(args.tool,scope);return {distance:r.measureDistanceBetween(s,other),elapsedMs:performance.now()-started};}
          default:throw Error('Unsupported exact command: '+command);
        }
      }
      return {...packet(result,scope,args,metadata),elapsedMs:performance.now()-started};
    }catch(error){
      if(typeof error==='number')throw Error(`The CAD kernel rejected this operation (native error ${error}). Check topology, clearances and parameter sizes.`);
      throw error;
    }finally{scope.close();}
  }
  Object.assign(engine,{run});return engine;
}
