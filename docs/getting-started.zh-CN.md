# KnowMesh 快速入门

[English](getting-started.en.md) | [文档中心](README.md) | [项目首页](../README.md)

本指南帮助你在不配置云密钥、不上传文件、不调用模型的情况下跑通 KnowMesh 的本地路径。

## 环境要求

- Node.js 24 或更新版本。
- Windows、macOS 或 Linux。
- 可选：Ghostscript 用于扫描 PDF 拆页；LibreOffice 用于旧 Office/WPS 格式转换。

普通用户也可以通过仓库内启动器运行。启动器会在缺少系统 Node.js 24+ 时准备私有运行时，不修改系统 PATH。

## 安装依赖

```bash
npm install
```

## 运行无密钥本地检查

```bash
npm run doctor
```

该命令读取 `examples/local-demo/kb.yaml`，检查本地示例资料、工作区路径和基础配置。它不会上传、删除、调用 OCR、调用 embedding 或写向量索引。

## 生成本地 demo 计划

```bash
npm run demo:plan
```

该命令扫描 `examples/local-demo/documents/`，识别普通文件和分卷 PDF 示例，并把本地计划产物写入 `workspace/local-demo/`。

## 启动 Web Console

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:7457
```

也可以使用启动器：

```bash
# Windows
.\knowmesh.cmd start

# macOS / Linux
./knowmesh start
```

## 本地验证命令

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
```

- `npm test`：全量测试。
- `npm run smoke:release`：启动临时本地服务并检查关键 API。
- `npm run smoke:artifact`：打包 tarball，在干净临时 npm 项目中安装，并验证 CLI help 和包内无私有状态。
- `npm run verify:package-boundary`：确认发布包不包含 `.env`、SQLite、workspace、knowledge-bases、测试文件或私有产物。

## K12 示例

`examples/textbook-cn-k12/` 是 K12 强化模板的 Aliyun 配置示例。它不包含教材内容，也不适合无密钥本地 demo。用户必须使用自有或已授权资料。

```bash
KNOWMESH_K12_SOURCE_ROOT=/path/to/authorized-k12-sources
npm run doctor:textbook
```

## 下一步

- 了解架构：[架构概览](architecture.zh-CN.md)
- 查看完整设计：[Current Design](current-design.md)
- 查看运维和发布门禁：[Operations Runbook](phase1-6-operations-runbook.md)
