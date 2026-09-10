import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, '_site');
const text = name => fs.readFile(path.join(site, name), 'utf8');

test('Site retains the engineering stylesheet and all module entry points', async () => {
  const html = await text('index.html');
  for (const name of ['style.css', 'engineering.css', 'src/app.js', 'src/engineering/ui.js', 'src/engineering/workbench.js', 'src/engineering/interop-ui.js']) {
    assert.ok(html.includes(`"${name}"`), `Missing entry point ${name}`);
    assert.ok((await fs.stat(path.join(site, name))).size > 0);
  }
});
test('Every CAD worker and its native WASM dependency are packaged', async () => {
  for (const name of ['exact', 'iges', 'native-3dm', 'analysis']) {
    await fs.access(path.join(site, `src/engineering/${name}-worker.js`));
  }
  for (const name of ['vendor/exact/replicad_single.wasm', 'vendor/iges/opencascade.wasm.wasm', 'vendor/rhino3dm/rhino3dm.wasm']) {
    const file = await fs.open(path.join(site, name));
    try {
      const bytes = Buffer.alloc(8);
      assert.equal((await file.read(bytes, 0, 8, 0)).bytesRead, 8);
      assert.deepEqual([...bytes], [0, 97, 115, 109, 1, 0, 0, 0], `Invalid WASM header: ${name}`);
    } finally { await file.close(); }
  }
});
test('Dependency manifest includes four pinned packages and their notices', async () => {
  const manifest = JSON.parse(await text('vendor/manifest.json'));
  for (const prefix of ['replicad@', 'replicad-opencascadejs@', 'opencascade.js@', 'rhino3dm@']) {
    const item = manifest.packages.find(p => p.spec.startsWith(prefix));
    assert.ok(item, prefix);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
  }
  for (const name of ['replicad-MIT.txt', 'replicad-opencascadejs-LGPL.txt', 'opencascade.js-LGPL.txt', 'rhino3dm-MIT.txt']) {
    assert.ok((await text(`vendor/licenses/${name}`)).length > 500);
  }
});
test('Published build metadata identifies the source commit and edition boundaries', async () => {
  const release = JSON.parse(await text('release.json'));
  assert.equal(release.name, 'Avolith Studio');
  assert.equal(release.standaloneEdition, 'faceted');
  assert.deepEqual(release.kernels, ['B-rep/NURBS', 'IGES', '3dm']);
  assert.ok(release.commit && release.version);
  if (process.env.EXPECTED_SHA || process.env.GITHUB_SHA) {
    assert.equal(release.commit, process.env.EXPECTED_SHA || process.env.GITHUB_SHA);
  }
});
test('Standalone faceted edition has no external script or stylesheet dependencies', async () => {
  const html = await text('Avolith-Studio-Offline.html');
  assert.match(html, /OFFLINE FACETED EDITION/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.match(html, /globalThis\.AVOLITH_WORKER_SOURCE=/);
});
test('Legacy standalone link remains byte-identical to the explicit faceted edition', async () => {
  assert.equal(await text('Avolith-Studio.html'), await text('Avolith-Studio-Offline.html'));
});
test('Site preserves Pages dotfile and excludes development/recovery artifacts', async () => {
  await fs.access(path.join(site, '.nojekyll'));
  for (const name of ['.git', '.github', '.bootstrap', '.cache', 'node_modules', 'test-results', 'tests']) {
    await assert.rejects(fs.access(path.join(site, name)), {code: 'ENOENT'});
  }
});
