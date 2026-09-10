import {V,M,mergeBounds} from '../core/math.js';
import {featureEdges,metrics} from '../core/kernel.js';
import {MATERIALS} from '../core/document.js';
import {Camera} from './camera.js';
import {SCENE_WGSL,SHADOW_WGSL,ANALYSIS_WGSL,GL_VERTEX,GL_FRAGMENT,GL_SHADOW_VERTEX,GL_SHADOW_FRAGMENT} from './shaders.js';
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const LIGHT=V.norm([-.5,-.7,1.2]);
function meshData(solid){let a=[];for(const t of solid.triangles())for(let i=0;i<3;i++)a.push(...t.vertices[i],...(t.normals?.[i]||t.normal));return new Float32Array(a);}
function lineData(solid){const e=solid.meta.exact;if(e?.edgeLines){const out=[];for(let i=0;i<e.edgeLines.length;i+=3)out.push(...M.point(e.pose,e.edgeLines.slice(i,i+3)).slice(0,3));return new Float32Array(out);}return new Float32Array(featureEdges(solid,24).flat(2));}
/** Demand-driven GPU renderer with persistent per-solid buffers and native shadow/depth passes. */
export class Renderer {
  constructor(canvas){
    this.canvas=canvas;this.camera=new Camera();this.bodies=[];this.selected=new Set();this.dark=false;this.grid=true;this.edges=true;this.shadows=true;this.mode='shaded';this.section={enabled:false,axis:1,position:0};this.backend='Starting';this.resources=new Map();this.objectResources=new Map();this.pending=false;this.disposed=false;this.highlight=null;this.highlightDirty=true;this.shadowDirty=true;this.onFrame=()=>{};this.onError=()=>{};this.onBackend=()=>{};this.lastStats={renderMs:0,triangles:0,drawCalls:0};
  }
  async init(force='auto'){
    let reason='';if(force==='auto'||force==='webgpu'){try{await this.initGPU();this.backend='WebGPU';}catch(e){reason=e.message;console.warn('WebGPU initialization:',reason);this.resetCanvas();}}
    if(this.backend!=='WebGPU'&&force!=='canvas'){try{this.initGL();this.backend='WebGL2 fallback';}catch(e){reason+=' '+e.message;this.resetCanvas();}}
    if(!this.backend.startsWith('WebGL')&&this.backend!=='WebGPU'){this.ctx=this.canvas.getContext('2d');if(!this.ctx)throw Error('No supported canvas renderer.');this.backend='Canvas fallback';}
    this.fallbackReason=reason;this.onBackend(this.backend,reason);this.observer=new ResizeObserver(()=>this.request());this.observer.observe(this.canvas.parentElement);this.request();return this;
  }
  resetCanvas(){this.device?.destroy();this.device=null;this.gl=null;this.ctx=null;this.context=null;let old=this.canvas,n=document.createElement('canvas');n.id=old.id;n.className=old.className;old.replaceWith(n);this.canvas=n;this.resources.clear();this.objectResources.clear();}
  async initGPU(){
    if(!navigator.gpu)throw Error('WebGPU requires a supported browser and a secure context (localhost or HTTPS).');
    this.adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!this.adapter)throw Error('No WebGPU adapter is available.');this.device=await this.adapter.requestDevice();let d=this.device;
    this.adapterInfo=this.adapter.info?`${this.adapter.info.vendor||''} ${this.adapter.info.architecture||''}`.trim():'';
    d.addEventListener('uncapturederror',e=>this.onError(e.error.message));d.lost.then(info=>{if(!this.disposed&&this.backend==='WebGPU'){this.onError(`GPU device lost: ${info.message}. Reload to recover.`);this.backend='WebGPU device lost';this.onBackend(this.backend,info.message);}});
    this.context=this.canvas.getContext('webgpu');if(!this.context)throw Error('Cannot create a WebGPU canvas context.');this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:d,format:this.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    const module=d.createShaderModule({label:'Avolith shaded surfaces / edges',code:SCENE_WGSL}),shadowModule=d.createShaderModule({label:'Avolith shadow map',code:SHADOW_WGSL});
    for(const m of [module,shadowModule]){let info=await m.getCompilationInfo();let errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));}
    const vis=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
    this.sceneLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:vis,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'comparison'}}]});
    this.objectLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    this.layout=d.createPipelineLayout({bindGroupLayouts:[this.sceneLayout,this.objectLayout]});
    this.shadowLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:vis,buffer:{type:'uniform'}}]});
    const attributes=[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}];
    const descriptor={layout:this.layout,vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes}]},fragment:{module,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},multisample:{count:4}};
    this.surfacePipeline=await d.createRenderPipelineAsync({...descriptor,label:'Shaded material pipeline'});
    const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}};
    this.linePipeline=await d.createRenderPipelineAsync({...descriptor,label:'Feature edge pipeline',vertex:{module,entryPoint:'vsLine',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module,entryPoint:'fsLine',targets:[{format:this.format,blend}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});
    this.highlightPipeline=await d.createRenderPipelineAsync({...descriptor,label:'Planar selection pipeline',fragment:{module,entryPoint:'fsHighlight',targets:[{format:this.format,blend}]},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal',depthBias:-2,depthBiasSlopeScale:-1}});
    this.shadowPipeline=await d.createRenderPipelineAsync({label:'Shadow depth pipeline',layout:d.createPipelineLayout({bindGroupLayouts:[this.shadowLayout]}),vertex:{module:shadowModule,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module:shadowModule,entryPoint:'fs',targets:[]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:2,depthBiasSlopeScale:1.5}});
    this.sceneBuffer=d.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.shadowTexture=d.createTexture({label:'2048² shadow depth',size:[2048,2048],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.sceneGroup=d.createBindGroup({layout:this.sceneLayout,entries:[{binding:0,resource:{buffer:this.sceneBuffer}},{binding:1,resource:this.shadowTexture.createView()},{binding:2,resource:d.createSampler({compare:'less-equal',magFilter:'linear',minFilter:'linear'})}]});
    this.shadowGroup=d.createBindGroup({layout:this.shadowLayout,entries:[{binding:0,resource:{buffer:this.sceneBuffer}}]});
    this.floorBuffer=this.gpuBuffer(new Float32Array([-5000,-5000,-.12,0,0,1,5000,-5000,-.12,0,0,1,5000,5000,-.12,0,0,1,-5000,-5000,-.12,0,0,1,5000,5000,-.12,0,0,1,-5000,5000,-.12,0,0,1]));
    this.floorObject=this.gpuObject('floor');d.queue.writeBuffer(this.floorObject.buffer,0,new Float32Array([.94,.95,.96,1,0,1,0,1]));
    this.computePipeline=await d.createComputePipelineAsync({label:'Triangle area / signed volume analysis',layout:'auto',compute:{module:d.createShaderModule({code:ANALYSIS_WGSL}),entryPoint:'main'}});
  }
  gpuBuffer(data){let b=this.device.createBuffer({size:Math.max(4,data.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,mappedAtCreation:true});new Float32Array(b.getMappedRange()).set(data);b.unmap();return b;}
  gpuObject(id){if(!this.objectResources.has(id)){let buffer=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.objectResources.set(id,{buffer,group:this.device.createBindGroup({layout:this.objectLayout,entries:[{binding:0,resource:{buffer}}]})});}return this.objectResources.get(id);}
  initGL(){
    const gl=this.canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL2 is unavailable.');this.gl=gl;
    const program=(vs,fs)=>{let p=gl.createProgram();for(const [type,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
    this.glProgram=program(GL_VERTEX,GL_FRAGMENT);this.glShadowProgram=program(GL_SHADOW_VERTEX,GL_SHADOW_FRAGMENT);this.glUniforms=new Map();
    const verts=new Float32Array([-5000,-5000,-.12,0,0,1,5000,-5000,-.12,0,0,1,5000,5000,-.12,0,0,1,-5000,-5000,-.12,0,0,1,5000,5000,-.12,0,0,1,-5000,5000,-.12,0,0,1]);this.glFloor=this.glMesh(verts);
    this.glShadowTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.glShadowTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,2048,2048,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
    this.glShadowFB=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.glShadowFB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.glShadowTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Shadow framebuffer is incomplete.');gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onError('WebGL context lost. Reload to restore rendering.');});
  }
  glMesh(data,lines=false){const gl=this.gl,vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,lines?12:24,0);if(!lines){gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);}gl.bindVertexArray(null);return {vao,buffer,count:data.length/(lines?3:6)};}
  uniform(program,name){let key=(program===this.glProgram?'main:':'shadow:')+name;if(!this.glUniforms.has(key))this.glUniforms.set(key,this.gl.getUniformLocation(program,name));return this.glUniforms.get(key);}
  setScene(bodies){this.bodies=bodies;const active=new Set(bodies.map(b=>b.solid));for(const [s,r] of this.resources)if(!active.has(s)){if(this.device){r.vertices?.destroy();r.lines?.destroy();}if(this.gl){this.gl.deleteBuffer(r.vertices?.buffer);this.gl.deleteVertexArray(r.vertices?.vao);this.gl.deleteBuffer(r.lines?.buffer);this.gl.deleteVertexArray(r.lines?.vao);}this.resources.delete(s);}for(const [id,r]of this.objectResources)if(id!=='floor'&&!bodies.some(b=>b.id===id)){r.buffer.destroy();this.objectResources.delete(id);}this.shadowDirty=true;this.highlightDirty=true;this.request();}
  setSelection(ids){this.selected=new Set(ids);this.request();}
  setHighlight(hit){if(hit?.body?.id===this.highlight?.body?.id&&hit?.tri?.face===this.highlight?.tri?.face)return;this.highlight=hit;this.highlightDirty=true;this.request();}
  getResource(solid){if(!this.resources.has(solid)){let data=meshData(solid),line=lineData(solid);this.resources.set(solid,this.backend==='WebGPU'?{vertices:this.gpuBuffer(data),lines:this.gpuBuffer(line),count:data.length/6,lineCount:line.length/3}:this.gl?{vertices:this.glMesh(data),lines:this.glMesh(line,true),count:data.length/6,lineCount:line.length/3}:{});}return this.resources.get(solid);}
  resize(){let r=this.canvas.parentElement.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(w!==this.canvas.width||h!==this.canvas.height){this.canvas.width=w;this.canvas.height=h;if(this.backend==='WebGPU'){this.depthTexture?.destroy();this.msaaTexture?.destroy();this.depthTexture=this.device.createTexture({size:[w,h],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});this.msaaTexture=this.device.createTexture({size:[w,h],format:this.format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});}}this.cssWidth=r.width;this.cssHeight=r.height;this.camera.matrices(r.width,r.height);}
  sceneData(){
    const bb=mergeBounds(this.bodies.map(b=>b.solid.bounds)),radius=Math.max(50,V.len(bb.size)*.65),center=bb.center,eye=V.add(center,V.mul(LIGHT,radius*3)),lightVP=M.mul(M.ortho(-radius,radius,-radius,radius,.1,radius*7),M.lookAt(eye,center));
    const section=[0,0,0,this.section.position];section[this.section.axis]=1;this.lightVP=lightVP;this.sceneSection=section;this.sceneOptions=[this.section.enabled?1:0,this.dark?1:0,this.grid?1:0,this.mode==='flat'?1:0];return new Float32Array([...this.camera.vp,...lightVP,...this.camera.eye,1,...LIGHT,1,...section,...this.sceneOptions]);
  }
  request(){if(this.pending||this.disposed)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;try{this.render();}catch(e){console.error(e);this.onError(e.message);}});}
  render(){if(this.backend==='Starting'||this.backend==='WebGPU device lost'||this.disposed)return;const start=performance.now();this.resize();this.sceneData();this.drawCalls=0;
    if(this.backend==='WebGPU')this.renderGPU();else if(this.backend==='WebGL2 fallback')this.renderGL();else this.renderCanvas();
    this.lastStats={renderMs:performance.now()-start,triangles:this.bodies.reduce((s,b)=>s+metrics(b.solid).triangles,0),drawCalls:this.drawCalls,backend:this.backend};this.onFrame(this.lastStats);
  }
  updateHighlight(){if(!this.highlightDirty)return;this.highlightDirty=false;this.highlightGPU?.destroy();if(this.highlightGL){this.gl.deleteBuffer(this.highlightGL.buffer);this.gl.deleteVertexArray(this.highlightGL.vao);}this.highlightGPU=null;this.highlightGL=null;this.highlightCount=0;
    if(!this.highlight||!this.bodies.some(b=>b.id===this.highlight.body.id))return;let d=[];for(const t of this.highlight.body.solid.triangles())if(t.face===this.highlight.tri.face)for(const v of t.vertices)d.push(...v,...t.normal);this.highlightCount=d.length/6;if(this.backend==='WebGPU')this.highlightGPU=this.gpuBuffer(new Float32Array(d));else if(this.gl)this.highlightGL=this.glMesh(new Float32Array(d));
  }
  renderGPU(){
    const d=this.device;d.queue.writeBuffer(this.sceneBuffer,0,this.sceneData());this.updateHighlight();for(const b of this.bodies){const material=MATERIALS[b.material]||MATERIALS.aluminum,r=this.gpuObject(b.id);d.queue.writeBuffer(r.buffer,0,new Float32Array([...rgb(b.color),1,material.metallic,material.roughness,this.selected.has(b.id)?1:0,0]));this.getResource(b.solid);}
    const encoder=d.createCommandEncoder({label:'Avolith frame'});
    if(this.shadowDirty){const pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(this.shadowPipeline);pass.setBindGroup(0,this.shadowGroup);if(this.shadows)for(const b of this.bodies){const r=this.getResource(b.solid);pass.setVertexBuffer(0,r.vertices);pass.draw(r.count);this.drawCalls++;}pass.end();this.shadowDirty=false;}
    const bg=this.dark?[.094,.118,.15]:[.939,.951,.964];const pass=encoder.beginRenderPass({colorAttachments:[{view:this.msaaTexture.createView(),resolveTarget:this.context.getCurrentTexture().createView(),clearValue:{r:bg[0],g:bg[1],b:bg[2],a:1},loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:this.depthTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    pass.setBindGroup(0,this.sceneGroup);pass.setPipeline(this.surfacePipeline);pass.setBindGroup(1,this.floorObject.group);pass.setVertexBuffer(0,this.floorBuffer);pass.draw(6);this.drawCalls++;
    if(this.mode!=='wire')for(const b of this.bodies){let r=this.getResource(b.solid);pass.setBindGroup(1,this.gpuObject(b.id).group);pass.setVertexBuffer(0,r.vertices);pass.draw(r.count);this.drawCalls++;}
    if(this.edges||this.mode==='wire'){pass.setPipeline(this.linePipeline);for(const b of this.bodies){let r=this.getResource(b.solid);pass.setBindGroup(1,this.gpuObject(b.id).group);pass.setVertexBuffer(0,r.lines);pass.draw(r.lineCount);this.drawCalls++;}}
    if(this.highlightGPU&&this.mode!=='wire'){pass.setPipeline(this.highlightPipeline);pass.setBindGroup(1,this.gpuObject(this.highlight.body.id).group);pass.setVertexBuffer(0,this.highlightGPU);pass.draw(this.highlightCount);this.drawCalls++;}
    pass.end();d.queue.submit([encoder.finish()]);
  }
  renderGL(){
    const gl=this.gl;this.updateHighlight();const set=(p,n,v)=>{const l=this.uniform(p,n);if(v.length===16)gl.uniformMatrix4fv(l,false,v);else if(v.length===4)gl.uniform4fv(l,v);else if(v.length===3)gl.uniform3fv(l,v);else gl.uniform1f(l,v);};
    if(this.shadowDirty){gl.bindFramebuffer(gl.FRAMEBUFFER,this.glShadowFB);gl.viewport(0,0,2048,2048);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);gl.useProgram(this.glShadowProgram);set(this.glShadowProgram,'uLightVP',this.lightVP);set(this.glShadowProgram,'uSection',this.sceneSection);set(this.glShadowProgram,'uOptions',this.sceneOptions);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1.5,2);if(this.shadows)for(const b of this.bodies){let r=this.getResource(b.solid);gl.bindVertexArray(r.vertices.vao);gl.drawArrays(gl.TRIANGLES,0,r.count);this.drawCalls++;}gl.disable(gl.POLYGON_OFFSET_FILL);this.shadowDirty=false;}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);const bg=this.dark?[.094,.118,.15]:[.939,.951,.964];gl.clearColor(...bg,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.glProgram);
    const p=this.glProgram;set(p,'uVP',this.camera.vp);set(p,'uLightVP',this.lightVP);set(p,'uEye',this.camera.eye);set(p,'uLight',LIGHT);set(p,'uSection',this.sceneSection);set(p,'uOptions',this.sceneOptions);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.glShadowTexture);gl.uniform1i(this.uniform(p,'uShadow'),0);gl.depthFunc(gl.LESS);gl.depthMask(true);gl.disable(gl.BLEND);set(p,'uLine',0);set(p,'uColor',[.94,.95,.96,1]);set(p,'uProps',[0,1,0,1]);gl.bindVertexArray(this.glFloor.vao);gl.drawArrays(gl.TRIANGLES,0,6);this.drawCalls++;
    const mat=b=>{const m=MATERIALS[b.material]||MATERIALS.aluminum;set(p,'uColor',[...rgb(b.color),1]);set(p,'uProps',[m.metallic,m.roughness,this.selected.has(b.id)?1:0,0]);};
    if(this.mode!=='wire')for(const b of this.bodies){let r=this.getResource(b.solid);mat(b);gl.bindVertexArray(r.vertices.vao);gl.drawArrays(gl.TRIANGLES,0,r.count);this.drawCalls++;}
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.depthFunc(gl.LEQUAL);
    if(this.edges||this.mode==='wire'){set(p,'uLine',1);for(const b of this.bodies){let r=this.getResource(b.solid);mat(b);gl.bindVertexArray(r.lines.vao);gl.drawArrays(gl.LINES,0,r.lineCount);this.drawCalls++;}}
    if(this.highlightGL&&this.mode!=='wire'){set(p,'uLine',2);mat(this.highlight.body);gl.bindVertexArray(this.highlightGL.vao);gl.drawArrays(gl.TRIANGLES,0,this.highlightGL.count);this.drawCalls++;}
    gl.depthMask(true);gl.bindVertexArray(null);
  }
  renderCanvas(){
    const c=this.ctx,dpr=this.canvas.width/this.cssWidth;c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle=this.dark?'#18202a':'#eff3f6';c.fillRect(0,0,this.cssWidth,this.cssHeight);
    if(this.grid){c.strokeStyle=this.dark?'#29323e':'#dce2e8';c.lineWidth=.6;for(let i=-200;i<=200;i+=10){for(const [a,b]of [[[i,-200,0],[i,200,0]],[[-200,i,0],[200,i,0]]]){let p=this.camera.project(a),q=this.camera.project(b);c.beginPath();c.moveTo(...p.slice(0,2));c.lineTo(...q.slice(0,2));c.stroke();}}}
    let tris=[];for(const b of this.bodies){const base=rgb(b.color);for(const t of b.solid.triangles()){let center=V.mul(t.vertices.reduce(V.add,[0,0,0]),1/3);if(this.section.enabled&&center[this.section.axis]>this.section.position)continue;if(V.dot(t.normal,V.sub(this.camera.eye,center))<0)continue;let ps=t.vertices.map(v=>this.camera.project(v)),shade=.52+.48*Math.max(0,V.dot(t.normal,LIGHT)),color=base.map(x=>Math.round(x*shade*255));tris.push({ps,z:ps.reduce((s,p)=>s+p[2],0),color,b,t});}}
    tris.sort((a,b)=>b.z-a.z);for(const t of tris){c.beginPath();c.moveTo(...t.ps[0].slice(0,2));c.lineTo(...t.ps[1].slice(0,2));c.lineTo(...t.ps[2].slice(0,2));c.closePath();c.fillStyle=`rgb(${t.color.join(',')})`;if(this.mode!=='wire'){c.fill();c.strokeStyle=c.fillStyle;c.lineWidth=.45;c.stroke();}else{c.strokeStyle=c.fillStyle;c.lineWidth=.5;c.stroke();}if(this.highlight?.body.id===t.b.id&&this.highlight?.tri.face===t.t.face){c.fillStyle='#ff9e4266';c.fill();}}
    this.drawCalls=tris.length;
  }
  pick(x,y){
    this.camera.matrices(this.cssWidth,this.cssHeight);const ray=this.camera.ray(x,y);let best=null;for(const b of this.bodies){if(b.locked)continue;const hit=b.solid.bvh().hit(ray.origin,ray.direction,best?.t??Infinity,p=>!this.section.enabled||p[this.section.axis]<=this.section.position+1e-6);if(hit)best={...hit,body:b};}return best;
  }
  async analyzeGPU(solid){
    if(this.backend!=='WebGPU')throw Error('GPU analysis needs the WebGPU backend. CPU measurements remain available.');const tris=solid.triangles();if(!tris.length)return {area:0,signedVolume:0,triangles:0,ms:0};const start=performance.now(),d=this.device,data=new Float32Array(tris.length*12);for(let i=0;i<tris.length;i++)for(let j=0;j<3;j++)data.set([...tris[i].vertices[j],0],i*12+j*4);
    const input=d.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),output=d.createBuffer({size:tris.length*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:tris.length*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{d.queue.writeBuffer(input,0,data);let bg=d.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]}),enc=d.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(this.computePipeline);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(Math.ceil(tris.length/128));pass.end();enc.copyBufferToBuffer(output,0,read,0,tris.length*8);d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);let values=new Float32Array(read.getMappedRange()),area=0,signedVolume=0;for(let i=0;i<values.length;i+=2){area+=values[i];signedVolume+=values[i+1];}read.unmap();return {area,signedVolume,volume:Math.abs(signedVolume),triangles:tris.length,ms:performance.now()-start,precision:'float32 GPU, float64 reduction'};}finally{input.destroy();output.destroy();read.destroy();}
  }
  async capture(){
    this.render();
    if(this.backend!=='WebGPU')return new Promise(resolve=>this.canvas.toBlob(resolve,'image/png'));
    // Copy the current swap texture before yielding; presentation invalidates it.
    const width=this.canvas.width,height=this.canvas.height,row=Math.ceil(width*4/256)*256;
    if(width*height>16777216)throw Error('Viewport capture exceeds the 16-megapixel budget.');
    const read=this.device.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=this.device.createCommandEncoder({label:'Stable viewport readback'});
      encoder.copyTextureToBuffer({texture:this.context.getCurrentTexture()},{buffer:read,bytesPerRow:row,rowsPerImage:height},[width,height]);
      this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      const src=new Uint8Array(read.getMappedRange()),rgba=new Uint8ClampedArray(width*height*4),bgra=this.format.startsWith('bgra');
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*row+x*4,j=(y*width+x)*4;rgba[j]=src[i+(bgra?2:0)];rgba[j+1]=src[i+1];rgba[j+2]=src[i+(bgra?0:2)];rgba[j+3]=255;}
      const image=document.createElement('canvas');image.width=width;image.height=height;image.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
      return await new Promise(resolve=>image.toBlob(resolve,'image/png'));
    }finally{read.destroy();}
  }
  dispose(){this.disposed=true;this.observer?.disconnect();this.device?.destroy();}
}
