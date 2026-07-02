# 1.0.0 Public Release Candidate Freeze

[English](release-candidate-freeze.en.md) | [文档中心](README.md) | [Release Operations](release-operations.zh-CN.md) | [当前设计](current-design.md)

这个页面定义 KnowMesh 切到公开发布候选前的冻结证据。它不是新功能阶段，而是把 `1.0.0 Usable Product Proof` 固化成一个可审查、可复跑、可拒绝的 release-candidate 包。

## 目标

- 从真实本地 smoke 和审计生成一个 `release-candidate-evidence` JSON。
- 证明非维护者可以从 packed tarball 安装并通过用户入口启动 Web Console。
- 覆盖 public sample、Query Runtime、拒答、反馈、maintenance、diagnostics、version、package preview 和 reset。
- 保留 npm 发布、GitHub Public、tag/release 为显式人工决策，不在 smoke 中产生发布副作用。

## 命令

```bash
npm run smoke:release-candidate
npm run generate:release-candidate
node ./scripts/release-gate.mjs --usable-product --evidence exports/release-candidate-evidence.json
```

`npm run smoke:release-candidate` 会聚合 release smoke、artifact smoke、package boundary、integration privacy、browser sample、SDK consumer、live SDK、operator workflow、first-run usability、usable product smoke 和 fresh-clone install rehearsal。

## go/no-go

go/no-go packet 必须包含：

- supported paths：当前实际支持的启动、样例、问答、反馈、维护、包预览和集成路径；
- limitations：仍处于 alpha / RC 的限制；
- known gaps：需要 release-note carryover 的已知问题；
- artifact hash：当前 tarball sha256；
- verification commands：本地、浏览器、SDK、隐私和包边界命令；
- no publication side effects：不自动切 Public、不自动打 tag、不自动发布 npm。

## 阻断条件

- 证据包不能通过 `1.0.0-usable-product` release gate。
- fresh-clone rehearsal 不能通过安装后的 launcher-first path 启动。
- browser evidence 出现横向溢出、占位文案、重复主操作或内部状态措辞。
- package/release assets 含私有状态、SQLite/WAL、凭证材料、本地路径、生成浏览器产物或私有内容。
- README、docs index、release operations、security、contributing、issue templates、good-first docs 与实际支持路径不一致。
