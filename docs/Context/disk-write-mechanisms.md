# 写盘机制总览

## 写盘路径决策

```
persistBundle()
  ├─ native host 可用？
  │   ├─ 是 → writeFileWithNativeHost()        直接写目标路径
  │   └─ 否 → downloadTextAsset()              写 Downloads 文件夹
  │               └─ native host 可用？
  │                   └─ 是 → relocateFileWithNativeHost()  移到目标路径
  ├─ syncBundleToServer()                       POST 到本地 Server（可选，非阻塞）
  └─ updateArtifactIndex()                      写 extension storage
```

## 三条写盘通道

### 1. Native Host（主路径，Windows 专属）

- 文件：`apps/extension/native-host/host.cjs`
- 调用方：`apps/extension/src/runtime/native-host.ts`
- 协议：stdin/stdout 长度前缀 JSON 消息
- 能力：
  - `writeFileSync()` — 直接写文件（UTF-8 / base64）
  - `rename()` / copy+delete — 文件移动
  - PowerShell `Recycle-Item` — 回收站删除
  - `pruneOldFiles()` — 按 mtime 清理归档

### 2. Browser Downloads API（回退路径）

- 文件：`apps/extension/src/runtime/downloads.ts`
- 流程：构造 `data:` URI → `browser.downloads.download()` → 监听 `onChanged` 等完成
- 写入位置：浏览器 Downloads 文件夹
- 写完后若 native host 可用，自动调用 `relocateFileWithNativeHost()` 移到目标路径

### 3. 本地 Server（可选归档）

- 文件：`apps/server/src/storage.ts` — `writeArchive()`
- 触发：`syncBundleToServer()`，设置 `syncToServer: true` 时生效
- 写入：`fs/promises.writeFile()` 写三个文件 + SQLite upsert 元数据
  - `conversation.md`
  - `bundle.json`
  - `raw-capture.json`（可选）

## 目录结构

```
<export-root>/AIexporter/<platform>/<conversation-folder>/<revision>/
  *.md
  *.bundle.json
  *.assets/
    00-image.jpg
    01-image.png
```

## 旧版本处理

由 `recycleOrArchivePreviousConversation()` 控制，三种模式：

| 模式 | 行为 |
|------|------|
| `disabled` | 直接删除旧版本 |
| `recycle_previous` | 发送到回收站（默认） |
| `archive_then_recycle` | 移到 `AIexporter/Archive/`，超期后清理 |
