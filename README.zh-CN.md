# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

一个浏览器扩展，自动将 AI 对话（ChatGPT、DeepSeek、Gemini、AI Studio）导出为干净、可移植的 Markdown 档案。

基于 pnpm monorepo 构建，包含 WXT Chromium 扩展、后台队列编排，以及可选的本地 Fastify 归档服务。

## 功能概览

- 通过页面级网络拦截和 DOM 观察，自动发现支持平台上的对话
- 后台队列调度 worker tab 完成导出
- 将标准化的 Markdown + JSON bundle 写入可配置的本地目录
- 可选同步到本地 Fastify + SQLite 归档服务
- 提供 Dashboard UI 用于队列监控、设置调整和文件操作

## 平台支持

| 平台 | 发现方式 | 导出 | 思考过程 | 附件 |
| --- | --- | --- | --- | --- |
| ChatGPT | 网络拦截 | 完整对话 | 支持 | — |
| DeepSeek | 网络 + 历史 sweep | 完整对话 | 支持 | — |
| Gemini | DOM + RPC 响应解析 | 完整对话 | 支持 | 图片、链接 |
| AI Studio | DOM + library 页 sweep | 完整对话 | 支持 | — |

## 仓库结构

```
apps/
  extension/        WXT Chromium 扩展（内容脚本、后台、Dashboard）
  server/           Fastify + SQLite 归档 API
packages/
  adapter-sdk/      共享 runtime 协议、默认配置、指纹计算
  adapters-chatgpt/ ChatGPT 提取与发现
  adapters-deepseek/DeepSeek 提取与发现
  adapters-gemini/  Gemini + AI Studio 提取、RPC 解析、发现
  core-markdown/    Markdown 序列化器（frontmatter、多格式变体）
  core-schema/      共享类型、bundle schema、标题/URL 规范化
```

## 快速开始

需要 Node.js 22+、pnpm 10+。Windows 环境可使用 native-host 增强功能。

```bash
corepack pnpm install        # 安装依赖
corepack pnpm typecheck      # 全工作区类型检查
corepack pnpm test           # 运行所有 Vitest 测试
corepack pnpm build          # 构建全部
```

### 启动扩展

```bash
corepack pnpm dev:ext        # WXT 开发模式，支持热重载
```

从 `apps/extension/.output/chrome-mv3` 加载解压扩展到 Chromium 浏览器。

### 启动归档服务（可选）

```bash
corepack pnpm dev:server     # http://127.0.0.1:8787
```

## 工作原理

1. 内容脚本检测支持的对话页面
2. 主世界桥接脚本拦截网络响应获取发现信号
3. Background service worker 将事件去重后写入平台队列
4. Worker tab 加载对话并通过内容脚本提取结构化数据
5. Bundle 序列化为 Markdown（含 YAML frontmatter）和 JSON
6. 产物通过 native host 或 Downloads API 写入配置的导出目录
7. 如开启 server sync，bundle 同时 POST 到 Fastify 服务

### Background 架构

后台运行时拆分为职责明确的模块：

- `service-runtime.ts` — 队列编排、worker 调度、平台 tick、challenge 检测
- `runtime-router.ts` — background、内容脚本、dashboard 间的消息路由
- `tab-runtime.ts` — worker tab 生命周期、内容脚本就绪检测
- `artifact-persistence.ts` — 文件写入、裁剪、导出目录解析
- `artifact-sync.ts` — artifact 校验与磁盘重导入
- `state-access.ts` — 队列状态归一化与派生更新
- `export-root.ts` — 可配置导出目录支持

## Archive 格式

导出遵循统一的目录结构：

```
<导出根目录>/AIexporter/<platform>/<conversation-folder>/<revision>/
  <artifact>.md
  <artifact>.bundle.json
```

Markdown frontmatter 示例：

```yaml
---
aiexporter: 2026-04-15.2
platform: gemini
conversation_id: abc123
title: 构建 REST API
source_url: https://gemini.google.com/app/abc123
source_updated_at: 2026-04-10T12:00:00.000Z
exported_at: 2026-04-10T12:01:30.000Z
message_count: 24
revision: f7a...
---
```

## Native Host（Windows）

可选的 native host（`apps/extension/native-host/`）提供：

- 通过文件夹选择对话框自定义导出目录
- 用系统默认程序打开导出文件
- 在资源管理器中定位导出目录
- 将文件移至回收站
- 解析 OneDrive 重定向的 Downloads 路径

注册方式：

```powershell
pwsh -File apps/extension/scripts/register-native-host.ps1
```

不可用时自动退化到浏览器 Downloads API。

## Server API

Fastify 归档服务提供：

| 端点 | 说明 |
| --- | --- |
| `POST /api/v1/ingest/conversations` | 导入对话 bundle |
| `GET /api/v1/conversations` | 列表/搜索对话 |
| `GET /api/v1/conversations/:platform/:sourceId` | 获取指定对话 |
| `GET /healthz` | 健康检查 |

## Dashboard

扩展 Dashboard（从浏览器工具栏访问）提供：

- 队列标签页 — 按平台查看 pending、processing、completed、failed 项目
- 日志标签页 — 实时后台调试日志
- 设置标签页 — 配置导出目录、发现间隔、平台参数、语言（en/zh-CN）

## 当前限制

- Google 系平台发现依赖登录态 UI 在 DOM sweep 期间实际暴露的内容
- Native-host 文件操作仅支持 Windows
- 后台调度要求浏览器在线且已登录目标 AI 站点
- 暂无独立的归档浏览 UI，server 侧聚焦于 ingest 与 query

## License

Private.
