# Operations Handbook Expert

[中文](operations-handbook.zh-CN.md) | [Authoring Kit](authoring.en.md) | [Current Design](../current-design.md)

`operations-handbook` is KnowMesh's non-K12 public example Expert. It targets policies, procedures, review cadence, rollback rules, and evidence requirements, proving that the Expert contract is useful beyond education.

## Domain Objects

- `policy`: policy or rule scope.
- `procedure` / `workflow_step`: procedures and actionable steps.
- `role` / `owner`: responsible roles and source owners.
- `review_cadence`: review schedule.
- `rollback_rule`: release or workflow rollback rule.
- `evidence_requirement`: cited evidence required for answers or actions.

## Runtime Boundary

- Uses `public-handbook-scope` for source-scope declarations.
- Structures, objects, citations, and evaluations connect through public Expert runtime hooks.
- Query Runtime answers only when cited evidence exists; missing evidence returns no-answer instead of a weak answer.
- Fixtures must be synthetic public content and must not contain customer material, credentials, or local absolute paths.

## Local Verification

```bash
npm test -- src/local-service/operations-handbook-expert.test.mjs
npm test -- src/local-service/query-route-planner.test.mjs src/local-service/query-evidence.test.mjs
```
