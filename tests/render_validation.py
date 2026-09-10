"""Capture real render backends and validate fallback initialization and pixel output.
Requires the same displayed Chromium environment as browser_test.py.
"""
import asyncio,json,os
from pathlib import Path
from PIL import Image,ImageStat
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results'
BASE=os.getenv('AVOLITH_URL','http://127.0.0.1:8765')
async def main():
 results=[]
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.getenv('AVOLITH_CHROMIUM','/usr/bin/chromium'),headless=os.getenv('AVOLITH_HEADLESS')=='1',args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader'])
  page=await b.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
  for name,query,backend in [('light','webgpu','WebGPU'),('webgl','webgl','WebGL2 fallback'),('canvas','canvas','Canvas fallback')]:
   await page.goto(BASE+'/?fresh=1&renderer='+query,wait_until='networkidle');await page.wait_for_function('window.avolith?.ready',timeout=60000)
   await page.wait_for_timeout(5700);await page.mouse.move(100,15)
   await page.evaluate('async()=>{avolith.renderer.render();if(avolith.renderer.device)await avolith.renderer.device.queue.onSubmittedWorkDone()}');await page.wait_for_timeout(400)
   actual=await page.evaluate('avolith.renderer.backend');assert actual==backend,(actual,backend)
   if query=='webgl':assert await page.evaluate('avolith.renderer.gl.getError()')==0
   assert not await page.evaluate('avolith.errors')
   await page.screenshot(path=str(OUT/f'{name}.png'))
   box=await page.locator('#viewport').bounding_box();im=Image.open(OUT/f'{name}.png').convert('RGB').crop((box['x'],box['y'],box['x']+box['width'],box['y']+box['height']));std=ImageStat.Stat(im).stddev
   assert max(std)>12 and len(im.getcolors(im.width*im.height))>100
   results.append({'backend':backend,'passed':True,'pixelStandardDeviation':std,'screenshot':f'{name}.png'})
   print('PASS',backend,'pixel render',flush=True)
   if query=='webgpu':
    await page.evaluate('avolith.execute("theme")');await page.wait_for_timeout(400);await page.evaluate('async()=>{avolith.renderer.render();await avolith.renderer.device.queue.onSubmittedWorkDone()}');await page.wait_for_timeout(400)
    await page.screenshot(path=str(OUT/'dark.png'));await page.evaluate('avolith.execute("theme")')
  # Simulate a real initialization failure after obtaining a WebGL context.
  await page.add_init_script("""(()=>{let old=WebGL2RenderingContext.prototype.getShaderParameter;WebGL2RenderingContext.prototype.getShaderParameter=function(shader,name){return name===this.COMPILE_STATUS?false:old.call(this,shader,name)}})()""")
  await page.goto(BASE+'/?fresh=1&renderer=webgl',wait_until='networkidle');await page.wait_for_function('window.avolith?.ready');await page.evaluate('avolith.renderer.render()')
  assert await page.evaluate('avolith.renderer.backend')=='Canvas fallback';assert await page.evaluate('avolith.renderer.gl===null');assert not await page.evaluate('avolith.errors')
  results.append({'backend':'Simulated failed WebGL initialization','passed':True,'detail':'Canvas recovers with no stale WebGL context used for rendering.'});print('PASS partial initialization cleanup',flush=True)
  await b.close()
 (OUT/'render-results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())
