# 导出链路总览

## 两条触发路径

```
手动导出（用户点击）
  └─ runtime-router.ts: manual-export-run
       └─ extractConversationWithReceiverRecovery()  ← 直接用当前 Tab
            └─ persistBundle()

自动导出（队列驱动）
  └─ service-runtime.ts: 定时 tick / discovery 事件
       └─ Worker Tab 创建 → 导航到对话 URL
            └─ extract-current-conversation 消息
                 └─ persistBundle()
```

两条路径在 `persistBundle()` 处完全合并，后续逻辑相同。

## 关键差异

| 方面 | 手动 | 自动 |
|------|------|------|
| 来源 Tab | 用户当前 Tab | Background 创建的 Worker Tab |
| Receiver 恢复 | reload + 重试 1 次 | 重试至 `receiverRetryLimit` |
| 导出选项 | 用户可选 preset / markdown 选项 | 全局配置 |
| Export Root | 可单次覆盖 | 使用配置根目录 |
| 队列影响 | 只更新 conversation index | 更新 queue + index |

## 各平台提取方式

| 平台 | 主路径 | 认证 | Fallback |
|------|--------|------|---------|
| ChatGPT | Page-World 拦截 `/backend-api/conversation/{id}` | 隐式 cookie | DOM |
| DeepSeek | Page-World 拦截 `/api/v0/chat/history_messages` | 隐式 cookie | DOM |
| Gemini | Page-World 构造 `hNvQHb` RPC (`batchexecute`) | 隐式 cookie + 页面参数 `bl`/`f.sid` | DOM |
| AI Studio | Content Script 直接调用 `ResolveDriveResource` gRPC-Web | SAPISID cookie → SAPISIDHASH | DOM |

## Discovery 方式

| 平台 | 方式 |
|------|------|
| ChatGPT | 被动（用户导航触发） |
| DeepSeek | 拦截 `/api/v0/chat_session/fetch_page` |
| Gemini | 拦截 `batchexecute?rpcids=MaZiqc` |
| AI Studio | 调用 `ListPrompts` 接口分页 |

## persistBundle 主要步骤

```
1. 标题解析（index → queue item → 首条用户消息）
2. 计算 revision hash → 判断是否跳过（latest_exists）
3. 扫描 markdown 中的图片 / 附件 URL
4. 下载远程图片（若 includeImages 开启）→ 写入 .assets/ 目录
5. 写 .md 和 .bundle.json
6. 旧版本处理（disabled / recycle_previous / archive_then_recycle）
7. 更新 artifact index
```

## 输出目录结构

```
<export-root>/AIexporter/<platform>/<conversation-folder>/<revision>/
  ├── <artifact>.md
  ├── <artifact>.bundle.json
  └── <artifact>.assets/
      ├── 00-image.jpg
      └── ...
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `background/runtime-router.ts` | 消息路由，手动导出入口 |
| `background/service-runtime.ts` | 队列调度，Worker 生命周期 |
| `background/tab-runtime.ts` | Tab 创建，Receiver 就绪检测 |
| `background/artifact-persistence.ts` | bundle 准备，文件写入，版本管理 |
| `platforms/{platform}/content-runtime.ts` | 平台提取编排 |
| `packages/adapters-{platform}/src/adapter.ts` | 平台响应解析 |
