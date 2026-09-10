# Avolith Studio

**Local-first 3D modeling in plain HTML and JavaScript, with native WebGPU rendering and an analytic CAD engine.**

[Launch Avolith Studio](https://wieslawsoltes.github.io/AvolithStudio/) · [Capability matrix](docs/CAPABILITIES.md) · [Engineering architecture](docs/ENGINEERING.md) · [Validation](docs/TEST_REPORT.md)

Avolith combines a preserved faceted-modeling workspace with a separate **Precision** ribbon for exact B-rep/NURBS work and an **Engineering** ribbon for sheet metal, assemblies, drawings, PMI and geometry preparation. Exact geometry is modeled in an OpenCascade WebAssembly worker; tessellated triangles are display data, not its modeling source. No account, geometry upload, telemetry or backend modeling service is required.

## Start

The published site contains self-hosted, checksum-verified CAD libraries. Open **Precision → Exact sample** for a filleted and bored mounting block, an analytic shaft, a punched multibend sheet, a thickened NURBS panel and example PMI. The first exact operation loads the CAD kernel on demand. IGES loads a separate compatibility worker only when used.

For local development, use Node 22+ and Python 3:

```sh
npm run vendor
python3 -m http.server 8765
```

Open `http://localhost:8765`. `npm run vendor` downloads **pinned** npm archives, verifies hard-coded SHA-256 checksums and copies their JS/WASM and license files under `vendor/`. Subsequent application use is local. To install without network access, set `AVOLITH_DEP_CACHE` to a folder containing the three archives listed in `scripts/install-vendor.mjs`. Keep the complete `vendor/` directory beside the app when distributing an offline folder.

```sh
npm test             # Original core + engineering tests; no WASM dependency required
npm run test:exact   # Actual native CAD operations and neutral-file roundtrips
npm run build        # Self-contained, offline FACETED edition
npm run build:site   # Enhanced modular application in _site/; requires vendor/
```

**The standalone HTML is explicitly the faceted edition.** The enhanced application uses module workers and separately replaceable CAD libraries; serve its folder over HTTP(S). It is not a dependency-free single HTML file.

## Workspaces

**Precision:** analytic boxes, cylinders, cones, spheres, toruses and tubes; retained-primitive promotion; rational NURBS control-net editing; analytic-profile extrusion, revolution, loft and circular sweep; exact Boolean operations, splitting, cylindrical holes, constant-radius fillets, equal chamfers, shelling, draft, offsets, thickening and planar face-prism Pull; native mass properties and topology inspection; STEP, IGES and BREP geometry exchange. Selected faces and edges map back to current B-rep topology indices.

**Engineering:** developable multibend strips with round flange punches, retained unfold/refold definitions, flat DXF/SVG and bend CSV; body-local datums, grounded bodies, ten rigid-body mate types and a nonlinear solver reporting residual/rank/DOF; dimensions, notes, datum symbols and semantic feature-control-frame records; three-view exact hidden-line drawings; topology/small-feature and sampled-wall diagnostics, native clearance/interference, external-domain subtraction, exact-aware BOM, VTK surface meshes and explicitly labeled S3 shell skins.

**Original workspace:** direct faceted modeling, sketches and their constraint solver, assemblies/components, layers, materials, local file exchange, undo/redo, autosave, touch navigation and WebGL2/Canvas fallbacks remain available. New exact operations are atomic: errors or cancellation leave the document unchanged. Changes made while a worker request runs invalidate that request's result rather than overwriting newer edits.

## Important boundaries

This is an independently developed, usable CAD application, **not a full commercial-CAD replacement and not a certified manufacturing or simulation system**. Native proprietary CAD translators are not installed. STEP/IGES import does not restore source assembly hierarchy or semantic PMI. Sheet metal is a developable constant-width strip workflow, not arbitrary formed sheet metal. NURBS editing does not include arbitrary trim-loop networks. PMI records express design requirements; they do not prove conformance to a standard. Simulation exports are surfaces or shell skins, **not volumetric finite-element meshes or solved analyses**. See the matrix for specific limits rather than treating ribbon coverage as feature parity.

## License

Avolith application code is MIT. Separately loaded third-party CAD libraries retain their own licenses. The dependency installer includes their notices; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) identifies source repositories, build instructions and the replaceable-library layout. No proprietary SDK, kernel or translator is bundled.
