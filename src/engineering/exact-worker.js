import {initializeExact} from './exact-engine.js';
let enginePromise=null,queue=Promise.resolve();
self.onmessage=({data})=>{
  const {id,command,args}=data;
  queue=queue.catch(()=>{}).then(async()=>{
    try{
      enginePromise??=initializeExact({log:()=>{}}).catch(e=>{enginePromise=null;throw e;});
      const engine=await enginePromise;
      const result=command==='initialize'?{version:engine.version}:await engine.run(command,args);
      self.postMessage({id,result});
    }catch(error){self.postMessage({id,error:{message:error?.message||String(error),name:error?.name||'Error'}});}
  });
};
