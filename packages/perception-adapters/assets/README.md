# Model weight assets — `@sporta/perception-adapters`

This directory holds OPTIONAL model weight assets for the
`ModelBackedDetector` candidate (`perception.player-detection`). The adapter
resolves presence dynamically (`resolveWeightsPath`) and reports
`weightsStatus: "downloaded" | "not-downloaded"` honestly; when weights are
absent the candidate fails closed with the documented
`model-backed.weights-unavailable` failure class.

## Pinned provenance (the ONE sanctioned download of this wave)

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| File     | `yolov8n.pt`                                                    |
| URL      | https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt |
| Size     | 6,549,796 bytes                                                 |
| SHA-256  | `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36` |
| License  | AGPL-3.0 (Ultralytics dual-licensing track) — **evaluation-only**; commercial use unresolved |

Reproduce with:

```bash
curl -sL -o yolov8n.pt \
  "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt"
sha256sum yolov8n.pt
```

## Why the binary is NOT committed

The 6.5 MB checkpoint is gitignored (`.gitignore` in this directory) to keep
the repository lean; the pinned URL + size + SHA-256 above make the fetch
deterministic and verifiable. A fresh clone reports
`weightsStatus: "not-downloaded"` until the asset is fetched — which is the
honest state.

## Integration point (the honest gap)

Weights present does NOT mean runnable: the real inference runtime arrives
with the GPU worker protocol (W303). Until then `ModelBackedDetector`
requires an injected `ModelInferenceBackend` (see
`src/detection/model-backed.ts`) and otherwise fails closed with the
documented `model-backed.inference-backend-not-wired` failure class.
