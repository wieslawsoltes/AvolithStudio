"""Exercise the packaged or deployed app, never the source-tree fallback.

AVOLITH_URL must point to a served site root (including any Pages subpath).
EXPECTED_SHA pins the deployed build. No user files/accounts are touched.
"""
import asyncio
import json
import os
import time
import traceback
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.getenv('AVOLITH_URL', 'http://127.0.0.1:8765/_site/').rstrip('/') + '/'
OUT = Path(os.getenv('AVOLITH_RESULTS', 'test-results/release'))
OUT.mkdir(parents=True, exist_ok=True)
EXPECTED = os.getenv('EXPECTED_SHA', '')
results = []

def record(name):
    results.append({'name': name, 'passed': True})
    print('PASS', name, flush=True)

async def main():
    errors = []
    metadata = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('AVOLITH_CHROMIUM', p.chromium.executable_path),
            headless=os.getenv('AVOLITH_HEADLESS') == '1',
            args=['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
                  '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        async def action(name):
            await page.evaluate('(name) => avolith.engineering.actions[name]()', name)
        async def submit():
            assert not await page.locator('#modal-form :invalid').count(), 'Invalid form fields'
            await page.locator('#modal-submit').click()
            await page.wait_for_function('!document.querySelector("#modal-submit").disabled', timeout=180000)
            assert not await page.locator('#modal-error').is_visible(), await page.locator('#modal-error').inner_text()
        try:
            for attempt in range(30):
                response = await page.request.get(BASE + 'release.json?verify=' + str(time.time_ns()))
                if response.ok:
                    try:
                        metadata = await response.json()
                    except (ValueError, json.JSONDecodeError):
                        metadata = {}
                    if metadata.get('commit') and (not EXPECTED or metadata['commit'] == EXPECTED):
                        break
                await asyncio.sleep(2)
            else:
                raise AssertionError(f'Expected deployed commit {EXPECTED!r}, received {metadata!r}')
            record('Release metadata matches the expected source commit')
            for asset in ['engineering.css', 'src/engineering/interop-ui.js', 'vendor/manifest.json']:
                response = await page.request.get(BASE + asset)
                assert response.ok and len(await response.body()) > 20, f'Missing release asset: {asset}'
            record('Engineering styles, native exchange entry point and dependency manifest are served')
            await page.goto(BASE + '?fresh=1&renderer=webgpu', wait_until='networkidle')
            await page.wait_for_function('window.avolith?.engineering?.native3dm', timeout=60000)
            assert await page.evaluate('avolith.renderer.backend') == 'WebGPU'
            for tab in ['Precision', 'Engineering', 'Advanced', 'Manufacture', 'Exchange']:
                assert tab in await page.locator('#ribbon-tabs').inner_text(), f'Missing ribbon {tab}'
            record('All engineering ribbons start with native WebGPU from the packaged site')
            await action('exact-primitive')
            await submit()
            props = await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.properties')
            assert props['valid'] and abs(props['volume'] - 30000) < 0.01, props
            record('Self-hosted exact worker builds a valid analytic 40 × 30 × 25 mm solid')
            for fmt in ['step', 'iges']:
                await action('exact-export')
                await page.locator('#f-format').select_option(fmt)
                async with page.expect_download(timeout=180000) as event:
                    await submit()
                download = await event.value
                target = OUT / ('release-solid.' + fmt)
                await download.save_as(str(target))
                assert target.stat().st_size > 100
                if fmt == 'step':
                    assert 'ISO-10303-21' in target.read_text()
            record('Modern STEP and separate IGES worker produce actual CAD downloads')
            await action('exact-surface')
            await submit()
            await action('native3dm-export')
            await page.locator('#f-ack').check()
            async with page.expect_download(timeout=180000) as event:
                await submit()
            download = await event.value
            target = OUT / 'release-surface.3dm'
            await download.save_as(str(target))
            assert target.stat().st_size > 100
            assert await page.evaluate('avolith.engineering.native3dm.report[0].representation') == 'NURBS surface'
            count = await page.evaluate('avolith.document.bodies.length')
            await page.locator('#file-input').set_input_files(str(target))
            await page.wait_for_function('(count) => avolith.document.bodies.length === count + 1', arg=count, timeout=180000)
            assert await page.evaluate('avolith.ui.selectedBodies()[0].solid.meta.exact.properties.valid')
            record('Self-hosted .3dm worker round-trips an editable rational surface')
            await page.screenshot(path=str(OUT / 'deployed-workspace.png'))
            assert not errors, errors
            record('No browser exceptions or WebGPU validation errors')
        except Exception as error:
            results.append({'name': 'FAILURE', 'passed': False, 'error': str(error), 'trace': traceback.format_exc()})
            await page.screenshot(path=str(OUT / 'release-failure.png'))
            raise
        finally:
            (OUT / 'release-results.json').write_text(json.dumps({
                'url': BASE, 'expectedCommit': EXPECTED, 'release': metadata,
                'tests': results, 'errors': errors,
                'passed': sum(t['passed'] for t in results),
                'failed': sum(not t['passed'] for t in results)
            }, indent=2))
            await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
