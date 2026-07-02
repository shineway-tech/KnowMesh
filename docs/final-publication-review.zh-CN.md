# Final Publication Review / 最终发布审核

[English](final-publication-review.en.md) | [发布决策清单](publication-decision-checklist.zh-CN.md) | [Community Release Readiness](community-release-readiness.zh-CN.md) | [Release Operations](release-operations.zh-CN.md)

Block Z 是最终发布前的人工审核包。它只汇总证据和需要维护者决定的事项，不执行任何发布副作用。

`publicationDecision` 必须保持 `human-review-required`。

## Final Evidence Rollup

最终 rollup 汇总：

- release-candidate evidence
- public-launch evidence
- stabilization evidence
- api-reliability evidence
- community-release evidence
- artifact hash / package hash
- package file count
- verification commands
- public-safe evidence paths

packet 不能包含 private paths、credentials、raw provider payloads 或 source document text。

## GitHub / Repository Review

GitHub 和 repository 审核项：

- CI / CodeQL / Scorecard expectations
- issue templates
- SECURITY.md / CONTRIBUTING.md
- topics / about text
- social preview
- repository visibility
- tag / GitHub release draft

visibility、tag、GitHub release 都是人工审核，不由脚本执行。

## npm Package Review

npm 审核项：

- package metadata
- exports
- bin launcher
- Node engine
- package boundary
- packed install rehearsal
- artifact hash
- npm publication as a separate decision
- rollback notes

npm publish 不和 GitHub release 混在一起，仍然是独立人工决策。

## Announcement And Support

公告材料要支持中文和 English，不夸大成熟度。当前仍按 alpha / Public Launch Candidate 语气表达。

公告和支持材料必须链接：

- known gaps / 已知缺口
- public samples / 公开样例
- integration docs / 集成文档
- support lanes
- security support path
- first 72-hour / 72 小时 response loop

## Human Decision Packet

最终人工决策清单：

- visibility
- tag
- GitHub release
- npm publish
- announcement
- rollback owner

go/no-go 只能由维护者确认。自动化只输出 public-safe evidence 和 `human-review-required`。

详细执行表见 [Publication Decision Checklist / 发布决策清单](publication-decision-checklist.zh-CN.md)。它把本地证据刷新、只读远端检查、visibility/tag/GitHub Release/npm/announcement 决策、回滚边界和 Block AA 入口放在同一个维护者操作表里。

## After Publication

如果维护者完成实际发布，下一个工作块才进入 `post-publication-monitoring`：观察反馈、处理安全报告、维护 known gaps、更新 release notes、评估下一轮 roadmap。
