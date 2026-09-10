/** Additional native operations. Parameters are in mm/radians unless stated.
 * Every editing result passes the parent engine's BRepCheck_Analyzer gate.
 */
import {V} from '../core/math.js';
export const PRECISION_COMMANDS=new Set(['filletLaw','chamferTwo','trimSurface','surfaceSample','heal','splitByBody','section','offsetSolid','fitSurface']);
const real=(v,name,min=-1e7,max=1e7)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${name} must be in [${min}, ${max}].`);return v;};
const p3=(p)=>{if(!Array.isArray(p)||p.length!==3)throw Error('Expected three coordinates.');return p.map(v=>real(v,'Coordinate'));};
const tuple=p=>[p.X(),p.Y(),p.Z()];
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area2=ps=>ps.reduce((s,a,i)=>{const b=ps[(i+1)%ps.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
const dist2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function intersects(a,b,c,d){const e=1e-10,c1=cross2(a,b,c),c2=cross2(a,b,d),c3=cross2(c,d,a),c4=cross2(c,d,b);if(c1*c2<0&&c3*c4<0)return true;const on=(p,q,r)=>Math.abs(cross2(p,q,r))<e&&r[0]>=Math.min(p[0],q[0])-e&&r[0]<=Math.max(p[0],q[0])+e&&r[1]>=Math.min(p[1],q[1])-e&&r[1]<=Math.max(p[1],q[1])+e;return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function inside(p,ps){let result=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
/** Returns simple, non-touching UV loops with outer CCW and holes CW. */
export function validateTrimLoops(loops,bounds){
  if(!Array.isArray(loops)||!loops.length||loops.length>33)throw Error('Use one outer trim loop and at most 32 holes.');
  let count=0;
  const result=loops.map((loop,index)=>{
    if(!Array.isArray(loop)||loop.length<3||loop.length>512||(count+=loop.length)>4096)throw Error('Each trim loop needs 3–512 UV points (4096 total).');
    let ps=loop.map(p=>{if(!Array.isArray(p)||p.length!==2)throw Error('Trim coordinates must be [u,v].');return p.map(x=>real(x,'UV parameter'));});
    if(dist2(ps[0],ps.at(-1))<1e-10)ps.pop();if(ps.length<3)throw Error('Degenerate trim loop.');
    for(let i=0;i<ps.length;i++){
      const a=ps[i],b=ps[(i+1)%ps.length];if(dist2(a,b)<1e-10)throw Error('Trim edges cannot have zero length.');
      if(bounds&&(a[0]<bounds[0]-1e-10||a[0]>bounds[1]+1e-10||a[1]<bounds[2]-1e-10||a[1]>bounds[3]+1e-10))throw Error('Trim point lies outside the source face UV bounds.');
      for(let j=i+1;j<ps.length;j++){if(j===i+1||(i===0&&j===ps.length-1))continue;if(intersects(a,b,ps[j],ps[(j+1)%ps.length]))throw Error('Trim loop crosses or touches itself.');}
    }
    const a=area2(ps);if(Math.abs(a)<1e-12)throw Error('Trim loop area is zero.');if((a>0)!==(index===0))ps=ps.reverse();return ps;
  });
  for(let i=1;i<result.length;i++){
    if(!inside(result[i][0],result[0]))throw Error('Trim holes must be inside the outer loop.');
    for(let j=0;j<i;j++){
      const a=result[i],b=result[j];for(let k=0;k<a.length;k++)for(let l=0;l<b.length;l++)if(intersects(a[k],a[(k+1)%a.length],b[l],b[(l+1)%b.length]))throw Error('Trim loops must not cross or touch.');
      if(j&& (inside(a[0],b)||inside(b[0],a)))throw Error('Nested or overlapping trim holes are not supported.');
    }
  }return result;
}
export function validateRadiusLaw(stations){
  if(!Array.isArray(stations)||stations.length<2||stations.length>64)throw Error('Radius law needs 2–64 [fraction,radius] stations.');
  const law=stations.map((p,i)=>{if(!Array.isArray(p)||p.length!==2)throw Error('Each radius station is [fraction,radius].');const u=real(p[0],'Edge fraction',0,1),r=real(p[1],'Fillet radius',1e-5,1e5);if(i&&u<=stations[i-1][0])throw Error('Radius fractions must strictly increase.');return [u,r];});
  if(law[0][0]!==0||law.at(-1)[0]!==1)throw Error('Radius law must include fractions 0 and 1.');return law;
}
function curveSamples(edge,tolerance){
  const at=t=>{const p=edge.pointAt(t);try{return p.toTuple();}finally{p.delete();}},out=[];let budget=4096;
  function segment(t0,p0,t1,p1,depth){const tm=(t0+t1)/2,pm=at(tm),chord=V.mul(V.add(p0,p1),.5);if(depth<12&&budget-->0&&V.dist(pm,chord)>tolerance){segment(t0,p0,tm,pm,depth+1);segment(tm,pm,t1,p1,depth+1);}else out.push(p1);}
  let previous=at(0);out.push(previous);for(let i=1;i<=4;i++){const next=at(i/4);segment((i-1)/4,previous,i/4,next,0);previous=next;}return out;
}
function connectLoops(curves,tolerance){
  const todo=curves.map(c=>c.slice()),loops=[];
  while(todo.length){let points=todo.shift(),progress=true;while(progress&&V.dist(points[0],points.at(-1))>tolerance){progress=false;for(let i=0;i<todo.length;i++){const c=todo[i];if(V.dist(points.at(-1),c[0])<=tolerance){points.push(...c.slice(1));todo.splice(i,1);progress=true;break;}if(V.dist(points.at(-1),c.at(-1))<=tolerance){points.push(...c.slice().reverse().slice(1));todo.splice(i,1);progress=true;break;}}}loops.push({points,closed:V.dist(points[0],points.at(-1))<=tolerance});}return loops;
}
export async function precisionOperation(command,args,api){
  const {oc,r,scope,load,packet,faceList,edgeList}=api;const display={...args,tolerance:args.displayTolerance??.12,angularTolerance:args.displayAngularTolerance??.22};
  if(command==='fitSurface'){
    const grid=args.points;if(!Array.isArray(grid)||grid.length<2||grid.length>64||!Array.isArray(grid[0])||grid[0].length<2||grid[0].length>64)throw Error('Surface fitting needs a rectangular 2–64 by 2–64 point grid.');
    const rows=grid.length,cols=grid[0].length,points=scope.own(new oc.NCollection_Array2_gp_Pnt(1,rows,1,cols));
    grid.forEach((row,i)=>{if(!Array.isArray(row)||row.length!==cols)throw Error('Point grid must be rectangular.');row.forEach((p,j)=>points.SetValue(i+1,j+1,scope.own(new oc.gp_Pnt(...p3(p)))));});
    const maker=scope.own(new oc.GeomAPI_PointsToBSplineSurface());
    if(args.interpolate!==false)maker.Interpolate(points);
    else maker.Init(points,3,8,oc.GeomAbs_Shape.GeomAbs_C2,real(args.fitTolerance??.01,'Fit tolerance',1e-7,10));
    if(!maker.IsDone())throw Error('Surface fit failed: check ordered, nondegenerate point rows.');
    const surf=scope.own(maker.Surface()),face=scope.own(new oc.BRepBuilderAPI_MakeFace(surf,1e-7));
    if(!face.IsDone())throw Error('Fitted surface could not form a valid face.');
    return packet(scope.own(r.cast(face.Shape())),scope,display,{fitDefinition:{points:grid,interpolate:args.interpolate!==false,tolerance:args.fitTolerance??.01}});
  }
  const s=load(args.shape,scope,command==='heal');let result;
  const oneFace=()=>{const f=faceList(s,args.faces??[0],scope);if(f.length!==1)throw Error('Select exactly one source face.');return f[0];};
  const finished=maker=>{if(!maker.IsDone())throw Error(`${command}: native operation failed; reduce distances or change the selection.`);return scope.own(r.cast(maker.Shape()));};
  if(command==='filletLaw'){
    const edges=edgeList(s,args.edges,scope),law=validateRadiusLaw(args.stations||[[0,1],[1,3]]),maker=scope.own(new oc.BRepFilletAPI_MakeFillet(s.wrapped));
    const samples=scope.own(new oc.NCollection_Array1_gp_Pnt2d(1,law.length));law.forEach(([u,v],i)=>samples.SetValue(i+1,scope.own(new oc.gp_Pnt2d(u,v))));
    for(const e of edges)maker.Add(samples,e.wrapped);maker.Build();result=finished(maker);
  }else if(command==='chamferTwo'){
    const face=oneFace(),edges=edgeList(s,args.edges,scope),adjacent=new Set(scope.all(face.edges).map(e=>e.hashCode));
    if(edges.some(e=>!adjacent.has(e.hashCode)))throw Error('The reference face must bound every selected edge.');
    const maker=scope.own(new oc.BRepFilletAPI_MakeChamfer(s.wrapped)),d1=real(args.distance1??2,'First chamfer distance',1e-5,1e5),d2=real(args.distance2??4,'Second chamfer distance',1e-5,1e5);
    for(const e of edges)maker.Add(d1,d2,e.wrapped,face.wrapped);maker.Build();result=finished(maker);
  }else if(command==='trimSurface'){
    const face=oneFace(),surface=scope.own(oc.BRep_Tool.Surface(face.wrapped)),bounds=oc.BRepTools.UVBounds(face.wrapped),range=[bounds.UMin,bounds.UMax,bounds.VMin,bounds.VMax];
    const loops=validateTrimLoops(args.loops,range),wires=[];
    for(const loop of loops){const edges=[];for(let i=0;i<loop.length;i++){
      const p=loop[i],q=loop[(i+1)%loop.length],delta=[q[0]-p[0],q[1]-p[1]],len=Math.hypot(...delta);
      const origin=scope.own(new oc.gp_Pnt2d(...p)),dir=scope.own(new oc.gp_Dir2d(...delta)),line=scope.own(new oc.Geom2d_Line(origin,dir)),curve=scope.own(new oc.Geom2d_TrimmedCurve(line,0,len,true,false));
      const maker=scope.own(new oc.BRepBuilderAPI_MakeEdge(curve,surface)),edge=finished(maker);if(!oc.BRepLib.BuildCurves3d(edge.wrapped))throw Error('Could not lift UV curve to the surface.');edges.push(edge);
    }wires.push(scope.own(r.assembleWire(edges)));}
    const maker=scope.own(new oc.BRepBuilderAPI_MakeFace(surface,wires[0].wrapped,true));for(const w of wires.slice(1))maker.Add(w.wrapped);result=finished(maker);
    return packet(result,scope,display,{trimDefinition:{loops,sourceBounds:range},sourceOperation:'parametric UV trim'});
  }else if(command==='surfaceSample'){
    const face=oneFace(),surf=scope.own(oc.BRep_Tool.Surface(face.wrapped)),b=oc.BRepTools.UVBounds(face.wrapped),uv=args.parameters||[[(b.UMin+b.UMax)/2,(b.VMin+b.VMax)/2]];
    if(!Array.isArray(uv)||!uv.length||uv.length>4096)throw Error('Use 1–4096 UV samples.');
    const pts=uv.map(pair=>{
      if(!Array.isArray(pair)||pair.length!==2)throw Error('Surface sample must be [u,v].');
      const u=real(pair[0],'U',b.UMin,b.UMax),v=real(pair[1],'V',b.VMin,b.VMax),p=scope.own(new oc.gp_Pnt()),du=scope.own(new oc.gp_Vec()),dv=scope.own(new oc.gp_Vec()),duu=scope.own(new oc.gp_Vec()),dvv=scope.own(new oc.gp_Vec()),duv=scope.own(new oc.gp_Vec());
      surf.D2(u,v,p,du,dv,duu,dvv,duv);
      const U=tuple(du),W=tuple(dv),N=V.cross(U,W),length=V.len(N);if(length<1e-12)throw Error('A sample lies on a singular surface parameter.');const normal=V.mul(N,1/length),E=V.dot(U,U),F=V.dot(U,W),G=V.dot(W,W),L=V.dot(normal,tuple(duu)),D=V.dot(normal,tuple(duv)),Q=V.dot(normal,tuple(dvv)),den=E*G-F*F,H=(E*Q-2*F*D+G*L)/(2*den),K=(L*Q-D*D)/den,root=Math.sqrt(Math.max(0,H*H-K));
      return {uv:[u,v],point:tuple(p),du:U,dv:W,parameterNormal:normal,meanCurvature:H,gaussianCurvature:K,principalCurvatures:[H+root,H-root]};
    });return {surfaceType:face.geomType,bounds:b,samples:pts,normalConvention:'dS/du cross dS/dv; not necessarily outward',trimMembership:'Samples are evaluated on the supporting surface; holes are not membership-tested.'};
  }else if(command==='heal'){
    const tolerance=real(args.tolerance??1e-6,'Repair tolerance',1e-9,.01),solids=scope.all(s.solids);let fixed=[];
    if(solids.length){for(const solid of solids){const tool=scope.own(new oc.ShapeFix_Solid(solid.wrapped));tool.SetPrecision(tolerance);tool.SetMinTolerance(1e-9);tool.SetMaxTolerance(tolerance);tool.Perform();fixed.push(scope.own(r.cast(tool.Solid())));}}
    else {for(const face of scope.all(s.faces)){const tool=scope.own(new oc.ShapeFix_Face(face.wrapped));tool.SetPrecision(tolerance);tool.SetMaxTolerance(tolerance);tool.Perform();fixed.push(scope.own(r.cast(tool.Face())));}if(fixed.length)fixed=[scope.own(r.weldShellsAndFaces(fixed))];}
    if(!fixed.length)throw Error('No faces or solids to repair.');const compound=fixed.length===1?fixed[0]:scope.own(r.makeCompound(fixed));
    const unify=scope.own(new oc.ShapeUpgrade_UnifySameDomain(compound.wrapped,true,true,true));unify.SetLinearTolerance(tolerance);unify.SetAngularTolerance(real(args.angularTolerance??1e-7,'Angular tolerance',1e-10,.01));unify.SetSafeInputMode(true);unify.Build();result=scope.own(r.cast(unify.Shape()));
    return packet(result,scope,display,{repairReport:{tolerance,sourceFaces:scope.all(s.faces).length,operations:['wire and orientation fixing','same-domain face/edge unification'],warning:'Not a reconstruction of missing surfaces or design intent.'}});
  }else if(command==='splitByBody'){
    const tools=args.tools||[args.tool];if(!Array.isArray(tools)||!tools.length||tools.length>20)throw Error('Select 1–20 cutting bodies.');
    const objects=scope.own(new oc.NCollection_List_TopoDS_Shape()),cutters=scope.own(new oc.NCollection_List_TopoDS_Shape());objects.Append(s.wrapped);tools.forEach(t=>cutters.Append(load(t,scope).wrapped));
    const splitter=scope.own(new oc.BRepAlgoAPI_Splitter());splitter.SetArguments(objects);splitter.SetTools(cutters);splitter.SetNonDestructive(true);splitter.SetFuzzyValue(real(args.tolerance??1e-7,'Split tolerance',1e-9,.001));splitter.Build();const shape=finished(splitter),parts=scope.all(shape.solids);
    if(parts.length<2)throw Error('The cutting bodies did not divide the source into separate solids.');return {shapes:parts.map(p=>packet(p,scope,display)),count:parts.length};
  }else if(command==='section'){
    const origin=p3(args.origin||[0,0,0]),normal=p3(args.normal||[0,0,1]);if(V.len(normal)<1e-10)throw Error('Section normal is zero.');
    const axis=scope.own(new oc.gp_Dir(...normal)),location=scope.own(new oc.gp_Pnt(...origin)),plane=scope.own(new oc.gp_Pln(location,axis)),maker=scope.own(new oc.BRepAlgoAPI_Section(s.wrapped,plane,false));maker.Approximation(true);maker.ComputePCurveOn1(true);maker.Build();const section=finished(maker),edges=scope.all(section.edges);if(!edges.length)throw Error('The plane does not intersect the source.');
    if(edges.length>2000)throw Error('Section has too many edges for interactive export.');const tolerance=real(args.tolerance??.02,'Section display tolerance',.001,2),curves=edges.map(e=>({type:e.geomType,length:e.length,points:curveSamples(e,tolerance)}));
    return {brep:section.serialize(),plane:{origin,normal:V.norm(normal)},curves,loops:connectLoops(curves.map(c=>c.points),Math.max(1e-6,tolerance*.01)),tolerance,geometry:'Native B-rep intersection curves; polyline export is tolerance-sampled.'};
  }else if(command==='offsetSolid'){
    const offset=real(args.distance??2,'Offset',-1e4,1e4);if(Math.abs(offset)<1e-6)throw Error('Offset cannot be zero.');const maker=scope.own(new oc.BRepOffsetAPI_MakeOffsetShape());
    maker.PerformByJoin(s.wrapped,offset,real(args.tolerance??1e-6,'Offset tolerance',1e-9,.001),oc.BRepOffset_Mode.BRepOffset_Skin,false,false,oc.GeomAbs_JoinType.GeomAbs_Arc,true);result=finished(maker);
  }else throw Error('Unsupported precision operation.');
  return packet(result,scope,display);
}
