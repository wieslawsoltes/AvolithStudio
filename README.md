# Avolith Studio

**Local-first 3D modeling in plain HTML and JavaScript, with native WebGPU rendering and an analytic CAD engine.**

[Launch Avolith Studio](https://wieslawsoltes.github.io/AvolithStudio/) · [Current release scope](docs/RELEASE_NOTES.md) · [Capability matrix](docs/CAPABILITIES.md) · [Architecture](docs/ENGINEERING.md) · [Validation](docs/TEST_REPORT.md)

The modular application combines the original faceted workspace with **Precision**, **Advanced**, **Engineering**, **Manufacture** and **Exchange** ribbons. Exact bodies retain native B-rep geometry; their display triangles are tessellations, not the modeling source. Computation and file conversion remain in the browser, with self-hosted, pinned WebAssembly dependencies and no backend CAD service.

## Start

Open **Precision → Exact sample** to create a filleted/bored mounting block, analytic shaft, punched multibend sheet, thickened NURBS panel and PMI. CAD libraries load on demand. IGES and native `.3dm` exchange use separate workers.

For local development, use Node 22+ and Python 3:

```sh
npm run vendor
npm start
```

Open `http://localhost:8765`. The installer verifies the hard-coded SHA-256 checksums of four pinned dependency archives and installs their replaceable JS/WASM files and notices under `vendor/`. Set `AVOLITH_DEP_CACHE` to a folder containing the archives listed in `scripts/install-vendor.mjs` for installation without network access. After installation, serve the complete folder over HTTP(S).

```sh
npm test                        # Core, engineering and motion tests
npm run test:exact              # Native geometry and STEP/IGES round-trips
npm run test:3dm                # Native .3dm interoperability
npm run build                  # Self-contained offline FACETED edition
npm run build:site             # Complete modular app in _site/; requires vendor/
node --test tests/site.test.mjs # Packaging, all kernels, notices and standalone isolation
```

The hosted app is the **complete modular edition**. `Avolith-Studio-Offline.html` is the separate, dependency-free faceted edition; it does not contain the analytic CAD kernels. Generated HTML is available in CI artifacts and on Pages, not checked in as stale output.

## Working capabilities

**Precision and Advanced:** analytic primitives; weighted, periodic and UV-trimmed NURBS; surface fitting/analysis; extrusion, revolution, loft and sweep; exact Booleans, splitting, sewing, holes, fillets, variable-radius fillets, asymmetric chamfers, shelling, draft, thickening, offsets, healing, planar face-prism Pull, topology and mass properties.

**Engineering and Manufacture:** developable multibend strips and edge-flanged polygon panels, reliefs, fold/unfold, developed geometry and bend schedules; grounded body mates, joint drives/limits and worker-computed motion studies; hidden-line and section drawings; dimensions, datums, feature-control-frame records; clearance/interference and preparation reports; BOM, VTK surfaces and S3 shell skins.

**Exchange:** STEP, IGES and BREP geometry; bounded native `.3dm` conversion with retained geometry, NURBS and trimmed B-reps. `.3dm` export distinguishes analytic retained geometry from explicit display meshes. For general edited exact solids, use STEP. The original mesh and document formats remain available.

**Original workspace:** direct faceted modeling, sketch constraints, components, layers, materials, undo/redo, autosave, touch navigation and WebGL2/Canvas fallbacks. Cancellation and stale-result guards protect document edits.

## Validation and publishing

CI runs every native and browser suite, including advanced manufacturing and native exchange. A separate packaged-site smoke test uses a subdirectory URL and actual CAD downloads. Pages publishes the artifact from a successful `main` CI run and then verifies the public build's commit, WebGPU startup and all three native CAD workers. Source snapshots, TAP logs, browser results, screenshots and export samples are retained as Actions artifacts.

## Important boundaries

This is **not a full commercial-CAD replacement or a certified manufacturing/simulation system**. `.3dm` support is explicitly bounded; other proprietary native formats are not supported. STEP/IGES import does not reconstruct all assembly hierarchy or semantic PMI. Fillets/shells remain subject to kernel geometry limits. Arbitrary sheet forming, comprehensive drafting/GD&T/PMI conformance, volume meshes, solved simulation and certification remain unmet targets. See [release scope and limits](docs/RELEASE_NOTES.md) instead of equating ribbon coverage with parity.

## License

Avolith application code is MIT. Separately loaded libraries retain their licenses and notices. [Third-party notices](THIRD_PARTY_NOTICES.md) identify upstream sources and the replaceable-library layout. No proprietary SDK or closed-source CAD kernel is bundled.
