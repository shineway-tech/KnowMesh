# Operations Handbook Expert

[English](operations-handbook.en.md) | [Authoring Kit](authoring.zh-CN.md) | [当前设计](../current-design.md)

`operations-handbook` 是 KnowMesh 的非 K12 公开示例 Expert。它用于制度、流程、复核节奏、回滚规则和证据要求这类运维手册资料，证明 Expert 合同不局限于教育场景。

## 领域对象

- `policy`：制度或规则范围。
- `procedure` / `workflow_step`：流程和步骤。
- `role` / `owner`：责任角色和资料负责人。
- `review_cadence`：复核节奏。
- `rollback_rule`：发布或流程回滚规则。
- `evidence_requirement`：回答或执行动作必须引用的证据要求。

## 运行边界

- 使用 `public-handbook-scope` 做来源范围声明。
- 结构、对象、引用和评测都通过公开 Expert runtime hook 接入。
- Query Runtime 只能在有引用证据时回答；无证据问题返回 no-answer，不生成弱答案。
- 示例 fixture 必须是合成公开内容，不能包含客户资料、凭证或本机路径。

## 本地验证

```bash
npm test -- src/local-service/operations-handbook-expert.test.mjs
npm test -- src/local-service/query-route-planner.test.mjs src/local-service/query-evidence.test.mjs
```
