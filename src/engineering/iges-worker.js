import {initializeIGES} from './iges-engine.js';
let engine=null,queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.catch(()=>{}).then(async()=>{try{engine??=initializeIGES().catch(e=>{engine=null;throw e;});const e=await engine;self.postMessage({id:data.id,result:data.command==='initialize'?{version:e.version}:await e.run(data.command,data.args)});}catch(error){self.postMessage({id:data.id,error:{message:error?.message||String(error)}});}});};
