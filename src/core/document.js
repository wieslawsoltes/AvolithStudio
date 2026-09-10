import {Solid,metrics} from './kernel.js';
import {mergeBounds,V,M,transformedPoint} from './math.js';
let serial=0;
export const uid=(prefix='b')=>`${prefix}-${Date.now().toString(36)}-${(++serial).toString(36)}`;
export const MATERIALS={
  aluminum:{name:'Aluminum · bead blasted',color:'#7e9ca9',density:.00270,metallic:.55,roughness:.42},
  steel:{name:'Steel · machined',color:'#bac5d0',density:.00785,metallic:.82,roughness:.28},
  anodized:{name:'Aluminum · blue anodized',color:'#477d99',density:.00270,metallic:.5,roughness:.38},
  brass:{name:'Brass · satin',color:'#caa35e',density:.00850,metallic:.73,roughness:.31},
  polymer:{name:'Polymer · graphite',color:'#414b56',density:.00115,metallic:.05,roughness:.7},
  copper:{name:'Copper',color:'#c68563',density:.00896,metallic:.8,roughness:.3},
  red:{name:'Coated steel · vermilion',color:'#dc714b',density:.00785,metallic:.1,roughness:.45}
};
export const defaultEngineering=()=>({version:1,mates:[],grounded:[],annotations:[],datums:[],boundaryConditions:[]});
export function validateEngineering(value){
  const e={...defaultEngineering(),...structuredClone(value||{})};
  if(e.version!==1)throw Error('Unsupported engineering data version.');
  for(const key of ['mates','grounded','annotations','datums','boundaryConditions'])if(!Array.isArray(e[key])||e[key].length>500)throw Error('Invalid engineering collection: '+key);
  if(JSON.stringify(e).length>2097152)throw Error('Engineering data exceeds 2 MB.');return e;
}
export function body(solid,name='Solid',material='aluminum',component='parts'){
  if(!(solid instanceof Solid))throw Error('Body geometry must be a Solid.');if(!Object.hasOwn(MATERIALS,material))material='aluminum';return {id:uid(),name,solid,material,color:MATERIALS[material]?.color||'#8da8b8',visible:true,locked:false,component,layer:'default'};
}
/** Native mass properties for exact sources; faceted values remain explicitly approximate. */
export function bodyMetrics(b){
  const e=b.solid.meta.exact;if(!e)return {...metrics(b.solid),representation:'faceted'};
  const scale=V.len(e.pose.slice(0,3));return {...e.properties,area:e.properties.area*scale**2,volume:e.properties.volume*scale**3,centroid:transformedPoint(e.pose,e.properties.centroid),bounds:b.solid.bounds,triangles:b.solid.triangles().length,representation:'analytic B-rep'};
}
/** Transactional document. History structurally shares immutable Solid objects to avoid mesh copies. */
export class ModelDocument extends EventTarget {
  constructor(){super();this.name='Untitled design';this.engineering=defaultEngineering();this.bodies=[];this.sketches=[];this.components=[{id:'parts',name:'Parts'}];this.layers=[{id:'default',name:'Default',visible:true}];this.groups=[];this.units='mm';this.revision=0;this.history=[];this.cursor=0;this.savedRevision=-1;this.maxHistory=60;}
  snapshot(){return {engineering:structuredClone(this.engineering),name:this.name,bodies:this.bodies.map(b=>({...b})),sketches:structuredClone(this.sketches),components:structuredClone(this.components),layers:structuredClone(this.layers),groups:structuredClone(this.groups),units:this.units};}
  restore(s){Object.assign(this,{...s,engineering:validateEngineering(s.engineering),bodies:s.bodies.map(b=>({...b})),sketches:structuredClone(s.sketches),components:structuredClone(s.components),layers:structuredClone(s.layers),groups:structuredClone(s.groups)});}
  transact(label,fn){const before=this.snapshot();try{fn(this);this.validate();}catch(e){this.restore(before);throw e;}const after=this.snapshot();this.history=this.history.slice(0,this.cursor);this.history.push({label,before,after,time:Date.now()});if(this.history.length>this.maxHistory)this.history.shift();this.cursor=this.history.length;this.changed(label);}
  changed(label='Update'){this.revision++;this.dispatchEvent(new CustomEvent('change',{detail:{label,revision:this.revision}}));}
  undo(){if(!this.cursor)return false;const h=this.history[--this.cursor];this.restore(h.before);this.changed(`Undo ${h.label}`);return true;}
  redo(){if(this.cursor>=this.history.length)return false;const h=this.history[this.cursor++];this.restore(h.after);this.changed(`Redo ${h.label}`);return true;}
  validate(){this.engineering=validateEngineering(this.engineering);if(this.bodies.length>2000)throw Error('Document limit: 2,000 bodies.');let ids=new Set();for(const b of this.bodies){if(ids.has(b.id))throw Error('Duplicate body ID.');ids.add(b.id);if(!(b.solid instanceof Solid)||b.solid.polygons.length>200000)throw Error('Invalid geometry.');if(!Object.hasOwn(MATERIALS,b.material))throw Error('Invalid material.');if(!/^#[\da-fA-F]{6}$/.test(b.color))throw Error('Invalid color.');}}
  add(solid,name,material,component){const b=body(solid,name,material,component);this.bodies.push(b);return b;}
  find(id){return this.bodies.find(b=>b.id===id);}
  visible(){return this.bodies.filter(b=>b.visible&&this.layers.find(l=>l.id===b.layer)?.visible!==false);}
  bounds(){return mergeBounds(this.visible().map(b=>b.solid.bounds));}
  remove(ids){const set=new Set(ids);this.engineering.mates=this.engineering.mates.filter(m=>!set.has(m.a?.body)&&!set.has(m.b?.body));this.engineering.datums=this.engineering.datums.filter(a=>!set.has(a.body));this.engineering.grounded=this.engineering.grounded.filter(id=>!set.has(id));this.engineering.boundaryConditions=this.engineering.boundaryConditions.filter(c=>!set.has(c.body));this.engineering.annotations=this.engineering.annotations.filter(a=>!set.has(a.body));this.bodies=this.bodies.filter(b=>!set.has(b.id));this.groups=this.groups.map(g=>({...g,ids:g.ids.filter(id=>!set.has(id))}));}
  serialize(){return {format:'avolith',version:1,engineering:this.engineering,name:this.name,units:this.units,bodies:this.bodies.map(b=>({...b,solid:b.solid.toJSON()})),sketches:this.sketches,components:this.components,layers:this.layers,groups:this.groups};}
  static parse(input){
    const data=typeof input==='string'?JSON.parse(input):input;if(!data||data.format!=='avolith'||data.version!==1||!Array.isArray(data.bodies)||data.bodies.length>2000)throw Error('Not a supported Avolith document.');
    const d=new ModelDocument();d.name=String(data.name||'Imported design').slice(0,200);d.units=data.units==='in'?'in':'mm';
    d.components=Array.isArray(data.components)?data.components.slice(0,500).map(c=>({id:String(c.id).slice(0,100),name:String(c.name).slice(0,200)})):d.components;
    d.layers=Array.isArray(data.layers)?data.layers.slice(0,500).map(l=>({id:String(l.id).slice(0,100),name:String(l.name).slice(0,200),visible:l.visible!==false})):d.layers;
    d.bodies=data.bodies.map(b=>({id:String(b.id||uid()).slice(0,100),name:String(b.name||'Solid').slice(0,200),solid:Solid.fromJSON(b.solid),material:Object.hasOwn(MATERIALS,b.material)?b.material:'aluminum',color:/^#[\da-fA-F]{6}$/.test(b.color)?b.color:'#8da8b8',visible:b.visible!==false,locked:!!b.locked,component:String(b.component||'parts'),layer:String(b.layer||'default')}));
    d.sketches=Array.isArray(data.sketches)?data.sketches.slice(0,1000).map(s=>{if(!Array.isArray(s.points)||s.points.length>4096||s.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('Invalid sketch.');return {id:String(s.id||uid('s')),name:String(s.name||'Sketch').slice(0,200),points:s.points,closed:!!s.closed,plane:['XY','XZ','YZ'].includes(s.plane)?s.plane:'XY',origin:Number.isFinite(s.origin)?s.origin:0,visible:s.visible!==false,constraints:Array.isArray(s.constraints)?s.constraints.slice(0,1000):[]};}):[];
    d.groups=Array.isArray(data.groups)?data.groups.slice(0,500).map(g=>({id:String(g.id),name:String(g.name).slice(0,200),ids:(Array.isArray(g.ids)?g.ids:[]).filter(id=>d.find(id))})):[];
    d.engineering=validateEngineering(data.engineering);d.validate();return d;
  }
  report(){const rows=this.bodies.map(b=>{const m=bodyMetrics(b),material=MATERIALS[b.material];return {id:b.id,name:b.name,material:material.name,volume_mm3:m.volume,area_mm2:m.area,mass_g:m.volume*material.density,centroid_mm:m.centroid,triangles:m.triangles};});return {document:this.name,units:'mm',geometry:this.bodies.some(b=>b.solid.meta.exact)?'mixed analytic and faceted':'faceted',bodies:rows,totalMass_g:rows.reduce((s,b)=>s+b.mass_g,0)};}
}
export class LocalStore {
  constructor(){this.db=null;}
  async open(){if(!globalThis.indexedDB)throw Error('IndexedDB is unavailable. Export a project file to save.');this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('avolith-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('documents');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return this;}
  async save(data){if(!this.db)await this.open();return new Promise((resolve,reject)=>{const t=this.db.transaction('documents','readwrite');t.objectStore('documents').put(data,'autosave');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Save aborted'));});}
  async load(){if(!this.db)await this.open();return new Promise((resolve,reject)=>{const r=this.db.transaction('documents').objectStore('documents').get('autosave');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
}
