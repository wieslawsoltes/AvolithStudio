/** Analytic edge-flange panels with explicit open corners, bend allowance and flat cutouts. */
import {cleanProfile} from '../core/kernel.js';
import {makeExactSheet} from './sheet-metal.js';
const num=(v,n,a,b)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<a||v>b)throw Error(`${n} must be in [${a}, ${b}].`);return v;};
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const distanceSegment=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const crosses=(a,b,c,d)=>{const o=[orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)];return o[0]*o[1]<=1e-12&&o[2]*o[3]<=1e-12&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))+1e-9&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))+1e-9;};
const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
export function panelLayout(input){
  const d=structuredClone(input||{}),original=d.outline||[[0,0],[100,0],[100,70],[0,70]];
  if(!Array.isArray(original)||original.length<3||original.length>64||original.some(p=>!Array.isArray(p)||p.length!==2||!p.every(x=>typeof x==='number'&&Number.isFinite(x)))||area(original)<=0)throw Error('Panel outline must have 3–64 vertices ordered counterclockwise.');
  d.outline=cleanProfile(original);if(d.outline.length!==original.length)throw Error('Remove coincident or collinear outline vertices before assigning edge flanges.');
  d.thickness=num(d.thickness??2,'Thickness',.05,100);d.kFactor=num(d.kFactor??.42,'K factor',0,1);d.grainAngle=num(d.grainAngle??0,'Grain angle',-360,360);
  d.flanges=d.flanges||[];if(!Array.isArray(d.flanges)||d.flanges.length>64)throw Error('At most 64 edge flanges.');const used=new Set();
  const bends=d.flanges.map((f,i)=>{
    if(!Number.isInteger(f.edge)||!d.outline[f.edge]||used.has(f.edge))throw Error('Each flange needs a unique existing outline edge.');used.add(f.edge);
    const a=d.outline[f.edge],b=d.outline[(f.edge+1)%d.outline.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]),tangent=[(b[0]-a[0])/L,(b[1]-a[1])/L],outward=[tangent[1],-tangent[0]],gapStart=num(f.gapStart??3,'Start corner relief',.05,L/2),gapEnd=num(f.gapEnd??3,'End corner relief',.05,L/2),width=L-gapStart-gapEnd;
    if(width<=.1)throw Error('Corner relief removes the entire flange.');const length=num(f.length??30,'Tangent flange length',.1,1e4),radius=num(f.radius??3,'Inside bend radius',.05,1e4),angle=num(f.angle??90,'Flange angle',-150,150);if(Math.abs(angle)<1)throw Error('Use a flange angle of at least one degree.');
    const kFactor=num(f.kFactor??d.kFactor,'Bend K factor',0,1),allowance=f.allowance===undefined?Math.abs(angle)*Math.PI/180*(radius+kFactor*d.thickness):num(f.allowance,'Measured bend allowance',.001,1e5),method=f.allowance===undefined?'K-factor':'measured allowance';
    const origin=[a[0]+tangent[0]*(gapStart+width/2),a[1]+tangent[1]*(gapStart+width/2),0],anchor=Math.min(.02,d.thickness/5);
    for(const sign of [-1,0,1])if(!inside([origin[0]+tangent[0]*width/2*sign-outward[0]*anchor,origin[1]+tangent[1]*width/2*sign-outward[1]*anchor],d.outline))throw Error('The flange anchor does not lie inside the base panel. Increase corner relief.');
    return {edge:f.edge,index:i+1,width,length,radius,angle,kFactor,allowance,method,gapStart,gapEnd,origin,tangent,outward,anchor,flatLength:length+allowance,bendLine:allowance/2};
  });
  d.flanges=bends.map(b=>({edge:b.edge,length:b.length,radius:b.radius,angle:b.angle,kFactor:b.kFactor,gapStart:b.gapStart,gapEnd:b.gapEnd,...(b.method==='measured allowance'?{allowance:b.allowance}:{})}));
  if(d.cutouts!==undefined&&(!Array.isArray(d.cutouts)||d.cutouts.length>100))throw Error('At most 100 panel cutouts.');
  d.cutouts=(d.cutouts||[]).map(c=>{
    if(c.kind==='circle'){const radius=num(c.radius,'Cutout radius',.01,1e4);if(!Array.isArray(c.center)||c.center.length!==2)throw Error('Circle center needs x,y.');c.center.forEach(x=>num(x,'Cutout coordinate',-1e6,1e6));if(!inside(c.center,d.outline)||d.outline.some((a,i)=>distanceSegment(c.center,a,d.outline[(i+1)%d.outline.length])<=radius+1e-6))throw Error('Circular cutouts must stay inside the base panel.');return {...c,radius};}
    if(c.kind==='polygon'){const points=cleanProfile(c.points);if(points.length>128||!points.every(p=>inside(p,d.outline))||points.some((a,i)=>d.outline.some((b,j)=>crosses(a,points[(i+1)%points.length],b,d.outline[(j+1)%d.outline.length]))))throw Error('Polygon cutout must remain inside the base panel.');return {kind:'polygon',points};}
    throw Error('Cutouts are circle or polygon profiles.');
  });if(d.cutouts.length>100)throw Error('At most 100 panel cutouts.');
  return {definition:d,bends,baseArea:area(d.outline),estimatedFlatArea:area(d.outline)+bends.reduce((s,b)=>s+b.width*b.flatLength,0),notice:'Open relief corners. Tangent lengths exclude bend arcs. Measured allowances override only flat development; verify with the actual material and tooling.'};
}
function faceOf(r,scope,points){const edges=points.map((p,i)=>scope.own(r.makeLine([...p,0],[...points[(i+1)%points.length],0]))),wire=scope.own(r.assembleWire(edges));return scope.own(r.makeFace(wire));}
export function makePanel(r,scope,input,flat=false){
  const layout=panelLayout(input),d=layout.definition,base=faceOf(r,scope,d.outline),axis=scope.own(new r.Vector([0,0,d.thickness]));let shape=scope.own(r.basicFaceExtrusion(base,axis));
  const punches=[];for(const c of d.cutouts){const cut=c.kind==='circle'?scope.own(r.makeCylinder(c.radius,d.thickness+2,[...c.center,-1],[0,0,1])):scope.own(r.basicFaceExtrusion(faceOf(r,scope,c.points),scope.own(new r.Vector([0,0,d.thickness+2])))).translate(0,0,-1);scope.own(cut);punches.push(cut);shape=scope.own(shape.cut(cut));}
  const parts=[];
  for(const b of layout.bends){
    let part;if(flat)part=scope.own(r.makeBox([0,-b.width/2,0],[b.anchor+b.flatLength,b.width/2,d.thickness]));else part=makeExactSheet(r,scope,{width:b.width,thickness:d.thickness,kFactor:b.kFactor,lengths:[b.anchor,b.length],bends:[{radius:b.radius,angle:b.angle}]},false).shape;
    const a=Math.atan2(b.outward[1],b.outward[0])*180/Math.PI;part=scope.own(part.rotate(a,[0,0,0],[0,0,1]));part=scope.own(part.translate([b.origin[0]-b.outward[0]*b.anchor,b.origin[1]-b.outward[1]*b.anchor,0]));
    for(const prior of parts){const overlap=scope.own(part.intersect(prior));if(!overlap.isNull&&r.measureVolume(overlap)>1e-6)throw Error('Flanges overlap. Increase corner gaps, shorten flanges, or change bend angles.');}
    // A flange may share its short anchor with the base; deeper intersection is an invalid fold.
    if(!flat){const overlap=scope.own(part.intersect(shape));if(!overlap.isNull&&r.measureVolume(overlap)>b.anchor*b.width*d.thickness+1e-4)throw Error('A folded flange interferes with the existing panel.');}
    parts.push(part);shape=scope.own(shape.fuse(part));
  }
  const solids=scope.all(shape.solids);if(solids.length!==1)throw Error('Panel did not form one connected solid. Inspect reliefs and cutouts.');return {shape,layout};
}
export function panelBendCSV(input){const l=panelLayout(input);return 'Bend,Edge,Angle_deg,Inside_radius_mm,Width_mm,Tangent_length_mm,Allowance_mm,Method,K_factor,Grain_angle_deg\n'+l.bends.map(b=>[b.index,b.edge,b.angle,b.radius,b.width,b.length,b.allowance,b.method,b.kFactor,l.definition.grainAngle].join(',')).join('\n')+'\n';}
