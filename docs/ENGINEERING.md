# Analytic CAD and engineering architecture

## Representations and authority

A body is still a `Solid` in the original application document. Faceted bodies own polygon geometry. Exact bodies additionally own `solid.meta.exact`: portable OpenCascade B-rep text, a 4×4 similarity pose, native topology/property records, tessellation-edge polylines and optional engineering definitions. The B-rep is authoritative for exact operations. Display triangles use per-vertex native normals and current face indices; edge polylines come from kernel tessellation, not a visual crease heuristic.

The `pose` maps the serialized B-rep into the displayed world. Local rigid/uniform edits update both displayed vertices and pose. A later native operation loads the portable B-rep, applies that pose, operates and returns a newly serialized world-space source with identity pose. Nonuniform/shear transforms are rejected for exact bodies; silently converting them to facets is prohibited.

`Solid.transform` uses inverse-transpose normal transformation and reverses winding for reflections. Native mass properties use area × scale² and volume × scale³. Retessellation changes display tolerance without intentionally changing native geometry. Surface and sheet definition frames are preserved separately when a transform is baked into a new B-rep.

## Worker protocol and transactions

`exact-client.js` sends `{id, command, args}` to the module worker. `exact-worker.js` processes requests serially, initializes the modern CAD engine on demand and returns a packet or a descriptive error. Exact edits snapshot document identity and revision before dispatch; a response is committed only if both still match. The change is one document transaction, so undo/redo restores the previous source, mesh and engineering state.

A maximum of four pending requests prevents unbounded queues. Requests have a time budget. Cancellation terminates the worker, rejects all pending promises and discards pending edits. Restart needs no hidden native handles because all persistent geometry lives in portable B-rep records in the document. The native scope utility tracks temporary Emscripten objects and releases them on success or failure. Every modeling result is checked before tessellation and packet creation.

Large native files/meshes are bounded: 32 MB imported text, 200,000 display triangles per packet, 20,000 faces, 50,000 edges and 4,096 NURBS poles. These are product safeguards, not claimed kernel maxima. The application remains responsive during modern and IGES native computation. The bounded assembly solver currently runs synchronously on the UI thread.

## Surface modeling

`validateNURBS` checks rectangular control nets, finite coordinates, positive weights, degree bounds, strictly increasing distinct knots, integer multiplicities and `sum(multiplicities) = poleCount + degree + 1`. `Geom_BSplineSurface` stores the rational surface; the editor creates a face over its nonperiodic domain. Loft/revolve/sweep use native curves and surfaces. Imported analytic surfaces remain part of their B-rep even where no dedicated control-net editing UI exists.

Planar face Pull uses an exact face extrusion, then fuses outward or cuts inward. It is not advertised as unrestricted arbitrary-surface displacement. Fillet, chamfer, shell and offset failures remain errors, not fallback approximations. Explicit planar mesh reconstruction creates exact planes around mesh polygons and does not invent recovered analytic curvature.

## STEP / IGES exchange

Modern Replicad/OpenCascade handles STEP and BREP. STEP export can include per-shape names and colors. Its importer returns geometry without rebuilding source component hierarchy or semantic PMI.

The older, larger OpenCascade build supplies IGES in a separate on-demand worker. Modern-to-legacy transfer uses an explicit AP203 STEP bridge; using the modern default AP242 stream is not assumed compatible. IGES-to-modern transfer reads IGES in the legacy kernel, writes STEP, then validates it in the modern kernel. Each worker has an isolated virtual filesystem with fixed short filenames and cleanup in `finally`. Translators check reader/writer return statuses. UI and documentation state that this path preserves geometry, not full native assembly information.

## Sheet metal

The sheet model is a developable constant-width strip: tangent flange lengths, signed bend angles, inside radii, thickness and K-factor. The folded cross section offsets the mid-thickness line/arc chain by ±thickness/2, preserving circular arcs, then extrudes the exact wire across the width. Punch cutters are oriented perpendicular to their flat flange.

Flat bend allowance is `BA = |theta| (R + K t)`. Flat position accumulates straight tangent flange lengths and allowances. Bend-center lines and round punches are exported with the developed outline. A sampled centerline intersection check rejects folded strips that obviously cross; native validity checks then verify the produced shape. Overlapping and tangent punches are rejected. For K=0.5 the regression checks folded/flat volume conservation; other K factors intentionally use an empirical neutral-axis allowance rather than a strain-conserving forming model.

A topology-changing operation removes the retained sheet definition rather than pretending the modified result can still unfold. Rigid/uniform transforms preserve its frame. The old single-bend faceted bracket tool remains separate.

## Assembly constraints

An assembly datum stores body ID, geometry-generation key, a local point, a local primary axis and orthogonal X axis. Body-local frames follow similarity transforms; topology replacement invalidates the generation key. This deliberately avoids silently binding old references to arbitrary new face indices.

Ten mate types produce point, axis and frame residuals. The solver uses six rigid-body variables per mobile body, central-difference Jacobians, damped normal equations and bounded steps. Angular residuals are scaled by 10 mm/radian by default. Acceptance uses the maximum residual, not merely a small objective improvement. A rank calculation estimates instantaneous remaining degrees of freedom. At least one body must be grounded or locked; conflicting/nonconvergent constraints are not applied. This is a local numerical solver with explicit budgets, not a guarantee of convergence for every mechanism or singular configuration.

## PMI and drawings

Annotations store semantic type, anchor coordinates, tolerances and datum/FCF metadata. Body-linked anchors are expressed in the local reference frame. Stale references are flagged in the manager and preparation report, not silently displayed as current dimensions. Dimensional values derive from 3D anchor positions. A nonplanar linear dimension in a projected view is labeled `3D REF` when its value differs from the drawn projected distance.

Native hidden-line removal generates visible/hidden curves for front, top and right views. `engineeringDrawing` places these on A3 with a title block and annotation layer. Semantic PMI JSON is an application interchange format, not ISO/ASME or STEP conformance. Text is escaped before SVG insertion. User labels are escaped in CSV, including spreadsheet-formula prefixes.

## Geometry preparation

Native clearance is a shape-distance query. Interference additionally computes common solid volume, distinguishing penetrating solids from merely touching ones. Preparation reports combine cached native validity/property records, current mesh topology, small-feature thresholds and stale reference checks. Sampled wall thickness uses inward triangle-centroid BVH rays and is explicitly not a guaranteed global minimum.

VTK output is a triangle surface with body groups; vertices weld within a body, not across body interfaces. S3 output models those triangles as a shell skin using user-provided thickness/material values. No volume elements, supports, loads or contacts are invented. Neither export is a solved simulation or certification.

## Distribution and dependency boundaries

The enhanced modular app serves `vendor/` from the same origin. Fixed npm versions and SHA-256 checksums make the installation reproducible. WebAssembly files remain separately replaceable; upstream notices and source/build references accompany the distribution. The standalone build deliberately removes the engineering entry point and ships as the offline faceted edition. It does not claim the exact kernel is embedded in one HTML file.
