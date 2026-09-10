import {motionStudy} from './motion.js';
self.onmessage=({data:{id,command,args}})=>{try{if(command!=='motion')throw Error('Unknown analysis command.');self.postMessage({id,result:motionStudy(args.bodies,args.mates,args.grounded,args.options)});}catch(e){self.postMessage({id,error:{message:e.message||String(e)}});}};
