import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, '_site');
const required = [
  'vendor/exact/replicad_single.wasm', 'vendor/exact/replicad_single.js',
  'vendor/exact/replicad.js', 'vendor/iges/opencascade.wasm.wasm',
  'vendor/iges/opencascade.wasm.js', 'vendor/rhino3dm/rhino3dm.wasm',
  'vendor/rhino3dm/rhino3dm.mjs', 'vendor/manifest.json'
];
for (const entry of required) {
  const stat = await fs.stat(path.join(root, entry)).catch(() => null);
  if (!stat?.isFile() || !stat.size) throw Error(`Missing release dependency: ${entry}. Run npm run vendor.`);
}
await fs.rm(site, {recursive: true, force: true});
await fs.mkdir(site, {recursive: true});
for (const entry of ['index.html', 'style.css', 'engineering.css', 'src', 'vendor', 'examples', 'docs', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
  await fs.cp(path.join(root, entry), path.join(site, entry), {recursive: true});
}
// This separate download is the intentionally self-contained FACETED edition.
for (const name of ['Avolith-Studio-Offline.html', 'Avolith-Studio.html']) {
  await fs.copyFile(path.join(root, 'dist/Avolith-Studio.html'), path.join(site, name));
}
let commit = process.env.GITHUB_SHA || '';
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { commit = 'local'; }
}
const {version} = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(path.join(site, 'release.json'), JSON.stringify({
  name: 'Avolith Studio', version, commit, builtAt: new Date().toISOString(),
  kernels: ['B-rep/NURBS', 'IGES', '3dm'], standaloneEdition: 'faceted'
}, null, 2) + '\n');
await fs.writeFile(path.join(site, '.nojekyll'), '');
console.log(`Built _site for ${commit}, including all three self-hosted CAD workers.`);
