"""Validate native exchange using the real import/export controls and WASM workers."""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path(__file__).resolve().parents[1]/'test-results';OUT.mkdir(exist_ok=True);results=[]
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.getenv('AVOLITH_CHROMIUM',p.chromium.executable_path),headless=os.getenv('AVOLITH_HEADLESS')=='1',args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader']);page=await b.new_page(accept_downloads=True,viewport={'width':1680,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
  def ok(name): results.append({'name':name,'passed':True});print('PASS',name,flush=True)
  async def action(n): await page.evaluate('(n)=>avolith.engineering.actions[n]()',n)
  async def submit():
   assert not await page.locator('#modal-form :invalid').count();await page.locator('#modal-submit').click();await page.wait_for_function('!document.querySelector("#modal-submit").disabled',timeout=180000)
   assert not await page.locator('#modal-error').is_visible(),await page.locator('#modal-error').inner_text()
  try:
   await page.goto(os.getenv('AVOLITH_URL','http://127.0.0.1:8765')+'/?fresh=1&renderer=webgpu',wait_until='networkidle');await page.wait_for_function('avolith?.engineering?.native3dm');ok('Native exchange extension and worker controls are installed')
   await action('exact-surface');await submit();await action('native3dm-export');await page.locator('#f-ack').check()
   async with page.expect_download(timeout=180000) as ev: await submit()
   out=await ev.value;await out.save_as(str(OUT/'surface.3dm'));assert (OUT/'surface.3dm').stat().st_size>100;assert await page.evaluate('avolith.engineering.native3dm.report[0].representation')=='NURBS surface';ok('Analytic NURBS export runs through native WASM and a browser download')
   count=await page.evaluate('avolith.document.bodies.length');await page.locator('#file-input').set_input_files(str(OUT/'surface.3dm'));await page.wait_for_function('(n)=>avolith.document.bodies.length===n+1',arg=count,timeout=180000)
   assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.properties.valid');ok('Main file input imports the native file as an editable valid B-rep')
   await page.evaluate("async()=>{const{M}=await import('./src/core/math.js');const b=avolith.ui.selectedBodies()[0];avolith.document.transact('Place imported patch',()=>b.solid=b.solid.transform(M.translate([10,20,30])));}")
   await action('exact-mesh');await submit();await action('native3dm-export');await page.locator('#f-ack').check()
   async with page.expect_download(timeout=180000) as ev:await submit()
   out=await ev.value;await out.save_as(str(OUT/'placed-surface.3dm'));assert await page.evaluate('avolith.engineering.native3dm.report[0].representation')=='retained native geometry';ok('Placement and retessellation retain source geometry for lossless native re-export')
   await action('exact-primitive');await submit();await action('native3dm-export');await page.locator('#f-ack').check()
   async with page.expect_download(timeout=180000) as ev:await submit()
   out=await ev.value;await out.save_as(str(OUT/'explicit-mesh.3dm'));assert 'not analytic' in await page.evaluate('avolith.engineering.native3dm.report[0].representation');ok('Non-native body export reports its explicit faceted representation')
   await action('native3dm-report');assert 'display mesh' in await page.locator('#modal-body').inner_text();await page.locator('#modal-close').click();ok('Exchange report exposes actual representation to the user')
   assert not errors,errors;ok('No browser or GPU errors during native exchange')
  except Exception as e:
   results.append({'name':'FAILURE','passed':False,'error':str(e),'trace':traceback.format_exc()});await page.screenshot(path=str(OUT/'interop-failure.png'));raise
  finally:
   (OUT/'interop-browser-results.json').write_text(json.dumps({'tests':results,'errors':errors},indent=2));await b.close()
asyncio.run(main())
