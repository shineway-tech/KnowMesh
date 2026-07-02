# Extension Certification Registry

[English](extension-certification.en.md) | [Expert Authoring Kit](experts/authoring.zh-CN.md) | [Provider 适配器](providers.zh-CN.md) | [当前设计](current-design.md)

Extension Certification Registry 记录 Expert 和 Provider 扩展在 Public Beta 中的稳定性、维护者、测试、文档、安全边界和已知限制。它不是营销标签，而是维护者和贡献者判断“能不能依赖”的证据。

## Lifecycle Graduation

阶段顺序仍然是 `official` -> `certified` -> `community` -> `experimental`。

- `experimental`：可以探索，但必须标注限制。
- `community`：有维护者、文档、测试和安全边界。
- `certified`：通过维护者审查，声明权限、diagnostics、dry-run、known limitations 和 release evidence。
- `official`：随 KnowMesh Core 一起维护，进入 release gate。

## 当前记录

- Expert `k12`：`official`，由 KnowMesh Core 维护，不捆绑真实教材。
- Expert `operations-handbook`：`experimental`，仅作为非 K12 authoring 示例。
- Provider `local-catalog`：`official`，本地 catalog/search 事实源。
- Provider `local-parser`：`certified`，作为第一个 provider adapter pilot，不联网、不执行宏，通过公开 writer API 写入结果。

## Graduation Rules

- 必须声明 owner、supported contract version、docs、required tests、security notes 和 known limitations。
- 不允许 `*`、`admin`、`root`、`filesystem:all`、`sqlite:write` 这类不安全权限。
- 不允许直接读取或修改内部 SQLite 文件路径；必须走公开 Core / Provider / Expert 接口。
- 升级到 `certified` 或 `official` 前，必须有 package-boundary、release evidence 和相关专项测试。
