import {V,M,clamp,transformedPoint} from '../core/math.js';
export class Camera {
  constructor(){this.target=[0,0,30];this.yaw=-1.03;this.pitch=.51;this.distance=290;this.span=190;this.perspective=false;this.fov=38*Math.PI/180;this.width=1;this.height=1;}
  get eye(){return V.add(this.target,V.mul([Math.cos(this.yaw)*Math.cos(this.pitch),Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch)],this.distance));}
  matrices(w=this.width,h=this.height){this.width=w;this.height=h;let aspect=w/h,near=Math.max(.01,this.distance/10000),far=this.distance+Math.max(this.span*30,10000),view=M.lookAt(this.eye,this.target),projection=this.perspective?M.perspective(this.fov,aspect,near,far):M.ortho(-this.span*aspect/2,this.span*aspect/2,-this.span/2,this.span/2,near,far);this.vp=M.mul(projection,view);this.inverse=M.inverse(this.vp);return this.vp;}
  project(p){if(!this.vp)this.matrices();let q=M.point(this.vp,p);return [(q[0]/q[3]*.5+.5)*this.width,(-q[1]/q[3]*.5+.5)*this.height,q[2]/q[3]];}
  ray(x,y){if(!this.inverse)this.matrices();let p=[x/this.width*2-1,1-y/this.height*2],a=transformedPoint(this.inverse,[...p,0]),b=transformedPoint(this.inverse,[...p,1]);return {origin:a,direction:V.norm(V.sub(b,a))};}
  planePoint(x,y,axis=2,position=0){const r=this.ray(x,y);if(Math.abs(r.direction[axis])<1e-8)return null;let t=(position-r.origin[axis])/r.direction[axis];return t>0?V.add(r.origin,V.mul(r.direction,t)):null;}
  orbit(dx,dy){this.yaw-=dx*.008;this.pitch=clamp(this.pitch+dy*.008,-Math.PI/2+.001,Math.PI/2-.001);}
  pan(dx,dy){const z=V.norm(V.sub(this.eye,this.target)),x=V.norm(V.cross([0,0,1],z)),y=V.cross(z,x),scale=(this.perspective?2*this.distance*Math.tan(this.fov/2):this.span)/this.height;this.target=V.add(this.target,V.add(V.mul(x,-dx*scale),V.mul(y,dy*scale)));}
  zoom(delta){let f=Math.exp(clamp(delta,-250,250)*.0015);this.distance=clamp(this.distance*f,.1,1e7);this.span=clamp(this.span*f,.1,1e7);}
  fit(b){if(V.len(b.size)<1e-8){this.target=b.center.slice();this.span=160;this.distance=290;return;}let radius=Math.max(1,V.len(b.size)/2);this.target=b.center.slice();let aspect=this.width/this.height;this.span=radius*2.35/Math.min(aspect,1);this.distance=radius/Math.sin(this.fov/2)*1.25/Math.min(aspect,1);}
  view(name){const views={iso:[-1.03,.55],front:[-Math.PI/2,0],back:[Math.PI/2,0],right:[0,0],left:[Math.PI,0],top:[-Math.PI/2,Math.PI/2-.00001],bottom:[-Math.PI/2,-Math.PI/2+.00001]};if(views[name]){[this.yaw,this.pitch]=views[name];if(name!=='iso')this.perspective=false;}}
}
