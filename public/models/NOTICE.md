# Third-party model: LightGlue-ONNX

`superpoint_lightglue_pipeline.onnx` is redistributed unmodified from:

- Project: https://github.com/fabio-sim/LightGlue-ONNX
- Release: v2.0 (Dynamic Batch LightGlue-ONNX)
- Asset: `superpoint_lightglue_pipeline.onnx`
- License: Apache License 2.0 (https://github.com/fabio-sim/LightGlue-ONNX/blob/main/LICENSE)

Used by `src/utils/tracker/lightglueSession.ts` for browser-side (onnxruntime-web)
feature matching between PDF page renders, to re-track annotation positions when a
document is updated. See `src/utils/tracker/` for the calling code.

## Why this file is bundled instead of fetched on demand

We'd prefer to fetch this on demand (as `ppu-paddle-ocr` does for its OCR models)
instead of bundling ~51MB in the repo, but GitHub Releases' download URLs do not send
CORS headers, so a browser `fetch()` to the official release asset is blocked. Once a
CORS-enabled host (object storage/CDN under our control) is available, point
`LIGHTGLUE_MODEL_URL` in `lightglueSession.ts` at that URL and remove this file.
