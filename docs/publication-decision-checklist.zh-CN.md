# Publication Decision Checklist / 发布决策清单

[English](publication-decision-checklist.en.md) | [Final Publication Review](final-publication-review.zh-CN.md) | [Release Operations](release-operations.zh-CN.md) | [Public Launch](public-launch.zh-CN.md)

这份清单是 Block Z 和 Block AA 之间的维护者操作表。它把最终证据、人工决策、可执行命令、回滚边界和发布后监控入口放在同一个地方。

它不替代 [current-design.md](current-design.md)。当前设计仍是唯一现行设计权威。它也不执行任何发布动作：仓库 Public、tag、GitHub Release、npm publish、公告都必须由维护者显式确认。

默认结论保持：

```text
releaseAllowed=false
publicationDecision=human-review-required
npmPublication=separate-decision
```

## 使用顺序

1. 刷新本地证据，生成 `exports/final-publication-review-evidence.json`。
2. 做只读远端检查，确认 GitHub / npm 当前状态。
3. 开 go/no-go 决策会，逐项确认 visibility、tag、GitHub Release、npm、announcement、rollback owner。
4. 只执行被维护者批准的动作。未批准项保持 blocked，不用脚本绕过。
5. 把执行结果写入 release notes 或维护者记录。
6. 只有实际发布完成后，才进入 Block AA Round AA1。

## 角色

| 角色 | 责任 |
| --- | --- |
| Release owner | 主持 go/no-go，确认目标 commit、tag、release notes 和证据包。 |
| Rollback owner | 负责失败后的 visibility、release、tag、npm dist-tag、announcement 修正路径。 |
| Security contact | 确认 SECURITY、private reporting、secret scanning、push protection 和公告里的安全入口。 |
| Docs / announcement owner | 确认 README、README.en、docs index、Roadmap、known gaps 和中英文公告同步。 |
| npm owner | 单独决定是否发布 npm，以及使用 `alpha` dist-tag 还是继续保持 unpublished。 |

## 0. 本地证据刷新

最小刷新命令：

```powershell
npm test
npm run smoke:final-publication
npm run generate:final-publication
npm run verify:package-boundary
npm run verify:integration-privacy
npm run smoke:artifact
git diff --check
```

如果距离上次完整冻结已经有代码或文档变化，重新跑完整公开候选证据：

```powershell
npm run smoke:release-candidate
npm run generate:release-candidate
npm run smoke:public-launch
npm run generate:public-launch
npm run smoke:stabilization
npm run generate:stabilization
npm run smoke:api-reliability
npm run generate:api-reliability
npm run smoke:community-release
npm run generate:community-release
npm run smoke:final-publication
npm run generate:final-publication
npm run verify:package-boundary
npm run verify:integration-privacy
npm run smoke:artifact
git diff --check
```

证据通过的最低条件：

- `npm test` 无失败。
- `smoke:final-publication` 输出 `ok: true`，同时保持 `releaseAllowed: false` 和 `publicationDecision: human-review-required`。
- `exports/final-publication-review-evidence.json` 不包含本机路径、credentials、raw provider payloads 或私有源文档文本。
- `verify:package-boundary` 没有 rejected 文件。
- `verify:integration-privacy` findings 为 `0`。
- `smoke:artifact` 输出 tarball `sha256`，并准备写入 release notes。

## 1. 只读远端检查

这些命令只读，用来确认当前远端状态：

```powershell
gh repo view shineway-tech/KnowMesh --json nameWithOwner,visibility,isPrivate,description,homepageUrl,repositoryTopics,hasIssuesEnabled,isSecurityPolicyEnabled,usesCustomOpenGraphImage,latestRelease
gh run list --repo shineway-tech/KnowMesh --limit 10 --json workflowName,status,conclusion,headSha,createdAt,url
gh release view v0.1.0 --repo shineway-tech/KnowMesh --json tagName,name,isDraft,isPrerelease,publishedAt,url
npm view knowmesh name version dist-tags repository license --json
```

如果 `gh release view v0.1.0` 或 `npm view knowmesh` 返回不存在，不是失败信号；它只说明对应发布动作尚未发生。

## 2. 决策表

| 决策 | 默认 | 必要输入 | 批准后动作 | 回滚边界 |
| --- | --- | --- | --- | --- |
| Repository visibility | 保持 Private | Final evidence、CI/CodeQL/Scorecard、README、SECURITY、issue templates、social preview | GitHub UI 或 `gh repo edit shineway-tech/KnowMesh --visibility public --accept-visibility-change-consequences` | 可以改回 Private，但已经公开暴露的 commit、Actions 日志、release assets、截图和 fork 影响不能当作从未发生。 |
| About / Topics / Social preview | 先只审查 | README 定位、topics、description、preview image | GitHub UI 更新 About、topics、social preview；或用 `gh repo edit` 更新 description/homepage/topics | 可修改，但搜索索引和社交缓存可能延迟刷新。 |
| Git tag | 不自动打 tag | 目标 commit、CHANGELOG、release notes、artifact sha256 | `git tag -a v0.1.0 -m "KnowMesh v0.1.0"` 后 `git push origin v0.1.0` | tag 推送后如需删除必须明确记录原因；如果已创建 release 或 npm 发布，删除 tag 不等于回滚发布。 |
| GitHub Release | 不自动创建 | tag、release notes、artifact sha256、known gaps、rollback owner | `gh release create v0.1.0 --repo shineway-tech/KnowMesh --verify-tag --draft --prerelease --title "KnowMesh v0.1.0" --notes-file <release-notes-file>` | Draft 可编辑或删除；发布后要用 amendment notes 说明修正，不要静默替换证据。 |
| npm publish | separate-decision | package boundary、artifact smoke、npm owner、2FA/automation 权限 | 先 `npm publish --dry-run`，批准后 `npm publish --tag alpha` | 已发布版本通常不能当作未发生；优先用 dist-tag 修正、deprecate 或发布补丁版本。 |
| Announcement | 不自动发送 | Public URL、release URL、known gaps、support lanes、security path、first 72-hour owner | 发布中文和 English 公告，链接 README、docs、public samples、known gaps 和 feedback issue | 公告可补充更正，但外部传播不可完全撤回。 |
| Block AA start | 发布前 blocked | visibility/tag/release/npm/announcement 的真实执行记录 | 开始 Round AA1 第一 24 小时健康检查 | 不能用模拟结果代替发布后监控。 |

## 3. 建议的 release notes 内容

Release notes 必须诚实表达 Alpha / Public Launch Candidate 状态，不承诺商业稳定性。

必须包含：

- KnowMesh 是 local-first Knowledge Asset Compiler，不是普通 RAG demo。
- 当前核心能力：SQLite-first workspace/catalog、Query Runtime、public samples、Expert / Provider 边界、package boundary、release evidence。
- K12 是第一个主要 Expert 场景，不是全部定位。
- 已知缺口：本地 parser/OCR provider 仍在加强，真实教材需用户授权，不捆绑私有或版权资料。
- 验证命令摘要和 `smoke:artifact` sha256。
- 支持入口：Issues、Security、public samples、integration docs、community backlog。
- `npmPublication` 状态：unpublished、separate-decision，或 published with `alpha` dist-tag。

## 4. 发布前停止条件

任一情况出现时停止发布动作：

- `npm test`、`smoke:final-publication`、package boundary、privacy audit 或 artifact smoke 未通过。
- evidence JSON 出现本机路径、credentials、私有源文本、SQLite 数据库或 raw provider payload。
- README / README.en / docs index 不一致。
- SECURITY、issue templates、CI、CodeQL、Scorecard 缺失或目标 commit 未通过。
- release notes 没有 known gaps、rollback owner 或 artifact sha256。
- npm owner 未明确批准 npm publish。
- visibility 影响没有被维护者接受。

## 5. 执行后记录

如果维护者执行了某个发布动作，记录：

```text
action:
owner:
timestamp:
targetCommit:
tag:
githubReleaseUrl:
npmVersion:
npmDistTag:
artifactSha256:
knownGapsLinked:
rollbackOwner:
nextBlock: Block AA Round AA1
```

## 6. Block AA 入口

Block AA 只能在真实发布后开始。第一轮是 Round AA1：First 24-Hour Health Review。

Round AA1 要检查：

- CI、CodeQL、Scorecard 是否仍对公开目标 commit 通过。
- Release assets、README 链接、docs 链接、social preview 是否正常。
- npm install 或未发布声明是否和 release notes 一致。
- Issues、Security、反馈模板、support lanes 是否可用。
- 是否出现 private data、credential、source text 或 local path 泄漏。

前 72 小时还要维持反馈循环：分类 launch feedback、标记 known gaps、修正文档误导、记录 adoption friction，并把需要功能实现的内容放进下一轮 roadmap，而不是立即破坏发布冻结。
