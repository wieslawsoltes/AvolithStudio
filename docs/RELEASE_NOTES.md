# Engineering release — PR #1

This release consolidates every recovered implementation stage into normal source files. It replaces the baseline Pages package with the complete modular application. Historical transfer/import workflows are removed; they are not required to build or use the app.

## Delivered workspaces

- **Precision:** authoritative analytic B-rep/NURBS, exact creation and editing, STEP/IGES/BREP geometry exchange and worker-isolated CAD kernels. Display meshes remain replaceable tessellations.
- **Advanced:** periodic and UV-trimmed NURBS, ordered-grid surface fitting and differential analysis, variable-radius fillets, asymmetric chamfers, solid offsets, healing and true section curves/drawings.
- **Engineering / Manufacture:** multibend strips; polygon panels with connected edge flanges and corner relief; fold/unfold and flat exports; grounded assembly mates, joint drives/limits and worker-computed motion frames; hidden-line drawings, dimension/datum/FCF records and preparation exports.
- **Exchange:** native `.3dm` import of supported NURBS surfaces, trimmed B-reps and meshes. Units are converted explicitly. Unsupported objects fail strict import rather than disappearing silently. Native geometry and newly created untrimmed NURBS export analytically; other edited bodies export as explicitly labeled display meshes. Use STEP for general edited analytic solids.

## Delivery fixes

The CI gate runs all core, exact, native `.3dm`, original browser, precision browser, advanced/manufacturing, native-exchange and renderer suites. It also tests the actual packaged site under a subdirectory, loading all three native workers through the real controls.

Pages publishes the **same artifact that passed CI on `main`**, with no second packaging implementation. A `release.json` identifies the exact source commit. Post-deployment validation checks that commit and exercises real WebGPU startup, analytic solid creation, STEP/IGES downloads and `.3dm` surface round-trip on the public site.

The single-file download remains the explicitly labeled **offline faceted edition**. The build now strips every engineering module entry point, including native exchange. The old `Avolith-Studio.html` URL remains an alias of `Avolith-Studio-Offline.html`. Generated HTML is built in CI instead of retaining stale generated source in Git.

## Boundaries remain explicit

This is not full commercial CAD parity or a certified engineering system. Native `.3dm` conversion is bounded, including explicit rejection of singular trims. Other proprietary native CAD formats are not supported. Geometry validity does not guarantee successful fillets, shells or offsets on every input. Sheet workflows do not cover arbitrary stamping, springback or forming simulation. Assembly solving remains numerical and local, not a dynamics solver. Drafting and semantic annotations do not establish full GD&T/PMI standard conformance. Preparation exports remain surfaces/shell skins, not volume meshing, solved simulation or certification.

These are unmet product targets, not capabilities being counted as completed by merging this release.
