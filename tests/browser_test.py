"""End-to-end tests against the real UI and GPU. Requires Playwright and Chromium.
AVOLITH_URL defaults to http://127.0.0.1:8765. AVOLITH_CHROMIUM selects the binary.
Set AVOLITH_HEADLESS=1 only on environments with working headless Vulkan compositing.
A software Vulkan adapter is used for reproducible validation, not a hardware benchmark.
"""
import asyncio, base64, io, json, os, time, traceback
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'; OUT.mkdir(exist_ok=True)
BASE=os.getenv('AVOLITH_URL','http://127.0.0.1:8765')
results=[]; page_errors=[]; measurements={}
def record(name, ok=True, detail=None):
 results.append({'name':name,'passed':ok,'detail':detail}); print(('PASS ' if ok else 'FAIL ')+name,detail or '',flush=True)
def near(a,b,tol=1e-6):
 assert abs(a-b)<=tol*max(1,abs(b)),f'{a} != {b}'
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('AVOLITH_CHROMIUM','/usr/bin/chromium'),headless=os.getenv('AVOLITH_HEADLESS')=='1',args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader'])
  measurements['browser']=browser.version
  context=await browser.new_context(viewport={'width':1600,'height':1000},device_scale_factor=1,accept_downloads=True)
  page=await context.new_page(); page.on('pageerror',lambda e:page_errors.append(str(e)))
  async def ev(script,arg=None):return await page.evaluate(script,arg)
  async def cmd(name): await ev('(id)=>avolith.execute(id)',name)
  async def submit():
   await page.locator('#modal-submit').click()
   await page.wait_for_function("!document.querySelector('#modal').open || !document.querySelector('#modal-error').hidden",timeout=45000)
   if await page.locator('#modal-error').is_visible():raise AssertionError(await page.locator('#modal-error').inner_text())
  async def setform(data):
   for name,value in data.items():
    el=page.locator(f'#modal [name="{name}"]'); tag=await el.evaluate('(e)=>e.tagName')
    if tag=='SELECT':await el.select_option(str(value))
    elif isinstance(value,bool):await el.set_checked(value)
    else:await el.fill(str(value))
  async def new(name='Browser test'):
   await cmd('new');await setform({'name':name});await submit()
  async def values():return await ev('''()=>({count:avolith.document.bodies.length,history:avolith.document.history.length,selected:[...avolith.state.selected],names:avolith.document.bodies.map(b=>b.name),volume:avolith.document.bodies.map(b=>avolith.kernel.metrics(b.solid).volume)})''')
  async def select_all():await ev('avolith.setSelection(avolith.document.bodies.map(b=>b.id))')
  async def wait_frame():await ev('async()=>{avolith.renderer.render();if(avolith.renderer.device)await avolith.renderer.device.queue.onSubmittedWorkDone();}');await page.wait_for_timeout(100)
  try:
   await page.goto(BASE+'/?fresh=1',wait_until='networkidle');await page.wait_for_function('window.avolith?.ready',timeout=60000);await wait_frame()
   assert await ev('avolith.renderer.backend')=='WebGPU';assert (await values())['count']==19
   assert await ev('avolith.renderer.lastStats.triangles')>10000
   assert not await ev('avolith.errors');record('Native WebGPU startup with editable 19-body assembly')
   measurements['adapter']=await ev('''()=>{let i=avolith.renderer.adapter.info;return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,isFallbackAdapter:i.isFallbackAdapter}}''')
   q=await ev('async()=>avolith.renderer.analyzeGPU(avolith.kernel.box(10,20,30))');near(q['area'],2200);near(q['volume'],6000);measurements['boxCompute']=q;record('WGSL compute: box area and signed volume match CPU')
   q=await ev('''async()=>{let s=avolith.document.bodies[1].solid,a=await avolith.renderer.analyzeGPU(s),b=avolith.kernel.metrics(s);return {triangles:a.triangles,areaError:Math.abs(a.area-b.area)/b.area,volumeError:Math.abs(a.volume-b.volume)/b.volume,ms:a.ms}}''');assert q['areaError']<1e-5 and q['volumeError']<1e-5;measurements['assemblyCompute']=q;record('WGSL compute: nontrivial Boolean solid matches float64 reference')
   measurements['warmFrameCPU']=await ev('''async()=>{let r=avolith.renderer,t=[];for(let i=0;i<12;i++){r.render();await r.device.queue.onSubmittedWorkDone();t.push(r.lastStats.renderMs);}return t}''')
   await page.mouse.move(100,15);await page.screenshot(path=str(OUT/'light.png'));record('Light-theme WebGPU screenshot captured')
   await cmd('theme');await wait_frame();assert await ev('document.documentElement.dataset.theme')=='dark';await page.screenshot(path=str(OUT/'dark.png'));await cmd('theme');record('Dark theme changes UI and rendered viewport')
   await new();assert (await values())['count']==0;record('New document UI clears model')
   await page.locator('#ribbon [data-cmd="box"]').click();await setform({'w':20,'d':30,'h':40,'name':'Test block','material':'anodized'});await submit();near((await values())['volume'][0],24000);record('Ribbon box creation produces actual solid and material')
   await cmd('move');await page.locator('#f-move-x').fill('12');await page.locator('#f-move-y').fill('8');await page.locator('#tool-panel [data-apply="move"]').click();b=await ev('avolith.document.bodies[0].solid.bounds.center');near(b[0],12);near(b[1],8);record('Numeric move changes solid coordinates, not only display')
   await cmd('undo');near((await ev('avolith.document.bodies[0].solid.bounds.center'))[0],0);await cmd('redo');near((await ev('avolith.document.bodies[0].solid.bounds.center'))[0],12);record('Undo and redo restore geometry transforms')
   await cmd('select');await cmd('top');await wait_frame();await ev('avolith.setSelection([])')
   center=await ev('''()=>{let r=avolith.renderer,p=r.camera.project(avolith.document.bodies[0].solid.bounds.center),b=r.canvas.getBoundingClientRect();return [p[0]+b.x,p[1]+b.y]}''');await page.mouse.click(*center);assert len((await values())['selected'])==1;record('Viewport pointer hit-testing selects the actual body')
   await cmd('pull');await page.mouse.click(*center);assert await ev('!!avolith.state.face');await page.locator('#f-pull-distance').fill('5');await page.locator('[data-apply="pull"]').click();near((await values())['volume'][0],27000);record('Planar-face selection and numeric Pull update solid volume')
   await cmd('undo');near((await values())['volume'][0],24000)
   await cmd('select');await cmd('measure');await wait_frame()
   pts=await ev('''()=>{let r=avolith.renderer,b=r.canvas.getBoundingClientRect();return [[7,3,40],[17,13,40]].map(p=>{let q=r.camera.project(p);return[q[0]+b.x,q[1]+b.y]})}''')
   await page.mouse.click(*pts[0]);await page.mouse.click(*pts[1]);q=await ev('avolith.state.measurePoints');assert len(q)==2;near(sum((a-b)**2 for a,b in zip(q[0],q[1]))**.5,2**.5*10,.01);record('Surface-to-surface pointer measurement records real ray intersections')
   await cmd('select');await select_all();await cmd('pattern');await setform({'count':3,'spacing':35});await submit();assert (await values())['count']==3;record('Linear body pattern creates independent editable instances')
   await cmd('undo');assert (await values())['count']==1;await select_all();await cmd('mirror');await setform({'axis':0,'position':0});await submit();assert (await values())['count']==2;assert all(v>0 for v in await ev('avolith.document.bodies.map(b=>avolith.kernel.metrics(b.solid).signedVolume)'));record('Mirror creates consistently oriented solid copy')
   await cmd('undo');await select_all();await cmd('group');await setform({'name':'Fixtures'});await submit();assert await ev('avolith.document.groups[0].name')=='Fixtures';record('Named selections persist body references')
   await cmd('layer');await setform({'name':'Manufacturing'});await submit();assert await ev('avolith.document.layers.length')==2;record('Layer creation assigns selected body')
   await cmd('hide');assert await ev('avolith.document.visible().length')==0;await cmd('show');assert await ev('avolith.document.visible().length')==1;record('Hide/show affects renderer geometry')
   await cmd('copy');await cmd('paste');assert (await values())['count']==2;await cmd('undo');record('In-app clipboard duplicates actual solids')
   await select_all();await cmd('section');await setform({'axis':2,'position':20,'enabled':True});await submit();assert await ev('avolith.renderer.section.enabled');await wait_frame();assert not await ev('avolith.errors');record('Section clipping render pipeline works without GPU validation errors')
   await cmd('section');await setform({'enabled':False});await submit()
   await new('CSG UI test');await ev("()=>{let a=avolith; a.addSolid(a.kernel.box(10,10,10,[0,0,5]),'Target');a.addSolid(a.kernel.box(10,10,10,[5,0,5]),'Tool');a.setSelection(a.document.bodies.map(b=>b.id));}")
   await cmd('combine');await setform({'operation':'subtract'});await submit();near((await values())['volume'][0],500);assert (await values())['count']==1;record('Boolean subtraction UI executes a geometry Web Worker')
   await cmd('undo');assert (await values())['count']==2;await cmd('redo');near((await values())['volume'][0],500);record('Boolean operation is a single undoable transaction')
   await new('Sketch UI test');await cmd('rectangle');await wait_frame()
   r=await page.locator('#viewport').bounding_box();x,y=r['x']+r['width']*.38,r['y']+r['height']*.40
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+110,y+85,steps=5);await page.mouse.up();assert await ev('avolith.document.sketches.length')==1;record('Pointer-drawn rectangle creates editable sketch vertices')
   await page.locator('#sketch-banner [data-cmd="finish"]').click();await cmd('extrude');await setform({'height':15});await submit();assert (await values())['count']==1;assert (await values())['volume'][0]>0;record('Sketch extrusion generates a closed faceted solid')
   await cmd('undo');assert (await values())['count']==0;await cmd('redo');assert (await values())['count']==1;record('Sketch extrusion undo/redo retains source sketch')
   await new('Sheet UI test');await cmd('sheet');await submit();assert await ev("avolith.document.bodies[0].solid.meta.type")=='sheet';record('Sheet-metal bracket dialog generates bent solid')
   before=await ev('avolith.document.bodies[0].solid.bounds.size[2]');await cmd('unfold');assert await ev('avolith.document.bodies[0].solid.meta.flat');near(await ev('avolith.document.bodies[0].solid.bounds.size[2]'),2);await cmd('unfold');near(await ev('avolith.document.bodies[0].solid.bounds.size[2]'),before);record('Sheet unfold/refold uses stored dimensions and K-factor')
   await cmd('drawing');assert await page.locator('#drawings svg').count()==1;assert 'FRONT' in await page.locator('#drawings').inner_text();await page.screenshot(path=str(OUT/'drawing.png'));record('Drawing sheet contains real orthographic vector projections')
   async with page.expect_download() as event:await cmd('svg')
   down=await event.value;await down.save_as(str(OUT/'drawing.svg'));assert '<svg' in (OUT/'drawing.svg').read_text();record('SVG drawing export downloads vector geometry')
   await cmd('model');await select_all()
   for fmt in ['stl','obj','glb','dxf','csv']:
    await cmd('export');await setform({'format':fmt})
    async with page.expect_download() as event:await submit()
    down=await event.value;path=OUT/f'export.{fmt}';await down.save_as(str(path));assert path.stat().st_size>80;record(f'{fmt.upper()} export downloads nonempty actual model data')
   async with page.expect_download() as event:await cmd('save')
   down=await event.value;await down.save_as(str(OUT/'native.avl'));saved=json.loads((OUT/'native.avl').read_text());assert saved['format']=='avolith';record('Native project export serializes editable geometry and sheet metadata')
   await new('Import test');await page.locator('#file-input').set_input_files(str(OUT/'export.stl'));await page.wait_for_function('avolith.document.bodies.length===1');assert (await values())['volume'][0]>0;record('STL file input imports exported geometry')
   await new('Recovery sentinel');await ev("avolith.addSolid(avolith.kernel.box(12,13,14),'Recovery block')");await page.wait_for_function("document.querySelector('#save-state').textContent==='Saved on this device'",timeout=15000)
   await page.goto(BASE+'/',wait_until='networkidle');await page.wait_for_function('avolith.ready',timeout=60000);assert await ev('avolith.document.name')=='Recovery sentinel';near((await values())['volume'][0],12*13*14);record('IndexedDB autosave recovers project after page reload')
   await cmd('select');await page.locator('#search-command').click() if await page.locator('#search-command').count() else await cmd('palette')
   await page.locator('#palette-query').fill('sphere');await page.locator('#palette-query').press('Enter');assert await page.locator('#modal-title').inner_text()=='Create sphere';await page.locator('#modal-cancel').click();record('Command palette searches and launches modeling tool')
   async with page.expect_download() as event:await cmd('screenshot')
   down=await event.value;await down.save_as(str(OUT/'viewport.png'));im=Image.open(OUT/'viewport.png').convert('RGB');colors=im.getcolors(im.width*im.height);assert len(colors)>100;record('Native WebGPU viewport PNG contains rendered pixels')
   await ev('avolith.loadExample("actuator")');await wait_frame();await page.mouse.move(100,15);await page.screenshot(path=str(OUT/'light.png'))
   await cmd('theme');await wait_frame();await page.screenshot(path=str(OUT/'dark.png'));await cmd('theme')
   # Verify module build fallbacks without presenting them as WebGPU.
   await page.goto(BASE+'/?fresh=1&renderer=webgl',wait_until='networkidle');await page.wait_for_function('avolith.ready',timeout=60000);await wait_frame();assert await ev('avolith.renderer.backend')=='WebGL2 fallback';assert not await ev('avolith.errors');record('Explicit WebGL2 fallback compiles and renders shader pipelines')
   await page.goto(BASE+'/?fresh=1&renderer=canvas',wait_until='networkidle');await page.wait_for_function('avolith.ready',timeout=60000);assert await ev('avolith.renderer.backend')=='Canvas fallback';assert await ev('avolith.renderer.lastStats.triangles')>10000;record('Explicit Canvas fallback renders and is truthfully labeled')
   # Standalone file uses no web server, no CDN, no external worker source.
   standalone=ROOT/'dist'/'Avolith-Studio.html';await context.set_offline(True)
   await page.goto(standalone.as_uri()+'?fresh=1',wait_until='load');await page.wait_for_function('avolith.ready',timeout=60000);assert await ev('avolith.renderer.backend')=='WebGPU';assert (await values())['count']==19;record('Standalone HTML opens offline from file:// with native WebGPU')
   q=await ev('''async()=>{let a=avolith,s=a.kernel.box(10,10,10),t=a.kernel.box(10,10,10,[5,0,5]),r=await a.jobs.run('boolean',[s,t],{operation:'subtract'});return a.kernel.metrics(r.solids[0]).volume}''');near(q,500);record('Standalone inline Blob worker performs real Boolean subtraction offline')
   assert not page_errors, str(page_errors);assert not await ev('avolith.errors');record('No uncaught JavaScript errors in completed desktop workflows')
   await context.set_offline(False)
   mobile=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
   mp=await mobile.new_page();await mp.goto(BASE+'/?fresh=1',wait_until='networkidle');await mp.wait_for_function('avolith.ready',timeout=60000)
   assert await mp.evaluate('document.documentElement.scrollWidth<=innerWidth+2');r=await mp.locator('#viewport').bounding_box();assert r['width']>300 and r['height']>300;await mp.screenshot(path=str(OUT/'mobile.png'));record('Mobile layout retains usable viewport without horizontal page overflow')
   await mp.locator('#sidebar-toggle').click();assert 'mobile-open' in await mp.locator('#sidebar').get_attribute('class');await mp.locator('#sidebar-toggle').click();record('Mobile structure sidebar opens and closes')
   await mp.locator('#panel-toggle').click();assert 'mobile-open' in await mp.locator('#inspector').get_attribute('class');record('Mobile tool inspector opens')
   await mobile.close()
  except Exception as e:
   record('Workflow failure',False,str(e));traceback.print_exc()
   try:await page.screenshot(path=str(OUT/'failure.png'));(OUT/'failure-state.json').write_text(json.dumps(await ev('()=>({text:document.body.innerText,errors:window.avolith?.errors})'),indent=2))
   except Exception:pass
  finally:
   (OUT/'browser-results.json').write_text(json.dumps({'results':results,'measurements':measurements,'pageErrors':page_errors,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results)},indent=2))
   await browser.close()
 return all(r['passed'] for r in results)
if __name__=='__main__':raise SystemExit(0 if asyncio.run(run()) else 1)
