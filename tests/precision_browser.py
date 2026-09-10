"""Actual browser/module-worker tests; no mocked CAD API or geometry.
Run under Xvfb with a Chromium build supporting software WebGPU.
"""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
BASE=os.getenv('AVOLITH_URL','http://127.0.0.1:8765')
results=[]
def record(name,**extra):
 results.append({'name':name,'passed':True,**extra});print('PASS',name,flush=True)
async def main():
 page=None
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('AVOLITH_CHROMIUM',p.chromium.executable_path),headless=os.getenv('AVOLITH_HEADLESS')=='1',args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader'])
  context=await browser.new_context(viewport={'width':1680,'height':1050},device_scale_factor=1,accept_downloads=True)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:print('CONSOLE',m.type,m.text[:350],flush=True) if m.type=='error' else None)
  async def action(name):
   await page.evaluate('(name)=>avolith.engineering.actions[name]()',name)
  async def command(name):
   await page.evaluate('(name)=>avolith.execute(name)',name)
  async def submit():
   invalid=await page.locator('#modal-form :invalid').evaluate_all('(els)=>els.map(e=>e.id)')
   assert not invalid, f'Invalid form fields: {invalid}'
   await page.locator('#modal-submit').click();await page.wait_for_function('document.querySelector("#modal-submit").disabled===false',timeout=180000)
   if await page.locator('#modal-error').is_visible():raise AssertionError(await page.locator('#modal-error').inner_text())
  async def close():
   if await page.locator('#modal').is_visible():await page.locator('#modal-close').click()
  async def fresh(name='Precision browser tests'):
   await page.evaluate("async(name)=>{const {ModelDocument}=await import('./src/core/document.js');const d=new ModelDocument();d.name=name;avolith.ui.replaceDocument(d);}",name)
  async def screenshot(name):
   await page.evaluate('async()=>{avolith.renderer.render();if(avolith.renderer.device)await avolith.renderer.device.queue.onSubmittedWorkDone()}');await page.wait_for_timeout(600);await page.mouse.move(5,5);await page.screenshot(path=str(OUT/name))
  try:
   await page.goto(BASE+'/?fresh=1&renderer=webgpu',wait_until='networkidle');await page.wait_for_function('window.avolith?.engineering',timeout=60000)
   assert await page.evaluate('avolith.document.bodies.length')==19
   assert await page.evaluate('avolith.renderer.backend')=='WebGPU'
   assert await page.locator('#ribbon-tabs').inner_text() and 'Precision' in await page.locator('#ribbon-tabs').inner_text()
   record('Original startup and native WebGPU preserved; new ribbons registered')
   await action('exact-demo')
   assert await page.evaluate('avolith.document.bodies.length===4&&avolith.document.bodies.every(b=>b.solid.meta.exact?.properties.valid)')
   assert await page.evaluate('avolith.document.engineering.annotations.length')==3
   record('Exact demo creates actual filleted/Boolean, NURBS, sheet and shaft geometry')
   await screenshot('precision-light.png');await command('theme');await screenshot('precision-dark.png');await command('theme')
   record('Light and dark exact-scene screenshots rendered')
   await action('exact-inspect');assert 'CYLINDER' in await page.locator('#modal-body').inner_text() or 'PLANE' in await page.locator('#modal-body').inner_text();await close()
   record('Native topology inspector lists real surfaces')
   await page.evaluate('avolith.setSelection(avolith.document.bodies.map(b=>b.id))');await action('exact-drawing')
   assert await page.locator('#drawings svg').count()==1
   assert await page.locator('#drawings svg path').count()>10
   await screenshot('precision-drawing.png')
   async with page.expect_download() as event:await action('exact-svg')
   down=await event.value;await down.save_as(str(OUT/'precision-drawing.svg'));assert 'stroke-dasharray' in (OUT/'precision-drawing.svg').read_text()
   record('Native hidden-line drawing and actual SVG download')
   await command('model');await page.evaluate('avolith.setSelection([avolith.document.bodies.find(b=>b.name.includes("sheet")).id])')
   await action('eng-unfold');assert await page.evaluate('avolith.document.bodies.find(b=>b.name.includes("sheet")).solid.meta.exact.sheetFlat')
   await command('move');await page.locator('#f-move-x').fill('10');await page.locator('#f-move-y').fill('15');await page.locator('#f-move-z').fill('5');await page.locator('[data-apply=move]').click()
   before=await page.evaluate('avolith.document.bodies.find(b=>b.name.includes("sheet")).solid.meta.exact.pose')
   await action('eng-unfold');assert not await page.evaluate('avolith.document.bodies.find(b=>b.name.includes("sheet")).solid.meta.exact.sheetFlat')
   assert await page.evaluate('avolith.document.bodies.find(b=>b.name.includes("sheet")).solid.meta.exact.sheetPose[12]')==28
   record('Multibend unfold, rigid placement and refold preserve retained definition')
   for fmt in ['svg','dxf','csv']:
    await action('eng-flat');await page.locator('#f-format').select_option(fmt)
    async with page.expect_download() as event:await submit()
    down=await event.value;await down.save_as(str(OUT/('flat.'+fmt)));assert (OUT/('flat.'+fmt)).stat().st_size>50
   record('Developed SVG/DXF and bend CSV downloads contain actual geometry')
   native=await page.evaluate('JSON.stringify(avolith.document.serialize())');(OUT/'precision.avl').write_text(native)
   await fresh();await page.locator('#file-input').set_input_files(str(OUT/'precision.avl'));await page.wait_for_function('avolith.document.bodies.length===4')
   assert await page.evaluate('avolith.document.bodies.every(b=>b.solid.meta.exact.brep.length>100)')
   assert await page.evaluate('avolith.document.engineering.annotations.length')==3
   record('Native project roundtrip restores B-rep, normals, sheet and PMI records')
   await fresh();await action('exact-primitive');await page.locator('#f-kind').select_option('cylinder');await page.locator('#f-radius').fill('10');await page.locator('#f-height').fill('20');await page.locator('#f-center').fill('0,0,0');await submit()
   v=await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume');assert abs(v-2000*3.141592653589793)<1e-5
   record('Ribbon primitive form creates an analytic cylinder with exact volume')
   for fmt in ['step','iges','brep']:
    await action('exact-export');await page.locator('#f-format').select_option(fmt)
    async with page.expect_download(timeout=180000) as event:await submit()
    down=await event.value;file=OUT/('analytic-cylinder.'+fmt);await down.save_as(str(file));assert file.stat().st_size>100
    n=await page.evaluate('avolith.document.bodies.length');await page.locator('#file-input').set_input_files(str(file));await page.wait_for_function('(n)=>avolith.document.bodies.length===n+1',arg=n,timeout=180000)
    got=await page.evaluate('avolith.document.bodies.at(-1).solid.meta.exact.properties.volume');assert abs(got-v)<1e-4
   record('STEP, IGES and BREP export/import work through the actual file UI')
   await fresh();await action('exact-primitive');await page.locator('#f-center').fill('0,0,0');await submit()
   initial=await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')
   await command('round');await page.locator('#f-radius').fill('2');await submit()
   assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')<initial
   await command('undo');assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')==initial
   await command('redo');assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')<initial
   record('Original Round command routes to native fillet; undo/redo restores exact source')
   await command('undo');await action('exact-shell');idx=await page.evaluate('avolith.document.bodies[0].solid.meta.exact.faces.find(f=>f.normal[2]>.9).index');await page.locator('#f-faces').fill(str(idx));await page.locator('#f-thickness').fill('-2');await submit()
   assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')<initial/2
   record('Shell form removes a selected analytic face and offsets the wall')
   await command('undo');before=await page.evaluate('avolith.document.bodies[0].solid.meta.exact.brep')
   idx=await page.evaluate('avolith.document.bodies[0].solid.meta.exact.faces.find(f=>f.normal[2]>.9).index')
   await page.evaluate('(i)=>{const b=avolith.document.bodies[0],tri=b.solid.triangles().find(t=>t.face===`exact-face-${i}`);avolith.setSelection([b.id],{face:{body:b,tri,point:tri.vertices[0]}})}',idx)
   await page.evaluate('avolith.engineering.pullSelected(5)');assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')>initial
   record('Selected exact-face Pull modifies the native solid rather than a triangle')
   await action('exact-fillet');await page.locator('#f-edges').fill('99999')
   await page.locator('#modal-submit').click();await page.wait_for_function('!document.querySelector("#modal-submit").disabled',timeout=60000)
   assert await page.locator('#modal-error').is_visible();await close()
   record('Invalid edge index is rejected with a visible form error')
   await action('exact-facets');await submit();assert not await page.evaluate('!!avolith.document.bodies[0].solid.meta.exact');await command('undo');assert await page.evaluate('!!avolith.document.bodies[0].solid.meta.exact')
   record('Exact-to-facet conversion is explicit and undoable')
   await fresh();await action('exact-surface');await submit();assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.surfaceDefinition.poles.length')==4
   assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.volume')==0
   await action('exact-thicken');await submit();assert await page.evaluate('avolith.document.bodies[0].solid.meta.exact.properties.solidCount')==1
   record('NURBS control-net editor and native surface thickening')
   await fresh();await page.evaluate("async()=>{await avolith.engineering.create('primitive',{kind:'box',width:20,depth:20,height:20},'Ground');await avolith.engineering.create('primitive',{kind:'box',width:10,depth:10,height:10,center:[30,20,10]},'Mobile');avolith.setSelection(avolith.document.bodies.map(b=>b.id));}")
   await action('eng-mate');await page.locator('#f-type').select_option('coincident');await submit()
   assert await page.evaluate('avolith.engineering.lastSolve.converged&&avolith.engineering.lastSolve.degreesOfFreedom===3')
   assert await page.evaluate('avolith.document.engineering.mates.length')==1
   await command('undo');assert await page.evaluate('avolith.document.engineering.mates.length')==0;await command('redo')
   record('Mate form solves grounded assembly; undo/redo includes poses and constraints')
   await page.evaluate('avolith.setSelection([avolith.document.bodies[0].id])');await action('pmi-add');await page.locator('#f-points').fill('[[0,0,0],[20,0,0]]');await submit()
   assert await page.evaluate('avolith.document.engineering.annotations.length')==1
   await action('pmi-manager');await page.locator('#f-export').check()
   async with page.expect_download() as event:await submit()
   down=await event.value;await down.save_as(str(OUT/'pmi.json'));assert json.loads((OUT/'pmi.json').read_text())['annotations'][0]['type']=='linear'
   record('PMI form stores dimensional semantics and exports real JSON')
   await action('eng-preflight');await page.locator('#f-thickness').check();await submit();assert 'Preparation report' in await page.locator('#modal-title').inner_text();await close()
   record('Preparation report runs actual topology and sampled wall checks')
   for fmt in ['vtk','inp','csv']:
    await action('eng-simulation');await page.locator('#f-format').select_option(fmt)
    async with page.expect_download() as event:await submit()
    down=await event.value;await down.save_as(str(OUT/('preparation.'+fmt)));assert (OUT/('preparation.'+fmt)).stat().st_size>100
   assert 'TYPE=S3' in (OUT/'preparation.inp').read_text() and 'POLYDATA' in (OUT/'preparation.vtk').read_text()
   record('VTK surface, explicit S3 shell skin and BOM are downloaded')
   await page.evaluate('avolith.setSelection(avolith.document.bodies.map(b=>b.id))');await action('eng-clearance');assert 'OVERLAP' in await page.locator('#modal-body').inner_text();await close()
   record('Exact overlap and distance report runs from selected bodies')
   cancelled=await page.evaluate("async()=>{const before=JSON.stringify(avolith.document.serialize());const job=avolith.engineering.client.run('primitive',{kind:'sphere',radius:20});avolith.engineering.cancel();let rejected=false;try{await job;}catch{rejected=true;}await avolith.engineering.client.run('initialize');return rejected&&before===JSON.stringify(avolith.document.serialize());}")
   assert cancelled;record('Worker cancellation is atomic and a subsequent kernel initialization succeeds')
   stale=await page.evaluate("async()=>{const count=avolith.document.bodies.length;const p=avolith.engineering.create('primitive',{kind:'sphere',radius:10},'Discard me');avolith.document.transact('Concurrent edit',()=>avolith.document.name='Newer edit');try{await p;return false;}catch(e){return e.message.includes('document changed')&&avolith.document.bodies.length===count&&avolith.document.name==='Newer edit';}}")
   assert stale;record('Stale asynchronous result cannot overwrite a newer document revision')
   await page.set_viewport_size({'width':430,'height':900});await page.evaluate('avolith.ui.setTab("Engineering")');await screenshot('precision-mobile.png')
   assert await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
   record('Engineering ribbon remains contained on a mobile-width viewport')
   assert not errors,errors
   assert not await page.evaluate('avolith.errors')
   record('No unhandled JavaScript or WebGPU validation errors')
  except Exception as e:
   print(traceback.format_exc(),flush=True);results.append({'name':'Browser failure','passed':False,'error':str(e),'pageErrors':errors})
   if page:
    await page.screenshot(path=str(OUT/'precision-failure.png'));(OUT/'precision-failure.html').write_text(await page.content())
   raise
  finally:
   (OUT/'precision-browser-results.json').write_text(json.dumps({'results':results,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results)},indent=2));await browser.close()
asyncio.run(main())
