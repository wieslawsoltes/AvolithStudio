import {V} from '../core/math.js';
const finite=(v,name,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${name} must be between ${min} and ${max}.`);return v;};
const add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,k)=>a.map(v=>v*k),normal=a=>[-Math.sin(a),Math.cos(a)];
export function sheetLayout(input){
  const d=structuredClone(input);d.thickness=finite(d.thickness??2,'Thickness',.01,1000);d.width=finite(d.width??50,'Width',.1,1e5);d.kFactor=finite(d.kFactor??.42,'K factor',0,1);
  if(!Array.isArray(d.lengths)||d.lengths.length<1||d.lengths.length>33)throw Error('Provide 1–33 tangent flange lengths.');
  d.lengths=d.lengths.map(x=>finite(x,'Flange length',.01,1e5));d.bends=d.bends||[];
  if(d.bends.length!==d.lengths.length-1)throw Error('There must be one bend between each pair of flanges.');
  d.bends=d.bends.map(b=>({angle:finite(typeof b==='number'?b:b.angle,'Bend angle',-179.9,179.9),radius:finite(typeof b==='number'?(d.radius??3):b.radius??d.radius??3,'Inside radius',.01,1e5)}));
  if(d.bends.some(b=>Math.abs(b.angle)<.01))throw Error('Remove zero-angle bends rather than making a degenerate bend.');
  let p=[0,d.thickness/2],angle=0,flatLength=0;const path=[],flanges=[],bendTable=[];
  d.lengths.forEach((length,i)=>{
    const tangent=[Math.cos(angle),Math.sin(angle)],end=add(p,mul(tangent,length));
    const line={kind:'line',start:p,end,startAngle:angle,endAngle:angle,length,flatStart:flatLength,index:i};path.push(line);flanges.push(line);flatLength+=length;p=end;
    if(i<d.bends.length){const b=d.bends[i],turn=b.angle*Math.PI/180,sign=Math.sign(turn),radius=b.radius+d.thickness/2,center=add(p,mul(normal(angle),radius*sign)),startRad=angle-sign*Math.PI/2;
      const endAngle=angle+turn,endRad=startRad+turn,end=add(center,[radius*Math.cos(endRad),radius*Math.sin(endRad)]),allowance=Math.abs(turn)*(b.radius+d.kFactor*d.thickness);
      path.push({kind:'arc',start:p,end,center,radius,startRad,turn,startAngle:angle,endAngle});
      bendTable.push({bend:i+1,angle:b.angle,insideRadius:b.radius,allowance,flatStart:flatLength,flatEnd:flatLength+allowance,centerLine:flatLength+allowance/2,setback:(b.radius+d.thickness)*Math.tan(Math.abs(turn)/2),deduction:2*(b.radius+d.thickness)*Math.tan(Math.abs(turn)/2)-allowance});
      flatLength+=allowance;angle=endAngle;p=end;
    }
  });
  const holes=d.holes||[];if(!Array.isArray(holes)||holes.length>500)throw Error('At most 500 flange punches are supported.');
  d.holes=holes.map(h=>{const segment=h.segment;if(!Number.isInteger(segment)||!flanges[segment])throw Error('A punch references a missing flange.');const radius=finite(h.radius??3,'Punch radius',.01,d.width/2),along=finite(h.along,'Punch position',radius,d.lengths[segment]-radius),across=finite(h.across??0,'Punch across position',-d.width/2+radius,d.width/2-radius);if(radius*2>=d.width||radius*2>=d.lengths[segment])throw Error('Punch must be inside its flange, clear of bend tangencies.');return {segment,radius,along,across};});
  for(let i=0;i<d.holes.length;i++){const h=d.holes[i];if(h.along-h.radius<1e-6||d.lengths[h.segment]-h.along-h.radius<1e-6||d.width/2-Math.abs(h.across)-h.radius<1e-6)throw Error('Punches must have positive clearance to flange edges and bend tangencies.');for(let j=0;j<i;j++){const b=d.holes[j];if(h.segment===b.segment&&Math.hypot(h.along-b.along,h.across-b.across)<=h.radius+b.radius+1e-6)throw Error('Overlapping or touching punches are not supported.');}}
  return {definition:d,path,flanges,bendTable,flatLength,flatArea:flatLength*d.width-d.holes.reduce((s,h)=>s+Math.PI*h.radius*h.radius,0)};
}
export function sheetContour(layout,offset){
  return layout.path.map(p=>{
    const start=add(p.start,mul(normal(p.startAngle),offset)),end=add(p.end,mul(normal(p.endAngle),offset));
    if(p.kind==='line')return {...p,start,end};
    const radius=p.radius-Math.sign(p.turn)*offset,midRad=p.startRad+p.turn/2;
    return {...p,start,end,mid:add(p.center,[radius*Math.cos(midRad),radius*Math.sin(midRad)]),radius};
  });
}
function sampledContour(contour){return contour.flatMap(p=>p.kind==='line'?[p.start]:Array.from({length:Math.max(2,Math.ceil(Math.abs(p.turn)*16))},(_,i)=>{const n=Math.max(2,Math.ceil(Math.abs(p.turn)*16)),a=p.startRad+p.turn*i/n;return add(p.center,[p.radius*Math.cos(a),p.radius*Math.sin(a)]);}));}
function selfCrosses(points){const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){if(i===0&&j===points.length-1)continue;const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];if(cross(a,b,c)*cross(a,b,d)<-1e-12&&cross(c,d,a)*cross(c,d,b)<-1e-12)return true;}return false;}
/** Generates analytic lines/arcs and extrudes the closed thickness section. */
export function makeExactSheet(r,scope,input,flat=false){
  const layout=sheetLayout(input),d=layout.definition;let shape;
  if(flat)shape=scope.own(r.makeBox([0,-d.width/2,0],[layout.flatLength,d.width/2,d.thickness]));
  else{
    const up=sheetContour(layout,d.thickness/2),down=sheetContour(layout,-d.thickness/2);
    const sampled=[...sampledContour(up),up.at(-1).end,down.at(-1).end,...sampledContour(down).reverse()];
    if(selfCrosses(sampled))throw Error('The folded strip intersects itself. Increase flange spacing or change bend angles.');
    const v=([x,z])=>[x,-d.width/2,z],edges=[];
    const edge=(p,reverse=false)=>scope.own(p.kind==='arc'?r.makeThreePointArc(v(reverse?p.end:p.start),v(p.mid),v(reverse?p.start:p.end)):r.makeLine(v(reverse?p.end:p.start),v(reverse?p.start:p.end)));
    for(const p of up)edges.push(edge(p));edges.push(scope.own(r.makeLine(v(up.at(-1).end),v(down.at(-1).end))));
    for(const p of down.toReversed())edges.push(edge(p,true));edges.push(scope.own(r.makeLine(v(down[0].start),v(up[0].start))));
    const wire=scope.own(r.assembleWire(edges)),face=scope.own(r.makeFace(wire));shape=scope.own(r.basicFaceExtrusion(face,scope.own(new r.Vector([0,d.width,0]))));
  }
  for(const hole of d.holes){
    const flange=layout.flanges[hole.segment],a=flange.startAngle,tangent=[Math.cos(a),0,Math.sin(a)],n=flat?[0,0,1]:[-Math.sin(a),0,Math.cos(a)],center=flat?[flange.flatStart+hole.along,hole.across,d.thickness/2]:V.add([flange.start[0],hole.across,flange.start[1]],V.mul(tangent,hole.along));
    const cutter=scope.own(r.makeCylinder(hole.radius,d.thickness+2,V.sub(center,V.mul(n,d.thickness/2+1)),n));shape=scope.own(shape.cut(cutter));
  }
  return {shape,layout};
}
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function sheetSVG(input,name='Flat pattern'){
  const l=sheetLayout(input),d=l.definition,L=l.flatLength,W=d.width;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L+20}mm" height="${W+30}mm" viewBox="-10 -10 ${L+20} ${W+30}"><title>${xml(name)}</title><g fill="none" stroke="black" stroke-width=".25"><rect width="${L}" height="${W}"/>${d.holes.map(h=>`<circle cx="${l.flanges[h.segment].flatStart+h.along}" cy="${W/2+h.across}" r="${h.radius}"/>`).join('')}</g><g stroke="black" stroke-width=".15" stroke-dasharray="2 1">${l.bendTable.map(b=>`<path d="M ${b.centerLine} 0 V ${W}"/>`).join('')}</g><g font-family="sans-serif" font-size="2.5">${l.bendTable.map(b=>`<text x="${b.centerLine+1}" y="${W+4}">B${b.bend}: ${b.angle}° R${b.insideRadius}</text>`).join('')}<text y="${W+11}">T ${d.thickness} mm • K ${d.kFactor} • developed ${L.toFixed(3)} mm • tangent-length convention</text></g></svg>`;
}
export function sheetDXF(input){const l=sheetLayout(input),d=l.definition;const out=['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES'];const line=(x,y,X,Y,layer)=>out.push('0','LINE','8',layer,'10',String(x),'20',String(y),'30','0','11',String(X),'21',String(Y),'31','0');const L=l.flatLength,W=d.width;line(0,0,L,0,'CUT');line(L,0,L,W,'CUT');line(L,W,0,W,'CUT');line(0,W,0,0,'CUT');for(const b of l.bendTable)line(b.centerLine,0,b.centerLine,W,b.angle>0?'BEND_UP':'BEND_DOWN');for(const h of d.holes)out.push('0','CIRCLE','8','CUT','10',String(l.flanges[h.segment].flatStart+h.along),'20',String(W/2+h.across),'30','0','40',String(h.radius));out.push('0','ENDSEC','0','EOF');return out.join('\n')+'\n';}
export function sheetBendCSV(input){const l=sheetLayout(input);return 'Bend,Angle_deg,Inside_radius_mm,Allowance_mm,Centerline_mm,Setback_mm,Deduction_mm\n'+l.bendTable.map(b=>[b.bend,b.angle,b.insideRadius,b.allowance,b.centerLine,b.setback,b.deduction].join(',')).join('\n')+'\n';}
