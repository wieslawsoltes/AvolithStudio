/** IGES bridge isolated from the modern modeling kernel. Geometry passes through STEP;
 * materials, product structure, and PMI are not preserved by this bridge.
 */
export async function initializeIGES(options={}){
  const base=options.baseURL||new URL('../../vendor/iges/',import.meta.url);let wasmBinary;
  if(typeof process!=='undefined'&&process.versions?.node){
    const [{createRequire},fs,url]=await Promise.all([import('node:module'),import('node:fs'),import('node:url')]);
    globalThis.require??=createRequire(import.meta.url);globalThis.__dirname=url.fileURLToPath(base);wasmBinary=fs.readFileSync(new URL('opencascade.wasm.wasm',base));
  }
  const {default:init}=await import(new URL('opencascade.wasm.js',base));
  const oc=await init({wasmBinary,locateFile:name=>new URL(name,base).href,print:()=>{},printErr:()=>{}});
  oc.STEPControl_Controller.Init();
  return {oc,version:'IGES bridge 1.0',async run(command,args={}){
    if(!['toSTEP','toIGES'].includes(command))throw Error('Unsupported IGES bridge operation.');
    const data=args.data;
    if(typeof data!=='string'||data.length<80||data.length>32*1024*1024)throw Error('Invalid or oversized exchange file.');
    if(command==='toIGES'&&!data.includes('ISO-10303-21'))throw Error('The IGES writer needs STEP data from the exact kernel.');
    const input=command==='toSTEP'?'/file.igs':'/file.stp',output=command==='toSTEP'?'/out.stp':'/out.igs',owned=[];
    const own=x=>(owned.push(x),x);
    if(command==='toSTEP')oc.IGESControl_Controller.Init();else oc.STEPControl_Controller.Init();
    oc.FS.writeFile(input,data);
    try{
      const reader=own(command==='toSTEP'?new oc.IGESControl_Reader_1():new oc.STEPControl_Reader_1());
      const status=reader.ReadFile(input), roots=reader.TransferRoots();if(status.value!==oc.IFSelect_ReturnStatus.IFSelect_RetDone.value||roots<1)throw Error('The CAD translator could not transfer any roots from this file.');
      const shape=own(reader.OneShape());if(shape.IsNull())throw Error('The translated shape is empty.');
      if(command==='toSTEP'){
        const writer=own(new oc.STEPControl_Writer_1());
        if(writer.Transfer(shape,oc.STEPControl_StepModelType.STEPControl_AsIs,true).value!==oc.IFSelect_ReturnStatus.IFSelect_RetDone.value||writer.Write(output).value!==oc.IFSelect_ReturnStatus.IFSelect_RetDone.value)throw Error('STEP bridge write failed.');
      }else{
        const writer=own(new oc.IGESControl_Writer_2('MM',1));
        if(!writer.AddShape(shape))throw Error('IGES writer rejected the shape.');writer.ComputeModel();
        if(!writer.Write_2(output,false))throw Error('IGES write failed.');
      }
      return {data:oc.FS.readFile(output,{encoding:'utf8'}),extension:command==='toSTEP'?'step':'iges',mime:'application/octet-stream',warnings:['Geometry-only translation. Product hierarchy, colors and PMI are not transferred by this IGES bridge.']};
    }catch(error){if(typeof error==='number')throw Error('The native IGES translator rejected this geometry.');throw error;}
    finally{for(const x of owned.reverse())try{x.delete();}catch{};for(const file of [input,output])try{oc.FS.unlink(file);}catch{}}
  }};
}
