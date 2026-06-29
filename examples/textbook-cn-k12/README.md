# 中国 K12 教材知识库样例

这是 KnowMesh `0.1.0` 的 K12 增强模板样例, 用用户已授权的本机教材目录和阿里云配置展示教材知识库的配置形态。

无密钥本地检查请使用 `examples/local-demo/`。本目录用于用户自备且已授权的教材目录和 Aliyun provider 配置。

## 适用范围

默认目标是 K12 教材，后续可以按学科、学段、版本、年份和教材册别分批处理。

当前配置重点支持:

- 语文、数学、英语等核心学科
- PDF 页面级 OCR 任务
- 清洗后分片
- `text-embedding-v4` 向量化
- 写入示例 OSS Vector Bucket 的 `knowmesh_example_v1` 索引

## 特别注意

`.pdf.1`、`.pdf.2`、`.pdf.3` 这类文件是同一本 PDF 的二进制分片。处理时必须先按 `partNumber` 顺序合并，再作为一个逻辑文档入库。索引记录中要保留 `sourceParts`，方便审计和重跑。

## 本地检查

先设置已授权的教材目录:

```bash
KNOWMESH_K12_SOURCE_ROOT=/path/to/authorized-k12-sources
```

```bash
npm run doctor:textbook
```

该命令只做本地配置检查, 不上传、不删除、不调用 OCR、不调用 Embedding。
