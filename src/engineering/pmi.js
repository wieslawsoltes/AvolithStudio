import {V,M,transformedPoint} from '../core/math.js';
import {uid} from '../core/document.js';
import {assemblyReference} from './assembly.js';
export const CHARACTERISTICS={straightness:'⏤',flatness:'⏥',circularity:'○',cylindricity:'⌭',profileLine:'⌒',profileSurface:'⌓',parallelism:'∥',perpendicularity:'⊥',angularity:'∠',position:'⌖',concentricity:'◎',symmetry:'⌯',circularRunout:'↗',totalRunout:'⌰'};
export const PROJECTIONS={front:{x:[1,0,0],y:[0,0,-1],depth:[0,-1,0]},back:{x:[-1,0,0],y:[0,0,-1],depth:[0,1,0]},right:{x:[0,-1,0],y:[0,0,-1],depth:[-1,0,0]},left:{x:[0,1,0],y:[0,0,-1],depth:[1,0,0]},top:{x:[1,0,0],y:[0,1,0],depth:[0,0,-1]},bottom:{x:[1,0,0],y:[0,-1,0],depth:[0,0,1]}};
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const point=p=>{if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('PMI points need three finite coordinates.');return p;};
const real=(n,label,min=-1e6,max=1e6)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error(`Invalid ${label}.`);return n;};
export function validateAnnotation(a){
  if(!['linear','angle','radius','diameter','datum','fcf','note'].includes(a?.type))throw Error('Unsupported annotation type.');
  const required={linear:2,angle:3,radius:2,diameter:2,datum:1,fcf:1,note:1}[a.type];if(!Array.isArray(a.points)||a.points.length!==required)throw Error(`${a.type} needs ${required} points.`);a.points.forEach(point);
  if(!Object.hasOwn(PROJECTIONS,a.view||'front'))throw Error('Invalid annotation view.');
  real(a.offset??10,'dimension offset',-1e5,1e5);real(a.precision??2,'precision',0,6);if(!Number.isInteger(a.precision??2))throw Error('Precision must be an integer.');
  if(a.type==='datum'&&!/^[A-Z]{1,3}$/.test(a.label||''))throw Error('Datum identifiers use 1–3 uppercase letters.');
  if(a.type==='note'&&(typeof a.text!=='string'||a.text.length>1000))throw Error('Notes are limited to 1,000 characters.');
  if(a.type==='fcf'){
    if(!Object.hasOwn(CHARACTERISTICS,a.characteristic))throw Error('Unsupported geometric characteristic.');real(a.tolerance,'geometric tolerance',1e-9,1e4);
    if(a.modifier&&!['MMC','LMC','RFS'].includes(a.modifier))throw Error('Invalid material-condition modifier.');
    if(a.datums&&(!Array.isArray(a.datums)||a.datums.length>3||a.datums.some(x=>!/^[A-Z]{1,3}(?:\:(?:MMC|LMC|RFS))?$/.test(x))))throw Error('Use up to three valid datum references.');
    if(['straightness','flatness','circularity','cylindricity'].includes(a.characteristic)&&a.datums?.length)throw Error('Form tolerances do not reference a datum frame.');
  }
  if(['linear','radius','diameter'].includes(a.type)&&V.dist(a.points[0],a.points[1])<1e-8)throw Error('Dimension points must be different.');
  if(a.type==='angle'&&(V.dist(a.points[0],a.points[1])<1e-8||V.dist(a.points[2],a.points[1])<1e-8))throw Error('Angle legs cannot be zero.');
  if(a.upper!==undefined)real(a.upper,'upper tolerance',0,1e5);if(a.lower!==undefined)real(a.lower,'lower tolerance',0,1e5);
  return {...a,id:a.id||uid('pmi'),view:a.view||'front',precision:a.precision??2};
}
export function createAnnotation(body,data){
  const a=validateAnnotation(data);
  if(body){const ref=assemblyReference(body),inv=M.inverse(body.solid.meta.referenceFrame);a.body=body.id;a.key=ref.key;a.points=a.points.map(p=>transformedPoint(inv,p));}
  return a;
}
export function resolveAnnotation(annotation,bodies){
  const a=validateAnnotation(annotation);if(!a.body)return {...a,stale:false};
  const b=bodies.find(x=>x.id===a.body);if(!b||b.solid.meta.referenceKey!==a.key)return {...a,stale:true};
  return {...a,points:a.points.map(p=>transformedPoint(b.solid.meta.referenceFrame,p)),stale:false};
}
export function annotationValue(a){
  const p=a.points;
  if(a.type==='linear'||a.type==='radius')return V.dist(p[0],p[1]);
  if(a.type==='diameter')return 2*V.dist(p[0],p[1]);
  if(a.type==='angle')return Math.acos(Math.max(-1,Math.min(1,V.dot(V.norm(V.sub(p[0],p[1])),V.norm(V.sub(p[2],p[1]))))))*180/Math.PI;
  return null;
}
export function featureControlText(a){validateAnnotation(a);const modifier={MMC:'Ⓜ',LMC:'Ⓛ',RFS:'Ⓢ'};return [CHARACTERISTICS[a.characteristic],`${a.diameter?'⌀':''}${a.tolerance}${modifier[a.modifier]||''}`,...(a.datums||[]).map(d=>{const [label,m]=d.split(':');return label+(modifier[m]||'');})].join(' | ');}
function annotationSVG(a,project,scale){
  if(a.stale)return '';
  const p=a.points.map(project),a0=p[0],value=annotationValue(a),fmt=x=>x.toFixed(a.precision);let label=a.type==='fcf'?featureControlText(a):a.type==='datum'?a.label:a.type==='note'?a.text:`${a.type==='diameter'?'⌀':a.type==='radius'?'R':''}${fmt(value)}${a.type==='angle'?'°':''}`;
  if(a.upper!==undefined||a.lower!==undefined)label+=` +${a.upper??0}/−${a.lower??0}`;
  if(a.type==='linear'){
    const b=p[1],dx=b[0]-a0[0],dy=b[1]-a0[1],len=Math.hypot(dx,dy);if(len<1e-6)return '';
    const normal=[-dy/len,dx/len],o=(a.offset??10)*scale,q=a0.map((v,i)=>v+normal[i]*o),r=b.map((v,i)=>v+normal[i]*o),mid=q.map((v,i)=>(v+r[i])/2);
    if(Math.abs(len/scale-value)>1e-4)label+=' (3D REF)';
    return `<g class="annotation"><path d="M${a0}L${q}M${b}L${r}M${q}L${r}"/><circle cx="${q[0]}" cy="${q[1]}" r=".45"/><circle cx="${r[0]}" cy="${r[1]}" r=".45"/><text x="${mid[0]}" y="${mid[1]-1.5}" text-anchor="middle">${xml(label)}</text></g>`;
  }
  const end=[a0[0]+15,a0[1]-(a.offset??10)*scale];
  return `<g class="annotation"><path d="M${a0}L${end}h5"/><circle cx="${a0[0]}" cy="${a0[1]}" r=".45"/>${['fcf','datum'].includes(a.type)?`<rect x="${end[0]+5}" y="${end[1]-4}" width="${Math.max(9,label.length*1.7+3)}" height="6" fill="white"/>`:''}<text x="${end[0]+6}" y="${end[1]+.3}">${xml(label)}</text></g>`;
}
/** A3 engineering sheet from true HLR projections. SVG curves may be approximated
 * for SVG compatibility; dimensions remain derived from world-space references.
 */
export function engineeringDrawing(projection,document,{revision='A',scale=null,title=document.name}={}){
  const views=projection.views;if(!Array.isArray(views)||!views.length)throw Error('No projected drawing views.');
  const boxes=views.map(v=>String(v.viewBox).trim().split(/[ ,]+/).map(Number));if(boxes.some(b=>b.length!==4||b.some(x=>!Number.isFinite(x))||b[2]<=0||b[3]<=0))throw Error('Invalid drawing bounds.');
  const sc=scale??Math.min(1,...boxes.map(b=>Math.min(145/b[2],85/b[3])));real(sc,'drawing scale',1e-6,100);
  const slots={front:[108,190],top:[108,77],right:[294,190]},annotations=(document.engineering?.annotations||[]).map(a=>resolveAnnotation(a,document.bodies));
  const content=views.map((v,i)=>{const [cx,cy]=slots[v.name]||[108+185*(i%2),75+110*Math.floor(i/2)],[x,y,w,h]=boxes[i],tx=cx-(x+w/2)*sc,ty=cy-(y+h/2)*sc,P=PROJECTIONS[v.name];if(!P)throw Error('Unknown drawing projection.');const project=p=>[tx+V.dot(p,P.x)*sc,ty+V.dot(p,P.y)*sc];return `<g><text class="view-title" x="${cx}" y="${cy-h*sc/2-10}" text-anchor="middle">${xml(v.name.toUpperCase())}</text><g transform="translate(${tx} ${ty}) scale(${sc})" fill="none" stroke="black" stroke-width="${.23/sc}">${v.visible.map(p=>`<path d="${xml(p)}"/>`).join('')}<g stroke-width="${.15/sc}" stroke-dasharray="${2/sc} ${1/sc}">${v.hidden.map(p=>`<path d="${xml(p)}"/>`).join('')}</g></g>${annotations.filter(a=>a.view===v.name).map(a=>annotationSVG(a,project,sc)).join('')}</g>`;}).join('');
  const notes=annotations.filter(a=>['note','datum','fcf'].includes(a.type)||a.stale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297"><title>${xml(title)} — engineering drawing</title><style>text{font-family:Arial,sans-serif;font-size:3px;fill:#152535}path,rect{stroke-linejoin:round}.view-title{font-size:3px;letter-spacing:.6px;fill:#516575}.annotation{fill:none;stroke:#274755;stroke-width:.18}.annotation text{stroke:none;fill:#163344;font-size:3px;paint-order:stroke;stroke:white;stroke-width:.6px;stroke-linejoin:round}</style><rect width="420" height="297" fill="white"/><rect x="9" y="9" width="402" height="279" fill="none" stroke="#203a49" stroke-width=".25"/><text x="15" y="17" style="font-size:4px;font-weight:bold;letter-spacing:.8px">AVOLITH / ENGINEERING</text><text x="405" y="17" text-anchor="end">EXACT MODEL · VISIBLE + HIDDEN EDGES</text><path d="M9 22H411M9 261H411" stroke="#203a49" stroke-width=".2"/>${content}<text x="224" y="42" style="font-size:5px">${xml(title.slice(0,45))}</text><text x="224" y="52">${document.bodies.filter(b=>b.solid.meta.exact).length} exact bodies · ${annotations.length} annotations</text>${notes.slice(0,10).map((a,i)=>`<text x="224" y="${62+i*6}" ${a.stale?'fill="#b74128"':''}>${xml((a.stale?'[STALE] ':'')+(a.type==='fcf'?featureControlText(a):a.label||a.text||a.type)).slice(0,200)}</text>`).join('')}<text x="15" y="270">DIMENSIONS IN mm · VERIFY REQUIREMENTS BEFORE MANUFACTURE · DO NOT SCALE</text><text x="15" y="278">HLR visibility is geometry-derived. Annotation semantics are not a standards-conformance certification.</text><path d="M210 280H411M210 261V288M355 261V288" stroke="#203a49" stroke-width=".2"/><text x="214" y="268">${xml(title.slice(0,60))}</text><text x="214" y="285">SCALE ${sc.toFixed(4)}:1 · A3</text><text x="360" y="269">REV ${xml(revision)}</text><text x="360" y="285">SHEET 1 / 1</text></svg>`;
}
export function pmiJSON(document){return JSON.stringify({format:'avolith-pmi',version:1,units:'mm',name:document.name,datums:document.engineering.datums,annotations:document.engineering.annotations.map(a=>({...resolveAnnotation(a,document.bodies),value:annotationValue(resolveAnnotation(a,document.bodies))}))},null,2);}
