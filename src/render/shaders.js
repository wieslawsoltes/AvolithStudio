export const SCENE_WGSL=/* wgsl */`
struct Scene { vp: mat4x4f, lightVP: mat4x4f, eye: vec4f, light: vec4f, section: vec4f, options: vec4f };
struct Object { color: vec4f, props: vec4f };
@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(1) @binding(0) var<uniform> object: Object;
struct VertexOut { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) lightClip: vec4f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> VertexOut {
 var o:VertexOut; o.position=scene.vp*vec4f(p,1);o.world=p;o.normal=n;o.lightClip=scene.lightVP*vec4f(p,1);return o;
}
fn visibility(lc:vec4f) -> f32 {
 let p=lc.xyz/lc.w;let uv=vec2f(p.x*.5+.5,.5-p.y*.5);
 if(any(uv<vec2f(0))||any(uv>vec2f(1))||p.z<0||p.z>1){return 1.0;}
 var s=0.0;let texel=1.0/vec2f(textureDimensions(shadowMap));
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){s+=textureSampleCompareLevel(shadowMap,shadowSampler,uv+vec2f(f32(x),f32(y))*texel,p.z-.0012);}}
 return s/9.0;
}
@fragment fn fs(o:VertexOut,@builtin(front_facing) front:bool) -> @location(0) vec4f {
 if(scene.options.x>.5 && dot(scene.section.xyz,o.world)>scene.section.w && object.props.w<.5){discard;}
 let shadow=visibility(o.lightClip);let dark=scene.options.y;
 if(object.props.w>.5){
   let grid=o.world.xy/10.0;let fw=max(fwidth(grid),vec2f(.0001));let d=abs(fract(grid-.5)-.5)/fw;
   let minor=1.0-min(min(d.x,d.y),1.0);let majorGrid=o.world.xy/50.0;let md=abs(fract(majorGrid-.5)-.5)/max(fwidth(majorGrid),vec2f(.0001));let major=1.0-min(min(md.x,md.y),1.0);
   var base=mix(vec3f(.939,.951,.964),vec3f(.094,.118,.15),dark);
   let fade=1.0-smoothstep(180.0,700.0,length(o.world.xy));
   base=mix(base,mix(vec3f(.71,.76,.81),vec3f(.21,.25,.31),dark),(.18*minor+.22*major)*fade*scene.options.z);
   base*=1.0-(1.0-shadow)*mix(.22,.38,dark);return vec4f(base,1);
 }
 let n=normalize(select(-o.normal,o.normal,front));let l=normalize(scene.light.xyz);let v=normalize(scene.eye.xyz-o.world);let h=normalize(l+v);
 let nl=max(dot(n,l),0.0);let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.0);let vh=max(dot(v,h),0.0);
 let rough=max(object.props.y,.06);let a=rough*rough;let a2=a*a;let denom=nh*nh*(a2-1.0)+1.0;let D=a2/(3.14159265*denom*denom);
 let k=(rough+1.0)*(rough+1.0)/8.0;let G=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));
 let base=pow(object.color.rgb,vec3f(2.2));let f0=mix(vec3f(.04),base,object.props.x);let F=f0+(1.0-f0)*pow(1.0-vh,5.0);
 let spec=D*G*F/max(4.0*nl*nv,.001);let diffuse=(1.0-F)*(1.0-object.props.x)*base/3.14159265;
 let hemi=.40+.20*(n.z*.5+.5);let fill=max(dot(n,normalize(vec3f(-.6,.4,.4))),0.0);
 var color=base*(hemi+.18*fill)+(diffuse+spec)*nl*(.25+.75*shadow)*2.7;
 color=mix(color,vec3f(.68,.29,.075),object.props.z*.16);
 if(scene.options.w>.5){color=base*(.65+.3*nl);}
 color=color/(color+vec3f(.55));color=pow(color,vec3f(1.0/2.2));return vec4f(color,object.color.a);
}
@vertex fn vsLine(@location(0) p:vec3f) -> VertexOut { var o:VertexOut;o.position=scene.vp*vec4f(p,1);o.position.z-=.000015*o.position.w;o.world=p;o.normal=vec3f(0,0,1);o.lightClip=vec4f(0);return o; }
@fragment fn fsLine(o:VertexOut)->@location(0) vec4f {if(scene.options.x>.5&&dot(scene.section.xyz,o.world)>scene.section.w){discard;}return vec4f(mix(mix(vec3f(.17,.23,.29),vec3f(.5,.61,.7),scene.options.y),vec3f(.96,.53,.15),object.props.z),mix(.5,1.0,object.props.z));}
@fragment fn fsHighlight(o:VertexOut)->@location(0) vec4f {if(scene.options.x>.5&&dot(scene.section.xyz,o.world)>scene.section.w){discard;}return vec4f(1.0,.61,.18,.42);}
`;
export const SHADOW_WGSL=/* wgsl */`
struct Scene { vp:mat4x4f,lightVP:mat4x4f,eye:vec4f,light:vec4f,section:vec4f,options:vec4f };
@group(0) @binding(0) var<uniform> scene:Scene;
struct Out {@builtin(position) position:vec4f,@location(0) world:vec3f};
@vertex fn vs(@location(0) p:vec3f)->Out {var o:Out;o.position=scene.lightVP*vec4f(p,1);o.world=p;return o;}
@fragment fn fs(o:Out){if(scene.options.x>.5&&dot(scene.section.xyz,o.world)>scene.section.w){discard;}}
`;
export const ANALYSIS_WGSL=/* wgsl */`
struct Positions { data: array<vec4f> };
struct Results { data: array<vec2f> };
@group(0) @binding(0) var<storage,read> vertices:Positions;
@group(0) @binding(1) var<storage,read_write> results:Results;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=arrayLength(&results.data)){return;}let a=vertices.data[i*3].xyz;let b=vertices.data[i*3+1].xyz;let c=vertices.data[i*3+2].xyz;
 results.data[i]=vec2f(length(cross(b-a,c-a))*.5,dot(a,cross(b,c))/6.0);
}
`;
export const GL_VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uVP;uniform mat4 uLightVP;uniform float uLine;
out vec3 vWorld;out vec3 vNormal;out vec4 vLight;
void main(){gl_Position=uVP*vec4(aPosition,1.);gl_Position.z=gl_Position.z*2.-gl_Position.w;if(uLine>.5)gl_Position.z-=.00003*gl_Position.w;vWorld=aPosition;vNormal=aNormal;vLight=uLightVP*vec4(aPosition,1.);}
`;
export const GL_FRAGMENT=`#version 300 es
precision highp float;
in vec3 vWorld;in vec3 vNormal;in vec4 vLight;
uniform vec4 uColor;uniform vec4 uProps;uniform vec3 uEye;uniform vec3 uLight;uniform vec4 uSection;uniform vec4 uOptions;uniform float uLine;uniform highp sampler2DShadow uShadow;
out vec4 fragColor;
float shadow(){vec3 p=vLight.xyz/vLight.w;vec2 uv=p.xy*.5+.5;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1)))||p.z<0.||p.z>1.)return 1.;float s=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(uShadow,vec3(uv+vec2(x,y)/2048.,p.z-.0012));return s/9.;}
void main(){
 if(uOptions.x>.5&&dot(uSection.xyz,vWorld)>uSection.w&&uProps.w<.5)discard;
 if(uLine>1.5){fragColor=vec4(1.,.61,.18,.42);return;}
 if(uLine>.5){fragColor=vec4(mix(mix(vec3(.17,.23,.29),vec3(.5,.61,.7),uOptions.y),vec3(.96,.53,.15),uProps.z),mix(.5,1.,uProps.z));return;}
 float sh=shadow();
 if(uProps.w>.5){vec2 grid=vWorld.xy/10.;vec2 d=abs(fract(grid-.5)-.5)/max(fwidth(grid),vec2(.0001));float minor=1.-min(min(d.x,d.y),1.);vec2 mg=vWorld.xy/50.;vec2 md=abs(fract(mg-.5)-.5)/max(fwidth(mg),vec2(.0001));float major=1.-min(min(md.x,md.y),1.);vec3 base=mix(vec3(.939,.951,.964),vec3(.094,.118,.15),uOptions.y);float fade=1.-smoothstep(180.,700.,length(vWorld.xy));base=mix(base,mix(vec3(.71,.76,.81),vec3(.21,.25,.31),uOptions.y),(.18*minor+.22*major)*fade*uOptions.z);base*=1.-(1.-sh)*mix(.22,.38,uOptions.y);fragColor=vec4(base,1.);return;}
 vec3 n=normalize(gl_FrontFacing?vNormal:-vNormal),l=normalize(uLight),v=normalize(uEye-vWorld),h=normalize(l+v);float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);float rough=max(uProps.y,.06),a=rough*rough,a2=a*a,denom=nh*nh*(a2-1.)+1.,D=a2/(3.14159265*denom*denom),k=(rough+1.)*(rough+1.)/8.,G=(nl/(nl*(1.-k)+k))*(nv/(nv*(1.-k)+k));vec3 base=pow(uColor.rgb,vec3(2.2)),f0=mix(vec3(.04),base,uProps.x),F=f0+(1.-f0)*pow(1.-vh,5.);vec3 spec=D*G*F/max(4.*nl*nv,.001),diffuse=(1.-F)*(1.-uProps.x)*base/3.14159265;float hemi=.40+.20*(n.z*.5+.5),fill=max(dot(n,normalize(vec3(-.6,.4,.4))),0.);vec3 color=base*(hemi+.18*fill)+(diffuse+spec)*nl*(.25+.75*sh)*2.7;color=mix(color,vec3(.68,.29,.075),uProps.z*.16);if(uOptions.w>.5)color=base*(.65+.3*nl);color=color/(color+vec3(.55));color=pow(color,vec3(1./2.2));fragColor=vec4(color,uColor.a);
}`;
export const GL_SHADOW_VERTEX=`#version 300 es
precision highp float;layout(location=0)in vec3 aPosition;uniform mat4 uLightVP;out vec3 vWorld;void main(){gl_Position=uLightVP*vec4(aPosition,1);gl_Position.z=gl_Position.z*2.-gl_Position.w;vWorld=aPosition;}`;
export const GL_SHADOW_FRAGMENT=`#version 300 es
precision highp float;in vec3 vWorld;uniform vec4 uSection;uniform vec4 uOptions;void main(){if(uOptions.x>.5&&dot(uSection.xyz,vWorld)>uSection.w)discard;}`;
