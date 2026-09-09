import {box,cylinder,tube,torus,boolean,sheetMetal,loft,rectangleProfile} from './kernel.js';
import {M,V} from './math.js';
import {body} from './document.js';
function alongY(s,center){return s.transform(M.rotate([1,0,0],Math.PI/2)).translate(center);}
export function actuatorExample(){
  const bodies=[],add=(s,n,m='steel',c='housing')=>bodies.push(body(s,n,m,c));
  let base=box(124,86,9,[0,0,4.5],7);
  for(const x of [-49,49])for(const y of [-31,31])base=boolean(base,cylinder(4.5,15,[x,y,5],32),'subtract');
  add(base,'Mounting plate','aluminum','mounting');
  let housing=box(88,57,51,[0,0,34.5],5.5),bore=alongY(cylinder(18,100,[0,0,0],64),[0,0,36]);housing=boolean(housing,bore,'subtract');
  housing=boolean(housing,cylinder(8,32,[0,0,63],40),'subtract');
  add(housing,'Actuator housing','anodized');
  add(alongY(tube(28,18,8,[0,0,0],64),[0,-32.5,36]),'Front mounting flange','aluminum');
  add(alongY(tube(21,17.8,2.5,[0,0,0],64),[0,-38,36]),'Bearing retainer','brass');
  add(alongY(tube(23,18,7,[0,0,0],64),[0,32,36]),'Rear bearing carrier','steel');
  add(alongY(tube(14,8,36,[0,0,0],64),[0,-43,36]),'Drive sleeve','brass','drive');
  add(alongY(tube(14.8,13.7,2,[0,0,0],64),[0,-54,36]),'Sleeve retaining ring','polymer','drive');
  let lid=box(67,46,5,[0,0,62.5],4);lid=boolean(lid,cylinder(8.2,15,[0,0,63],40),'subtract');add(lid,'Service cover','aluminum');
  add(tube(11,7.2,9,[0,0,68],48),'Lubrication port','brass');
  for(let i=0;i<6;i++){let a=i*Math.PI/3,x=23.2*Math.cos(a),z=36+23.2*Math.sin(a);let h=alongY(cylinder(2.8,3.4,[0,0,0],6),[x,-38.2,z]);add(h,`Flange fastener ${String(i+1).padStart(2,'0')}`,'polymer','fasteners');}
  for(const x of [-26,26])for(const y of [-15.5,15.5]){add(cylinder(3.1,3,[x,y,66.5],6),`Cover fastener ${x>0?'R':'L'}${y>0?'2':'1'}`,'polymer','fasteners');}
  return {name:'Actuator housing',bodies,components:[{id:'housing',name:'Housing assembly'},{id:'drive',name:'Drive components'},{id:'mounting',name:'Mounting hardware'},{id:'fasteners',name:'Fasteners · M6'}],sketches:[]};
}
export function bracketExample(){return {name:'Sheet metal bracket',bodies:[body(sheetMetal({width:70,base:55,flange:40,thickness:2,radius:5}),'Bend bracket','aluminum')],components:[{id:'parts',name:'Sheet metal'}],sketches:[]};}
export function booleanExample(){return {name:'Boolean playground',bodies:[body(box(46,46,32,[0,0,16]),'Target block','anodized'),body(cylinder(14,55,[8,0,27.5]),'Cylinder tool','brass'),body(box(20,70,18,[38,0,9]),'Second tool','red')],components:[{id:'parts',name:'Boolean bodies'}],sketches:[]};}
export function loftExample(){return {name:'Transition duct',bodies:[body(loft(rectangleProfile(65,65),rectangleProfile(35,35),65,[12,0],30),'Twisted transition','anodized')],components:[{id:'parts',name:'Loft geometry'}],sketches:[]};}
export const EXAMPLES={actuator:actuatorExample,bracket:bracketExample,boolean:booleanExample,loft:loftExample};
