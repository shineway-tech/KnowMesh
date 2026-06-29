# Security Policy

KnowMesh handles local documents, cloud credentials, and generated knowledge-base artifacts. Treat all of these as sensitive unless a project explicitly marks them public.

## Reporting

Please report security issues privately before opening a public issue. When GitHub private vulnerability reporting is enabled for `shineway-tech/KnowMesh`, use that channel. Until then, open a minimal issue asking for a private security contact path and do not include exploit details, credentials, document text, logs, or local paths.

## Secrets

- Store credentials in `.env` or your deployment secret manager.
- Never commit `.env`, provider access keys, API keys, or generated credential files.
- Local service and CLI output must redact fields containing `KEY`, `SECRET`, `TOKEN`, or `PASSWORD`.

## Remote operations

Remote operations must require explicit confirmation and should show a clear cost, scope, and risk summary before running. This includes cloud resource creation, source archive upload, OCR, embedding, rerank, vector writes, metadata-contract upgrades, and destructive maintenance actions.

Local checks such as `npm run doctor` and `npm run demo:plan` are expected to stay credential-free and must not upload, delete, call models, or write vector indexes.
