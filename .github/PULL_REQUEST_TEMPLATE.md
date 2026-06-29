## Summary

- 

## Design / Scope

- [ ] I checked `docs/current-design.md` when changing product direction, data model, durable UX, or runtime state.
- [ ] This PR does not create a second product blueprint, data standard, or long-term design authority.
- [ ] If this touches runtime state, SQLite/catalog remains the source of truth.

## Verification

- [ ] `npm test`
- [ ] `npm run smoke:release`
- [ ] `npm run smoke:artifact`
- [ ] `npm run verify:package-boundary`

## Safety Checklist

- [ ] No `.env`, secrets, generated credentials, local workspace data, or private documents are included.
- [ ] Remote/cloud operations remain confirmation-gated.
- [ ] SQLite remains the runtime source of truth for mutable state.
- [ ] Public docs do not include private source text, textbook content, local paths, logs, or generated artifacts.
