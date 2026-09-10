# Validation — Avolith Studio 0.2

## Local executable tests

| Suite | Recorded result |
|---|---|
| Original core geometry / document / renderer-support tests | 92 passed, 0 failed |
| New engineering unit tests | 34 passed, 0 failed |
| Actual native CAD / translator tests | 25 passed, 0 failed |

`npm test` runs the first two suites. `npm run test:exact` requires the pinned `vendor/` installation and runs actual WebAssembly kernels, not mocked geometry APIs.

Native tests cover analytic primitive volumes, topology-to-mesh mappings, cylinder radius metadata, fillets/chamfers, shelling, positive/negative planar face-prism Pull, draft/split/Booleans, native clearance/interference, NURBS area and zero open-surface volume, thickening/offset, analytic profiles, STEP and IGES cylinder roundtrips, hidden-line projection, multibend folded/flat volume at K=0.5, explicit planar reconstruction, persisted B-rep/normals, instance scaling/reflection, retessellation and failure recovery.

Engineering tests cover ten mate types and expected instantaneous DOF, grounding/conflict/stale-reference behavior, transactional datum creation, bend allowance and punch validation, transform-aware/stale PMI, semantic dimension values and FCF validation, SVG text escaping, sampled wall rays, body-separated surface welding, VTK/S3 exports, CSV formula escaping and document engineering-reference cleanup.

## Browser validation

`tests/precision_browser.py` exercises the shipped module/worker layout over HTTP, real WebGPU rendering, exact editing UI, persistence, exports, mates, NURBS/sheet workflows, engineering drawings and cancellation. It emits JSON results, actual downloaded exports and light/dark/mobile/drawing screenshots to `test-results/`. The CI workflow retains these as artifacts. `tests/browser_test.py` preserves the original 46 workflow assertions; `tests/render_validation.py` preserves the four backend/recovery checks.

Browser results must be read from the current successful CI run and its artifacts; older report numbers are not a substitute for rerunning modified code. A software GPU adapter is used in automation. No physical-GPU throughput benchmark or production certification is claimed.

## Deliberate nonclaims

Passing these tests does not establish unlimited kernel robustness, compatibility with every STEP/IGES entity or commercial CAD file, semantic GD&T standard conformance, manufacturing suitability, validated FEA/CFD or a safety/quality certification. Unsupported and unverified areas remain in `docs/CAPABILITIES.md`.
