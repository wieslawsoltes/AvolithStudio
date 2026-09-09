# Avolith Studio

Local-first 3D direct modeling in plain HTML and JavaScript with native WebGPU rendering, plus explicitly labeled WebGL2/Canvas fallbacks.

The original application is being imported losslessly from the delivered source archive. The import validates the SHA-256 checksum before writing source files. The original faceted-solid engine and UI are preserved as the baseline for exact-modeling and engineering enhancements.

## Run

```sh
python3 -m http.server 8765
```

Open http://localhost:8765. `npm run build` generates the offline standalone HTML under `dist/`.

## Scope

The baseline includes direct faceted modeling, sketches, Boolean solids, sheet brackets, inspection/repair, file exchange, persistence, and transactional undo/redo. It does **not** claim exact B-rep/NURBS modeling, general fillets/shells, STEP/IGES translation, complete engineering workflows, or production certification. Subsequent work is developed and validated separately.

Original application source: MIT. Optional CAD-kernel dependencies retain their own licenses.
