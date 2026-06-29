# KnowMesh Local Demo

This demo is intentionally credential-free. It exercises local scanning and plan generation with local files only.

Run:

```bash
npm run doctor
npm run demo:plan
```

The plan command scans `documents/`, groups split PDF parts such as `algebra-primer.pdf.1` and `algebra-primer.pdf.2`, and writes local manifests under `workspace/local-demo/`.

No upload, OCR, embedding, vector indexing, or delete operation is performed.
