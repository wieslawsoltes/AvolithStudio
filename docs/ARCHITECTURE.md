# Baseline 0.1 architecture and numerical design

> Historical design of the faceted/offline engine. The enhanced 0.2 web application additionally uses native WebAssembly CAD kernels and engineering modules described in [ENGINEERING.md](ENGINEERING.md). Statements below about absent external kernels and absent advanced capabilities apply to the baseline only.

## Goals and dependency boundary

The shipped application uses browser-native ES modules, HTML forms, CSS layout, Web Workers, IndexedDB, pointer events, WebGPU and WebGL2. There is no React, Three.js, external CAD kernel, WASM binary, CDN dependency or remote geometry service. The standalone bundler is a small Node.js script and the core test runner is Node's built-in runner. Playwright/Pillow/Chromium are development-test dependencies only.

The app is separated into a faceted geometry library, a document/state layer, render backends and a DOM controller. It intentionally does not call mesh geometry an exact B-rep.

## Module map

| Module | Responsibility |
|---|---|
| `core/math.js` | Vector and matrix operations; bounds; Newell normals; ray/triangle and ray/box intersection; BVH |
| `core/kernel.js` | Polygon/Solid types, profile triangulation, primitive generation, CSG, direct edits, diagnostics, repair, sheet development |
| `core/sketch.js` | Explicit sketch constraints, damped least-squares solve, construction-plane mapping and snapping |
| `core/document.js` | Bodies, material presets, transactions, history, serialization, validation and IndexedDB storage |
| `core/worker.js` | Worker entrypoint, job dispatch and serializable results |
| `core/jobs.js` | Worker lifetime, cancellation, timeout, error propagation and standalone Blob worker support |
| `core/io.js` | Native-adjacent mesh parsers, binary STL/GLB exporters, OBJ, DXF and CSV |
| `core/examples.js` | Original procedural sample assemblies; no imported product model assets |
| `render/camera.js` | Z-up view navigation, orthographic/perspective projection, screen/world rays |
| `render/shaders.js` | WGSL surface, line, selection, shadow and compute programs; GLSL fallback programs |
| `render/renderer.js` | Backend initialization, immutable-solid buffer cache, render invalidation, picking and compute readback |
| `ui/icons.js` | Original SVG line-icon registry and HTML escaping helper |
| `ui/ribbon.js` | Command metadata and grouped tab layout |
| `ui/drawing.js` | Orthographic feature-edge projections and SVG title block/dimensions |
| `app.js` | Document-to-DOM binding, modeling dialogs, commands, sketch interaction, tool previews, persistence and errors |

## Data flow

```text
Pointer, keyboard or ribbon command
             |
             v
UI validation and selection -> numerical tool / geometry worker
             |                          |
             |                    result or error
             v                          v
          Document transaction, revision check and history
             |
             +--> tree, properties, tool state and drawing projection
             +--> visible bodies -> render invalidation -> GPU buffers/passes
             +--> debounced, serialized IndexedDB autosave
```

A failed transaction restores the prior document snapshot. A canceled, timed-out or stale geometry job cannot intentionally commit over a newer revision. Live move/pull previews feed temporary solids to the renderer; the final edit becomes a document transaction. Escape discards the preview and restores the visible document.

## Geometry model and tolerances

A `Polygon` stores vertices, an oriented normal, a plane offset and a face ID. A `Solid` stores polygons and small optional metadata. Polygon normals use Newell's method so a leading collinear edge does not by itself create a zero normal. Triangulation projects a polygon onto its dominant normal plane and performs ear clipping, removing collinear vertices when necessary. The triangulator rejects contours it cannot resolve; it is not a complete formal self-intersection proof.

Curve primitives generate finite tessellations. Cylinder/cone sides, sphere rings, torus cells and revolved/swept profiles are real polygon surfaces. General imported polygon geometry is expected to be planar; there is no full exact surface validation on input.

Solids are treated as immutable after publication. Operations return a new Solid. `bounds`, triangle arrays, metrics and BVH are cached by object identity. Code that directly mutates an existing polygon's vertices violates the cache contract and can produce stale rendering/analysis. Use library operations and assign the resulting Solid inside a transaction.

CPU coordinates use JavaScript numbers (double precision). The math epsilon is `1e-7`; Boolean default plane tolerance is `1e-6` in model millimeters. Several diagnostics use configurable quantization tolerances. These are engineering prototype choices, not adaptive exact predicates. Very small features and very large coordinate magnitudes can make a fixed absolute tolerance unsuitable.

Transforms rebuild positions and normals. Reflections reverse polygon winding to retain outward orientation. Translation preserves suitable primitive metadata; general transforms intentionally remove metadata rather than imply that an arbitrary transformed solid still supports axis-aligned primitive-only tools.

## Boolean algorithm

Boolean operations relabel operand face groups to avoid cross-operand ID collisions. Concave faces are triangulated before entering the BSP. Planes classify polygon vertices as front, back or coplanar with a tolerance; spanning polygons are split by edge-plane intersections. Union, subtraction and intersection use clipping/inversion combinations.

BSP construction samples candidate planes and balances split cost against tree imbalance. Explicit recursion, work and output budgets reject pathological cases. This avoids an unsupported promise of unlimited complexity, but does not make the floating-point algorithm robust on every degenerate input.

A BSP result can be geometrically closed while its polygon-edge graph contains T-junctions. `repair` can conform such junctions by splitting edges at existing collinear vertices. It also quantizes/welds vertices, removes duplicate faces and drops degenerate faces. Feature-edge display performs a bounded virtual conformance pass for line classification, without silently changing saved geometry. Raw topology diagnostics still reflect the actual polygon incidence.

## Metrics and diagnostics

For an oriented triangle with vertices `a`, `b`, `c`:

```text
area = length(cross(b - a, c - a)) / 2
signed volume contribution = dot(a, cross(b, c)) / 6
first moment contribution = signed volume contribution × (a + b + c) / 4
centroid = sum(first moment) / sum(signed volume)
mass in grams = volume in mm³ × density in g/mm³
```

The scalar exposed as volume is the magnitude of the signed total. The signed total is retained for diagnostics. A correct physical volume requires a closed, consistently oriented, non-self-intersecting boundary. Open or inverted geometry is not repaired simply by taking an absolute value. Assembly quantities are sums over bodies and may count overlapping regions more than once.

Edge diagnostics quantize endpoints, enumerate undirected edge keys and inspect incidence and directions. A boundary edge occurs once; a nonmanifold edge occurs more than twice; same-direction pairs flag inconsistent winding. They do not detect every self-intersection or validate an exact solid model. Repair and reduction can change geometry and should be followed by inspection.

## Sketch solver

The residual vector is constructed from explicitly stored constraints. The solver computes a forward finite-difference Jacobian `J`, then solves the damped normal system:

```text
(JᵀJ + λI) Δx = -Jᵀr
```

Cholesky factorization solves the positive-definite system. A lower residual accepts the step and reduces damping; a worse residual increases damping. Default settings are 100 iterations and residual tolerance `1e-6`. A failed solve returns status and leaves the original sketch unchanged. The UI accepts a solved result through a normal document transaction.

This is a small nonlinear solver, not a symbolic constraint engine. It has no certified constraint rank, inferred relation system or general solution-branch management. Solve work is bounded to 256 points.

## Worker boundary

A geometry worker receives plain serialized solids and tool parameters, reconstructs Solid instances, executes the requested operation and returns serialized results plus diagnostic metadata. The controller handles each operation atomically and checks the starting revision before accepting a result.

One worker job is active at a time. Cancellation terminates the worker. The default timeout is 45 seconds. Each standalone Blob URL is revoked after completion. Errors are surfaced, not converted into a no-op success result.

Boolean operations, repairs, filling, splitting, reduction and shell jobs use this route where wired by the controller. Primitive creation, some direct edits, sketch solving, import parsing, tessellation and BVH construction can still run on the main thread. Workers use structured cloning rather than an optimized shared/transferable large-mesh representation; that is a scalability boundary.

## Rendering architecture

The renderer tries WebGPU first. It requests a device, compiles WGSL, validates shader compilation information and creates real surface, feature-edge, highlight, shadow and compute pipelines. If initialization fails it replaces the canvas to avoid mixing incompatible canvas contexts, destroys the failed device reference, and attempts WebGL2. Canvas 2D is the final explicitly labeled fallback.

### Native passes

1. A cached 2048 × 2048 directional-light depth map. Geometry, section and shadow-setting changes invalidate it.
2. A 4× multisampled shaded material pass with depth testing and a procedural grid/floor.
3. Feature-edge line overlays and a selected planar-face overlay with depth bias.
4. Resolve to the presentation canvas.

The shader uses a small metallic/roughness reflectance approximation, directional light, hemisphere/fill lighting, tone mapping and a 3 × 3 comparison-sampling shadow filter. There is no path tracer, texture system, HDR environment or physically complete light transport. Two-sided display aids inspection of open surfaces but does not fix their topology.

Buffers are cached per immutable Solid, while body color/selection data uses small per-body uniforms. Removed solids release their GPU resources. The renderer is invalidation-driven with at most one pending animation frame, not an artificial perpetual high-FPS loop. Camera matrices, grid and shadows update as needed. Pixel ratio is capped at 2 to limit fill cost.

The status-bar time is CPU scene preparation and command-encoding duration. It does not measure completed GPU work and is not an FPS benchmark. The compute-analysis dialog separately includes dispatch/readback/accumulation elapsed time.

### Compute analysis

A WGSL compute pipeline calculates per-triangle area and signed volume with float32 arithmetic. Storage-buffer output is copied into a map-readable buffer; JavaScript accumulates it in double precision. This is actual GPU compute, but its inputs remain faceted meshes and its arithmetic is not an exact replacement for the CPU reference. Shader precision error depends on scale, cancellation and device implementation.

### Picking and fallbacks

The CPU builds a median-split triangle BVH and finds the nearest ray hit, respecting the active clipping predicate. Face groups, feature edges and vertices are selected from that hit. No fake GPU picking counter is used.

WebGL2 implements a separate GLSL rendering route with real depth/shadow/material passes, but not native WebGPU compute. Canvas uses depth-sorted triangle painting, with substantially weaker occlusion, no equivalent shadows and simpler edge handling. Rendering device loss is reported and requires reload. Automatic device restoration is a future system.

## Persistence and native format

`ModelDocument.serialize()` produces a versioned object:

```json
{
  "format": "avolith",
  "version": 1,
  "name": "Example",
  "units": "mm",
  "bodies": [],
  "sketches": [],
  "components": [{"id": "parts", "name": "Parts"}],
  "layers": [{"id": "default", "name": "Default", "visible": true}],
  "groups": []
}
```

Each body carries a unique ID, name, material key, color, visibility, lock, component/layer references and a serialized solid. A solid stores polygons as `{v: [[x,y,z], ...], id: "..."}` and optional metadata. Sketches store construction plane, origin, points, closure and constraints. History and renderer state are intentionally outside the saved schema.

The local recovery store is IndexedDB database `avolith-studio`, object store `documents`, key `autosave`. Changes are debounced for 450 ms and writes are chained to reduce out-of-order persistence. A final unload write is best effort only. Saved files are downloaded through a Blob URL; there is no background filesystem access or native overwrite integration.

## Input and resource defenses

Parsers validate supported formats, coordinate finiteness, some dimensions/index ranges, counts and file size. Native parsing constrains colors and material keys and rejects duplicate body IDs. User-visible names are escaped before HTML/SVG generation. CSV quotes strings and guards leading formula characters. Uploaded file contents are never evaluated as JavaScript.

These are defense-in-depth checks, not a security audit or proof that every adversarial mesh is harmless. Large valid inputs can still consume substantial browser memory/CPU. Imported solid metadata and degenerate topology require care. Rendering fallback failures and worker exceptions are surfaced rather than hidden behind a success badge.

## Automation and extension

The browser exposes a development API as `window.avolith`. It is an in-page automation surface, not an MCP server or network endpoint:

```js
// In browser devtools after avolith.ready is true:
const a = window.avolith;
const block = a.kernel.box(40, 30, 20);
a.addSolid(block, 'Automation block', 'anodized');
const report = a.document.report();
console.table(report.bodies);
```

`execute(id)` invokes registered UI commands; commands may open dialogs and report errors through the UI instead of rejecting to the caller. `jobs.run(...)` is the direct asynchronous geometry-job interface. Core modules can be imported independently under Node for geometry processing and testing.

To add a tool: implement and test the core operation, expose its explicit limits, add worker dispatch when appropriate, wire a transactional handler and register command metadata. To add a renderer backend, preserve the backend label and do not count fallback work as native WebGPU.

Future major systems should be implemented as real modules rather than UI-only placeholders: analytic B-rep/surface intersection and tolerances, stable topology naming, exact translators, general blends and shelling, complete sheet topology, assembly constraints, drafting/PMI and verified manufacturing workflows.
