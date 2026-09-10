# Third-party notices and library replacement

Avolith application modules are MIT-licensed. The following unmodified, separately loaded dependencies are installed by `npm run vendor`; they are not relicensed as MIT by this project.

| Package | Pinned version | Package license | Source / build repository |
|---|---|---|---|
| replicad | 1.1.0 | MIT | https://github.com/sgenoud/replicad |
| replicad-opencascadejs | 1.1.0 | LGPL-2.1-only, as declared by the package | https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs |
| opencascade.js | 1.1.1 | LGPL-2.1-only, as declared by the package | https://github.com/donalffons/opencascade.js |

The installer copies the package LICENSE texts to `vendor/licenses/` and records package versions and verified archive checksums in `vendor/manifest.json`. The original npm archives contain their distributed source/glue, metadata and notices. The OpenCascade-derived WebAssembly libraries retain their upstream notices and applicable exceptions. Source and build-system instructions for the upstream kernel are at https://github.com/Open-Cascade-SAS/OCCT and https://github.com/donalffons/opencascade.js . Replicad's custom binding configuration and build instructions are in its repository above. Consult the exact dependency notices for their terms; this file is an inventory, not a substitute license.

## Rebuild or replace the libraries

`src/engineering/exact-engine.js` imports `vendor/exact/replicad_single.js` and `replicad.js`; the former loads `replicad_single.wasm`. `src/engineering/iges-engine.js` loads `vendor/iges/opencascade.wasm.js` and its neighboring WASM file. These files are separate from Avolith application code, unencrypted and replaceable. Rebuild the upstream libraries using their published build configurations, replace the corresponding JS/WASM files and run the native regression tests. API-compatible replacements require no changes to the renderer or document format. An incompatible binding version requires updating the adapter and tests.

`npm run vendor` validates the original distribution archives before copying them. For a locally modified/rebuilt library, replace the generated `vendor/` files **after** running that command; `npm run build:site` copies the replacements without checking or overwriting them. There is no runtime signature check that prevents using modified libraries. Do not run the vendor installer afterward unless deliberately restoring the pinned distributions.

## Archive integrity

```
51128e58f49ffa950bee8b8804cc0104d968c9712b0b3e9e04957e8eda75950a  replicad-1.1.0.tgz
be73ff9e1bd95f021d01d50dcfe85094e6c6d1ad876283694bbca2ef00f446d9  replicad-opencascadejs-1.1.0.tgz
2731aeb6c07c120f21733640155225f5802f1475cdd135d94f2cb41db3cfb587  opencascade.js-1.1.1.tgz
```

No native proprietary format SDKs, commercial font assets or proprietary CAD source are included.
