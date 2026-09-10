import{initialize3dm}from'./native-3dm.js';let engine;
self.onmessage=async({data:{id,command,args}})=>{try{engine??=initialize3dm();self.postMessage({id,result:await(await engine).run(command,args)});}catch(e){self.postMessage({id,error:{message:e.message||String(e)}});}};
