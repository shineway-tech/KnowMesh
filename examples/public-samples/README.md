# KnowMesh Public Samples

[中文说明在下方](#公开样例)

These public samples are credential-free fixtures for launch-candidate testing. They are intentionally tiny, synthetic, and safe to ship in an open repository.

## What They Prove

- Query Runtime can answer with citations from a public sample catalog.
- No-answer behavior stays explicit when evidence is missing.
- Feedback, package preview, and version manifest APIs work against sample knowledge bases.
- The `operations-handbook` Expert can model non-K12 policy and procedure documents with public fixtures.
- Synthetic K12 material can exercise the first Expert scenario without bundling textbook content.

## Run Scope

These samples are local-only. They perform no upload, no OCR call, no embedding call, no vector write, and no cloud resource creation.

Use them from tests or the local Web Console as source folders:

```text
examples/public-samples/general-docs/source/
examples/public-samples/operations-handbook/source/
examples/public-samples/k12-synthetic/source/
```

## Data Boundary

- `general-docs` contains a fictional operations handbook.
- `operations-handbook` contains a fictional Expert SDK operations handbook with policy, procedure, review cadence, rollback, and evidence objects.
- `k12-synthetic` contains invented Grade 5 math text for decimal division.
- No private document, credential, real textbook page, model output, or generated SQLite database belongs here.

## 公开样例

这些公开样例是无密钥、可提交到开源仓库的 launch candidate 验收材料。它们刻意做得很小，而且都是合成内容。

## 它们证明什么

- Query Runtime 可以基于公开样例 catalog 返回带引用的回答。
- 找不到证据时会明确拒答，不把弱答案伪装成成功。
- 反馈、包预览和版本 manifest API 能在样例知识库上工作。
- `operations-handbook` Expert 可以用公开 fixture 表达非 K12 的制度和流程资料。
- 合成 K12 样例可以验证第一个 Expert 场景，但不捆绑教材内容。

## 运行边界

这些样例只用于本地测试：不上传、不调用 OCR、不调用 embedding、不写向量索引、不创建云资源。

## 数据边界

- `general-docs` 是虚构的运维手册。
- `operations-handbook` 是虚构的 Expert SDK 运维手册，包含制度、流程、复核节奏、回滚和证据对象。
- `k12-synthetic` 是合成的小学五年级数学“小数除法”材料。
- 这里不能放私有文档、凭证、真实教材页、模型输出或生成的 SQLite 数据库。
