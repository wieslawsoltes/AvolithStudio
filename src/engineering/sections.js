/** Native section curves are authoritative; SVG paths are tolerance-sampled. */
import {V} from '../core/math.js';
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function sectionProjection(section){
  const n=V.norm(section.plane.normal),x=V.norm(V.cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n)),y=V.cross(n,x),origin=section.plane.origin;
  const loops=section.loops.map(loop=>({...loop,points:loop.points.map(p=>{const v=V.sub(p,origin);return [V.dot(v,x),-V.dot(v,y)];})}));
  const pts=loops.flatMap(l=>l.points);if(!pts.length)throw Error('No section geometry.');
  return {loops,xAxis:x,yAxis:y,min:[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1]))],max:[Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))]};
}
export function sectionSVG(section,{name='Section A–A',scale=1,detail=null,dimensions=true}={}){
  if(!Number.isFinite(scale)||scale<=0||scale>100)throw Error('Drawing scale must be positive and at most 100.');
  const p=sectionProjection(section);let min=p.min,max=p.max;
  if(detail){if(!Array.isArray(detail)||detail.length!==4||!detail.every(Number.isFinite)||detail[2]<=0||detail[3]<=0)throw Error('Detail is [x,y,width,height] in section coordinates.');min=detail.slice(0,2);max=[min[0]+detail[2],min[1]+detail[3]];}
  const W=max[0]-min[0],H=max[1]-min[1],margin=20/scale,stroke=.25/scale,font=3/scale;
  const path=loop=>loop.points.map((a,i)=>`${i?'L':'M'}${a[0].toFixed(6)},${a[1].toFixed(6)}`).join(' ')+(loop.closed?' Z':'');
  const closed=p.loops.filter(l=>l.closed).map(path).join(' '),open=p.loops.filter(l=>!l.closed).map(path).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(W+margin*2)*scale}mm" height="${(H+margin*2.5)*scale}mm" viewBox="${min[0]-margin} ${min[1]-margin} ${W+margin*2} ${H+margin*2.5}"><title>${xml(name)}</title><defs><pattern id="hatch" width="${3/scale}" height="${3/scale}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V${3/scale}" stroke="#444" stroke-width="${.15/scale}"/></pattern><clipPath id="detail"><rect x="${min[0]}" y="${min[1]}" width="${W}" height="${H}"/></clipPath><marker id="arrow" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto-start-reverse"><path d="M5 0 L0 2.5 L5 5" fill="none" stroke="black"/></marker></defs><rect x="${min[0]-margin}" y="${min[1]-margin}" width="${W+margin*2}" height="${H+margin*2.5}" fill="white"/><g ${detail?'clip-path="url(#detail)"':''} stroke="black" stroke-width="${stroke}" stroke-linejoin="round"><path d="${closed}" fill="url(#hatch)" fill-rule="evenodd"/><path d="${open}" fill="none"/></g><g font-family="sans-serif" font-size="${font}" fill="black"><text x="${min[0]}" y="${min[1]-10/scale}">${xml(name)} · scale ${scale}:1</text><text x="${min[0]}" y="${max[1]+15/scale}">Section path tolerance ${section.tolerance} mm · native B-rep intersection</text></g>${dimensions?`<g stroke="black" stroke-width="${.15/scale}" fill="none"><path d="M${min[0]} ${max[1]}v${8/scale}M${max[0]} ${max[1]}v${8/scale}"/><path d="M${min[0]} ${max[1]+6/scale}H${max[0]}" marker-start="url(#arrow)" marker-end="url(#arrow)"/></g><text x="${(min[0]+max[0])/2}" y="${max[1]+5/scale}" font-family="sans-serif" font-size="${font}" text-anchor="middle">${W.toFixed(3)} mm${detail?' (detail window)':''}</text>`:''}</svg>`;
}
export function sectionDXF(section){const p=sectionProjection(section),out=['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES'];for(const l of p.loops){out.push('0','LWPOLYLINE','8','SECTION','90',String(l.points.length),'70',l.closed?'1':'0');for(const [x,y]of l.points)out.push('10',String(x),'20',String(-y));}return out.concat(['0','ENDSEC','0','EOF']).join('\n')+'\n';}
