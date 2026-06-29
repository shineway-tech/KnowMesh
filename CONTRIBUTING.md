# Contributing to KnowMesh

KnowMesh is being built as a local-first knowledge-base builder for auditable RAG, traceable citations, and maintainable document intelligence.

## Development principles

KnowMesh should move toward the complete product experience without keeping unnecessary intermediate code or documents. Keep the repository lean: delete unused code, stale docs, dead examples, and abandoned configuration instead of leaving them around as references.

See `docs/current-design.md` for the current product, architecture, data,
quality, UX, and development discipline.

One document type should have one current document. When a new version of a plan,
product description, feature guide, or configuration guide replaces the old one,
migrate useful information into `docs/current-design.md` and delete the old file.

## Local checks

```bash
npm install
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
npm run doctor
npm run demo:plan
```

## Safety rules

- Do not commit `.env`, workspace artifacts, model outputs, private documents, or generated secrets.
- Do not add code that uploads, deletes, calls OCR, calls embedding, or writes to vector indexes without an explicit execution gate.
- Keep local planning paths usable without cloud credentials.
- Preserve `sourceParts` whenever split files such as `.pdf.1` and `.pdf.2` are grouped into one logical document.

## Data model expectations

- Every logical document needs a stable `document_id`.
- Every content version needs a distinct `version_id`.
- New versions should be proposed first, then activated through an active manifest.
- OCR failures must be recorded rather than silently dropped.
