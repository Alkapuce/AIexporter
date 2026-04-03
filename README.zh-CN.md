# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

AIexporter 是一个基于 pnpm workspaces 的 monorepo，用于把浏览器中的 AI 对话导出为规范化 Markdown 档案，并可选同步到本地归档服务。

当前仓库以 Windows-first 的开发与验证流程为主，包含：

- 基于 WXT 的 Chromium 扩展
- 带队列与 worker 调度的后台导出编排
- 通过 Downloads API 落地本地 Markdown 与 bundle
- 通过 Windows native host 实现“打开文件 / 定位目录”增强动作
- 基于 Fastify + SQLite 的本地归档服务

## 当前状态

| 模块 | 状态 |
| --- | --- |
| ChatGPT 扩展流程 | 已实现 |
| DeepSeek 扩展流程 | 已实现，包含专门的发现与 worker 逻辑 |
| Gemini 扩展流程 | 已接入，采用保守的 DOM-first 发现与导出 |
| AI Studio 扩展流程 | 已接入，支持 DOM-first 发现、导出与运行配置元数据 |
| Dashboard / Popup 控制界面 | 已实现多平台控制与队列可视化 |
| 本地 Markdown 导出 | 已实现 |
| 本地 artifact 索引 | 已实现 |
| Native host 文件动作 | 已实现，带浏览器 fallback |
| Fastify 归档服务 | 已实现 |
| 浏览器归档查看器 | 未实现 |

## 仓库结构

```text
apps/
  extension/   WXT Chromium 扩展
  server/      Fastify 归档与查询服务
packages/
  adapter-sdk/         共享 runtime 协议与默认配置
  adapters-chatgpt/    ChatGPT 提取辅助
  adapters-deepseek/   DeepSeek 提取与发现辅助
  adapters-gemini/     Gemini 与 AI Studio 提取 / 发现辅助
  core-markdown/       统一 Markdown 序列化器
  core-schema/         共享 schema 与 bundle 类型
docs/
  browser-live-testing.md  Edge/CDP/Playwright 实测说明
  PLAN.md              初始阶段方案文档
  refactor-roadmap.md  当前重构结果与下一步优先级
```

## 核心架构

### 扩展侧数据流

1. 内容脚本进入受支持的对话页面。
2. 页面主世界桥接脚本在可用时收集网络层发现信号。
3. background service worker 把发现事件去重并写入导出队列。
4. 平台 worker tab 加载目标对话，并向内容脚本请求完整提取。
5. 扩展将标准化 bundle 序列化为 Markdown 与 JSON。
6. 产物通过浏览器 Downloads API 持久化到本地。
7. 如果开启 server sync，同一份 bundle 会继续投递到本地 Fastify 服务。

### 本轮重构后的 background 分层

background 运行时不再由一个超大入口文件承载所有逻辑。

- `apps/extension/entrypoints/background.ts` 只负责 bootstrap 和浏览器事件接线。
- `apps/extension/src/background/runtime-router.ts` 负责 runtime message 路由。
- `apps/extension/src/background/service-runtime.ts` 负责队列编排、worker 调度与平台 tick。
- `apps/extension/src/background/tab-runtime.ts` 负责内容脚本通信与 worker tab 就绪检测。
- `apps/extension/src/background/artifact-persistence.ts` 负责 artifact 写入、裁剪与 native-host 文件动作。
- `apps/extension/src/background/state-access.ts` 负责 queue state 归一化与派生状态更新。
- `apps/extension/src/background/shared.ts` 负责共享常量与归档命名辅助函数。

当前结构债和下一轮目标见 `docs/refactor-roadmap.md`。

## 平台支持面

### ChatGPT

- 当前对话提取
- 队列驱动导出
- 本地持久化
- 可选 server sync

### DeepSeek

- 页面活动驱动的被动发现
- 历史会话 sweep 支持
- 专门的 worker tab 生命周期处理
- 本地持久化
- 可选 server sync

### Gemini

- 当前对话提取
- 带懒加载处理的 DOM 历史发现
- worker 驱动导出与本地持久化
- 面向 Google 站点的保守节流策略

### AI Studio

- 当前 prompt/chat 提取
- 基于 `/library` 页的历史发现
- 运行配置元数据提取
- worker 驱动导出与本地持久化

## 环境要求

当前工作区已验证环境：

- Node.js 22+
- pnpm 10+
- Windows 下的 PowerShell 7

扩展目标浏览器是 Chromium 系。当前 native-host 增强动作仅针对 Windows。

## 快速开始

### 1. 安装依赖

```powershell
corepack pnpm install
```

### 2. 跑通已验证检查

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

这些命令是当前仓库的基线，在发布或归档前应保持全绿。

### 3. 启动本地归档服务

```powershell
corepack pnpm dev:server
```

默认地址：`http://127.0.0.1:8787`

### 4. 构建或启动扩展

开发模式：

```powershell
corepack pnpm dev:ext
```

单次构建：

```powershell
corepack pnpm --filter @aiexporter/extension build
```

解压扩展目录输出到：

```text
apps/extension/.output/chrome-mv3
```

## Native host 集成

Windows native-host 相关文件位于 `apps/extension/native-host/`。

它主要服务 dashboard 里的两个动作：

- 用系统默认方式打开最新导出的 Markdown
- 在资源管理器中定位导出目录或文件

如果 native host 不可用，扩展会尽量退化到浏览器下载动作。

相关实现文件：

- `apps/extension/native-host/host.cjs`
- `apps/extension/native-host/manifest.json`
- `apps/extension/scripts/register-native-host.ps1`
- `apps/extension/src/runtime/native-host.ts`

当前 native host 会优先解析 Windows 的 Downloads 已知文件夹，因此 OneDrive 重定向后的 Downloads 路径也会被正确使用。

## Archive 格式

本地和服务端归档共用统一布局：

```text
AIexporter/<platform>/<conversation-folder>/<revision>/
  <artifact>.md
  <artifact>.bundle.json
```

Markdown 文件包含类似如下的 frontmatter：

```yaml
---
aiexporter: v1
platform: deepseek
conversation_id: conv-123
title: Planning Session
source_url: https://chat.deepseek.com/a/chat/s/conv-123
source_updated_at: 2026-03-18T08:00:00.000Z
exported_at: 2026-03-18T08:01:10.000Z
message_count: 12
revision: 4c7...
---
```

扩展本地还会维护以下索引：

- 已发现会话索引
- 导出队列状态
- 本地 artifact 索引
- debug 日志

## Server API

当前 Fastify 服务暴露：

- `POST /api/v1/ingest/conversations`
- `GET /api/v1/conversations?platform=&q=&limit=&cursor=`
- `GET /api/v1/conversations/:platform/:sourceId`
- `GET /healthz`

服务端源码位于 `apps/server/src/`。

## 验证流程

### 自动检查

当前仓库开发过程中使用以下已验证命令：

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

### 浏览器级验证

这个项目不能只靠 build 成功就算完成。

验证扩展改动时，应该优先做真实浏览器级检查，确认：

- background worker 能正常初始化
- dashboard 能读取 queue 和 debug state
- 在支持站点上手动导出仍然可用
- 文件动作按钮仍然能打到 native-host 或浏览器 fallback

现有浏览器验证辅助脚本位于：

- `apps/extension/scripts/verify-dashboard-file-actions.cjs`
- `docs/browser-live-testing.md`

它依赖一个兼容的 Chromium 调试会话，以及已经加载好的扩展构建产物。

## 当前限制

- Google 系站点仍采用保守的 DOM-first 发现，所以历史完整性仍取决于登录态页面在 sweep 期间实际暴露和懒加载出来的内容。
- Native-host 增强文件动作仅支持 Windows。
- background 调度与手动验证默认都要求浏览器在线，且用户已经登录目标 AI 站点。
- 当前还没有独立的归档浏览 Web UI；server 主要负责 ingest 与 query。

## 下一步路线

本轮之后的短期优先级：

- 继续拆 `apps/extension/entrypoints/deepseek.content.ts`
- 继续拆 `apps/extension/src/ui/dashboard/DashboardApp.tsx`
- 补更完整的 release / contribution 文档
- 增加一个不依赖个人 Edge profile 的浏览器 smoke flow

历史阶段方案保留在 `docs/PLAN.md`。
当前重构记录保留在 `docs/refactor-roadmap.md`。

## 发布与归档策略

当前仓库已按“干净初始版本”思路整理：

- 保持 `typecheck`、`test`、`build` 全绿
- 不把本地临时调试脚本纳入版本控制
- 用 `v0.1.0` 标记初始基线
- 优先推送到私有 GitHub 仓库

这样首次历史就围绕“模块化后的扩展 runtime”展开，而不是把一个超大的 background 单文件直接作为初始版本暴露出去。
