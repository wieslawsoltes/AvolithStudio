"""Exercise Advanced and Manufacture UI through a real browser and real workers."""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
BASE=os.getenv('AVOLITH_URL','http://127.0.0.1:8765');results=[]
def record(name):
 results.append({'name':name,'passed':True});print('PASS',name,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('AVOLITH_CHROMIUM',p.chromium.executable_path),headless=os.getenv('AVOLITH_HEADLESS')=='1',args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader'])
  page=await browser.new_page(viewport={'width':1680,'height':1050},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  async def action(n): await page.evaluate('(n)=>avolith.engineering.actions[n]()',n)
  async def submit():
   assert not await page.locator('#modal-form :invalid').count()
   await page.locator('#modal-submit').click();await page.wait_for_function('!document.querySelector("#modal-submit").disabled',timeout=180000)
   if await page.locator('#modal-error').is_visible(): raise AssertionError(await page.locator('#modal-error').inner_text())
  async def close():
   if await page.locator('#modal').is_visible(): await page.locator('#modal-close').click()
  try:
   await page.goto(BASE+'/?fresh=1&renderer=webgpu',wait_until='networkidle');await page.wait_for_function('avolith?.engineering?.advanced',timeout=60000)
   assert 'Manufacture' in await page.locator('#ribbon-tabs').inner_text();assert await page.evaluate('avolith.renderer.backend')=='WebGPU';record('Advanced and Manufacture ribbons load without losing native WebGPU')
   await page.evaluate("async()=>{const{ModelDocument}=await import('./src/core/document.js');avolith.ui.replaceDocument(new ModelDocument());}")
   await action('panel-create');await submit();assert await page.evaluate('avolith.document.bodies.at(-1).solid.meta.exact.sheetPanelLayout.bends.length')==4;record('Panel form creates four real connected edge flanges and a base hole')
   await action('panel-toggle');assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.flat');await page.evaluate("avolith.execute('undo')");assert not await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.flat');await page.evaluate("avolith.execute('redo')");assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.flat');record('Panel fold state participates in actual undo and redo')
   await action('panel-toggle');assert not await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.flat')
   for fmt in ['csv','svg','dxf','step']:
    await action('panel-export');await page.locator('#f-format').select_option(fmt)
    async with page.expect_download(timeout=180000) as ev: await submit()
    d=await ev.value;await d.save_as(str(OUT/('panel-flat.'+fmt)));assert (OUT/('panel-flat.'+fmt)).stat().st_size>100
   record('Panel CSV, actual section SVG/DXF and analytic flat STEP export through browser')
   await page.evaluate('avolith.renderer.fit()');await page.screenshot(path=str(OUT/'advanced-panel.png'))
   await action('advanced-section');await page.locator('#f-origin').fill('0,0,1');await submit();assert await page.locator('#drawings svg').count()==1;assert await page.evaluate('avolith.engineering.advanced.lastSection.loops.length')>=2;record('True section drawing contains perimeter and hole curves')
   await page.evaluate("avolith.execute('model')")
   await action('advanced-fit');await submit();assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.faces[0].type')=='BSPLINE_SURFACE';record('Ordered-grid form creates an actual native BSpline surface')
   await action('advanced-surface');await submit();await page.wait_for_timeout(200);assert 'gaussianCurvature' in await page.locator('#modal-body').inner_text();await close();record('Surface analysis dialog reports real native differential geometry')
   await action('advanced-trim');await submit();assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.edges.length')==8;record('UV trim dialog constructs native outer and inner face wires')
   await action('exact-primitive');await submit()
   await action('advanced-fillet');await page.locator('#f-edges').fill('0');await submit();assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.faces.length')>6;record('Variable-radius law submits through the real edge-selection form')
   await action('advanced-heal');await submit();record('Topology healing completes in the real worker')
   await page.evaluate("""async()=>{const{ModelDocument}=await import('./src/core/document.js');const{box}=await import('./src/core/kernel.js');const{assemblyReference}=await import('./src/engineering/assembly.js');const d=new ModelDocument();d.bodies=[];const a=d.add(box(10,10,10),'Ground'),b=d.add(box(20,5,5),'Arm');d.engineering.grounded=[a.id];d.engineering.mates=[{id:'drive',type:'revolute',a:assemblyReference(a,[0,0,0],[0,0,1],[1,0,0]),b:assemblyReference(b,[0,0,0],[0,0,1],[1,0,0])}];avolith.ui.replaceDocument(d);}""")
   await action('joint-drive');await page.locator('#f-type').select_option('drivenRevolute');await page.locator('#f-value').fill('30');await submit();assert await page.evaluate('avolith.document.engineering.mates[0].type')=='drivenRevolute';record('Joint settings convert and solve a driven revolute atomically')
   await action('joint-motion');await page.locator('#f-from').fill('-45');await page.locator('#f-to').fill('45');await page.locator('#f-frames').fill('7');await submit();assert await page.evaluate('avolith.engineering.advanced.lastMotion.frames.length')==7;record('Worker returns seven genuinely solved motion frames')
   await action('joint-results')
   async with page.expect_download() as ev: await submit()
   d=await ev.value;await d.save_as(str(OUT/'motion.json'));assert len(json.loads((OUT/'motion.json').read_text())['frames'])==7
   await action('joint-results');await page.locator('#f-output').select_option('apply');await page.locator('#f-frame').fill('6');await submit();assert await page.evaluate('avolith.document.engineering.mates[0].value')==45;record('Solved motion exports and applies a selected frame with one undo entry')
   await action('joint-results');await page.locator('#f-output').select_option('apply');await page.locator('#modal-submit').click();await page.wait_for_function('!document.querySelector("#modal-submit").disabled');assert 'changed' in await page.locator('#modal-error').inner_text();await close();record('Changed assemblies reject stale motion transforms')
   assert not errors,errors;record('No browser exceptions or GPU validation errors')
  except Exception as e:
   results.append({'name':'FAILURE','passed':False,'error':str(e),'trace':traceback.format_exc()});await page.screenshot(path=str(OUT/'advanced-failure.png'));raise
  finally:
   (OUT/'advanced-browser-results.json').write_text(json.dumps({'tests':results,'errors':errors},indent=2));await browser.close()
asyncio.run(main())
