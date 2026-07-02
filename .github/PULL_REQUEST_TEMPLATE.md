# Summary

- 

# Scope

- Affected layer: Web Console / Knowledge Asset Layer / Query Runtime / Expert / Provider / Platform / Docs / Release
- User-facing behavior:
- Data boundary: workspace.sqlite / catalog.sqlite / credentials / local files / cloud calls / generated artifacts / none
- Extension lifecycle, if Expert or Provider: official / certified / community / experimental / n/a

# Verification

Run the narrowest relevant checks first, then broader gates when shared behavior or release assets are touched.

- [ ] `npm test`
- [ ] `npm run smoke:release`
- [ ] `npm run smoke:artifact`
- [ ] `npm run verify:package-boundary`
- [ ] `git diff --check`

# Safety

- [ ] Changes follow `docs/current-design.md` as the single current design authority.
- [ ] No secrets, private source text, SQLite databases, local workspaces, or generated artifacts are committed.
- [ ] Chinese and English public docs stay in sync when public docs changed.
- [ ] New runtime state uses `workspace.sqlite` / `catalog.sqlite`; JSON remains export, audit, sidecar, or report data.
- [ ] Query-facing changes preserve citations, refusal states, and feedback actions.
- [ ] Expert / Provider changes declare lifecycle and avoid direct internal SQLite access or unsafe wildcard permissions.
- [ ] Integration or contributor-facing changes use public API boundaries instead of internal SQLite or private runtime files.
