# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

**自动将 AI 对话导出为干净、可移植的 Markdown 档案——本地存储、隐私安全、永久保存。**

一款浏览器扩展，可捕获 ChatGPT、DeepSeek、Gemini 和 Google AI Studio 的对话，并将其写入你指定的目录，格式为结构化的 Markdown + JSON bundle。基于 pnpm monorepo 构建，包含 WXT Chromium 扩展、后台队列编排，以及可选的本地 Fastify 归档服务。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 目录

- [功能概览](#功能概览)
- [平台支持](#平台支持)
- [仓库结构](#仓库结构)
- [快速开始](#快速开始)
- [安装与配置](#安装与配置)
  - [环境要求](#环境要求)
  - [从源码构建](#从源码构建)
  - [加载扩展](#加载扩展)
  - [注册 Native Host（Windows）](#注册-native-hostwindows)
  - [运行归档服务（可选）](#运行归档服务可选)
  - [Docker 部署](#docker-部署)
- [工作原理](#工作原理)
- [架构详解](#架构详解)
  - [扩展管线](#扩展管线)
  - [Background 模块](#background-模块)
  - [平台适配器](#平台适配器)
- [Archive 格式](#archive-格式)
- [Native Host（Windows）](#native-hostwindows)
- [Server API](#server-api)
- [Dashboard](#dashboard)
- [配置指南](#配置指南)
- [开发指南](#开发指南)
  - [项目脚本](#项目脚本)
  - [测试](#测试)
  - [代码风格](#代码风格)
- [常见问题](#常见问题)
- [限制](#限制)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 功能概览

- **自动发现**：通过网络拦截和 DOM 观察自动检测支持平台上的对话——无需手动操作。
- **后台队列**：调度 worker tab 在后台完成导出，不干扰正常浏览。
- **标准化 Markdown**：每个对话导出为含 YAML frontmatter 的 `.md` 文件，附带 `.bundle.json` 供程序化处理。
- **可配置导出目录**：支持写入任意本地文件夹（需 native host），或使用浏览器 Downloads 文件夹。
- **可选本地归档服务**：同步 bundle 到自托管的 Fastify + SQLite 服务，支持搜索查询。
- **Dashboard UI**：内置 React 面板，用于队列监控、日志查看和设置管理。

## 平台支持

| 平台      | 发现方式                       | 导出     | 思考过程 | 附件        |
| --------- | ------------------------------ | -------- | -------- | ----------- |
| ChatGPT   | 网络拦截                       | 完整对话 | 支持     | —           |
| DeepSeek  | 网络 + 历史侧边栏              | 完整对话 | 支持     | 文件元数据  |
| Gemini    | RPC 响应解析 + DOM             | 完整对话 | 支持     | 图片、链接  |
| AI Studio | Library 页 sweep + gRPC-Web    | 完整对话 | 支持     | Drive 链接  |

## 仓库结构

```
AIexporter/
├── apps/
│   ├── extension/          WXT Chromium 扩展
│   │   ├── entrypoints/    内容脚本、主世界桥接、后台入口
│   │   ├── src/            后台运行时、Dashboard UI、运行时工具
│   │   ├── native-host/    Windows 原生消息主机
│   │   ├── scripts/        注册与验证脚本
│   │   └── wxt.config.ts   WXT 配置
│   └── server/             Fastify + SQLite 归档服务
│       └── src/
│           ├── index.ts    服务入口
│           ├── app.ts      Fastify 应用配置
│           ├── db.ts       SQLite 数据库层
│           └── routes/     API 路由处理器
├── packages/
│   ├── adapter-sdk/        共享类型、默认配置、指纹计算、工具函数
│   ├── adapters-chatgpt/   ChatGPT 适配器（发现 + 提取）
│   ├── adapters-deepseek/  DeepSeek 适配器（发现 + 提取）
│   ├── adapters-gemini/    Gemini & AI Studio 适配器（RPC 解析）
│   ├── core-markdown/      Markdown 序列化器（含 frontmatter）
│   └── core-schema/        Zod schema、bundle 类型、标题/URL 规范化
├── docs/                   参考文档
├── docker-compose.yml      Docker 部署配置
└── package.json            根工作区配置
```

## 快速开始

```bash
# 1. 安装依赖
corepack pnpm install

# 2. 全工作区类型检查
corepack pnpm typecheck

# 3. 运行测试
corepack pnpm test

# 4. 构建全部
corepack pnpm build

# 5. 启动扩展（开发模式）
corepack pnpm dev:ext

# 6. （可选）启动归档服务
corepack pnpm dev:server
```

## 安装与配置

### 环境要求

| 需求       | 版本        | 说明                                      |
| ---------- | ----------- | ----------------------------------------- |
| Node.js    | >= 22.0.0   | ESM 及现代 API 所需                       |
| pnpm       | >= 10.0.0   | 通过 Corepack 管理（`corepack enable`）   |
| 浏览器     | Chromium    | Edge、Chrome、Brave 等                    |
| 操作系统   | Windows     | 推荐；native host 仅支持 Windows          |

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/<your-username>/aiexporter.git
cd aiexporter

# 启用 Corepack（如未启用）
corepack enable

# 安装依赖
corepack pnpm install

# 构建全部
corepack pnpm build
```

### 加载扩展

1. 打开 Chromium 浏览器，访问 `chrome://extensions`（或 `edge://extensions`）。
2. 开启右上角的 **开发者模式**。
3. 点击 **加载解压缩的扩展**，选择 `apps/extension/.output/chrome-mv3` 目录。
4. AIexporter 图标应出现在浏览器工具栏中。

> **提示**：开发时使用 `corepack pnpm dev:ext` 开启热重载，修改源文件后扩展会自动重新构建。

### 注册 Native Host（Windows）

Native host 支持直接文件系统操作——自定义导出目录、打开/定位/回收文件、解析 OneDrive 路径。

```powershell
# 注册 native host（将 <your-extension-id> 替换为 chrome://extensions 中的实际 ID）
pwsh -File apps/extension/scripts/register-native-host.ps1 -ExtensionId "<your-extension-id>"
```

未注册 native host 时，扩展自动退化到浏览器 Downloads API。

### 运行归档服务（可选）

归档服务提供对已导出对话的搜索和查询能力。

```bash
# 开发模式（热重载）
corepack pnpm dev:server
# → http://127.0.0.1:8787

# 生产构建并运行
corepack pnpm --filter @aiexporter/server build
node apps/server/dist/index.js
```

**环境变量：**

| 变量                  | 默认值          | 说明                |
| --------------------- | --------------- | ------------------- |
| `AIEXPORTER_HOST`     | `127.0.0.1`     | 服务绑定地址        |
| `AIEXPORTER_PORT`     | `8787`          | 服务端口            |
| `AIEXPORTER_DATA_DIR` | `./data`        | SQLite 及归档目录   |

### Docker 部署

```bash
docker compose up -d
# 服务运行于 http://127.0.0.1:8787
```

`data/` 目录作为卷挂载以持久化数据。

## 工作原理

```
┌─────────────────────────────────────────────────────────┐
│                     AI 平台页面                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 内容脚本      │  │ 主世界桥接    │  │ 页面网络拦截   │  │
│  │ (DOM 观察)   │  │ (网络拦截)   │  │ (请求捕获)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
└─────────┼─────────────────┼───────────────────┼──────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│              后台 Service Worker                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ 发现事件  │──▶ 队列去重 │──▶  Worker Tab 调度器   │  │
│  └──────────┘  └──────────┘  └───────────┬───────────┘  │
│                                          │              │
│  ┌───────────────────────────────────────┘              │
│  │  ┌──────────────┐  ┌──────────────┐                 │
│  │  │ 内容提取     │──▶ 持久化       │                 │
│  │  │ (通过内容    │  │ (Markdown +   │                 │
│  │  │  脚本)       │  │  JSON bundle) │                 │
│  │  └──────────────┘  └──────┬───────┘                 │
│  │                           │                          │
└──┼───────────────────────────┼──────────────────────────┘
   │                           │
   ▼                           ▼
┌──────────────────┐   ┌──────────────────┐
│  导出目录         │   │  归档服务         │
│  (本地磁盘)      │   │  (Fastify+SQLite)│
└──────────────────┘   └──────────────────┘
```

### 管线步骤

1. **检测**：内容脚本观察支持的对话页面。
2. **发现**：主世界桥接脚本拦截网络响应，发现对话 ID 和元数据。
3. **队列**：后台 service worker 将发现事件去重后写入各平台队列。
4. **提取**：Worker tab 加载对话，内容脚本提取结构化数据（消息、思考块、附件）。
5. **序列化**：Bundle 序列化为 Markdown（含 YAML frontmatter）和 JSON。
6. **持久化**：产物通过 native host 或 Downloads API 写入配置的导出目录。
7. **同步**（可选）：Bundle POST 到本地 Fastify 归档服务。

## 架构详解

### 扩展管线

扩展基于 WXT（Web eXtension Toolkit）和 Manifest V3 构建：

- **内容脚本**（`entrypoints/*.content.ts`）：在各 AI 平台的页面上下文中运行，观察 DOM 并响应后台的提取请求。
- **主世界桥接**（`entrypoints/*-main-world.ts`）：注入页面的主 JavaScript 世界，拦截网络请求并访问页面内状态。
- **后台 Service Worker**（`entrypoints/background.ts`）：中央编排器，管理队列、调度 worker tab、协调持久化。

### Background 模块

| 模块                          | 职责                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `runtime-router.ts`           | background、内容脚本、dashboard 间的消息路由               |
| `service-runtime.ts`          | 队列编排、worker 调度、平台 tick、challenge 检测           |
| `tab-runtime.ts`              | worker tab 生命周期、内容脚本就绪检测                      |
| `artifact-persistence.ts`     | 文件写入、裁剪、导出目录解析、远程资源下载                 |
| `artifact-sync.ts`            | artifact 校验与磁盘重导入                                  |
| `artifact-sync-state.ts`      | 同步状态追踪                                              |
| `automatic-artifact-sync.ts`  | 浏览器启动时自动后台同步                                   |
| `state-access.ts`             | 队列状态归一化与派生更新                                   |
| `export-root.ts`              | 可配置导出目录支持                                        |
| `shared.ts`                   | 共享常量与归档命名                                        |

### 平台适配器

各支持平台包含：

- **适配器包**（`packages/adapters-*/`）：发现、DOM 提取、turndown 配置。
- **内容脚本**（`entrypoints/*.content.ts`）：注入平台页面。
- **主世界桥接**（`entrypoints/*-main-world.ts`）：网络拦截和 RPC 调用。

| 平台      | 发现方式                                   | 提取方式                                    |
| --------- | ------------------------------------------ | ------------------------------------------- |
| ChatGPT   | 拦截 `/backend-api/conversation/{id}`      | Page-world API 响应解析                     |
| DeepSeek  | 拦截 `/api/v0/chat_session/fetch_page`     | Page-world 历史消息 API                     |
| Gemini    | 拦截 `batchexecute` RPC                    | RPC payload 递归遍历 + DOM 回退             |
| AI Studio | Library 页 `ListPrompts` + DOM sweep       | gRPC-Web `ResolveDriveResource` + DOM       |

## Archive 格式

导出遵循统一、易读的目录结构：

```
<导出根目录>/
└── AIexporter/
    └── <platform>/               # chatgpt、deepseek、gemini、aistudio
        └── <对话文件夹>/           # 标题 + source ID 后缀
            └── <revision>/        # 内容哈希（前 12 位十六进制）
                ├── <artifact>.md           # 含 YAML frontmatter 的 Markdown
                ├── <artifact>.bundle.json  # 完整结构化数据
                └── <artifact>.assets/      # 下载的图片与附件
                    ├── 00-image.jpg
                    └── ...
```

**Markdown frontmatter 示例：**

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
revision: f7a3b2c1d4e5
---
```

`.bundle.json` 包含完整的结构化数据——所有消息、思考块、附件和元数据，适合程序化处理。

## Native Host（Windows）

可选的 Windows 原生消息主机（`apps/extension/native-host/`）通过 stdin/stdout JSON 消息与扩展通信，提供：

| 能力                      | 说明                                            |
| ------------------------- | ----------------------------------------------- |
| **自定义导出目录**        | 通过原生文件夹选择对话框指定任意本地文件夹       |
| **打开文件**              | 用系统默认程序打开 `.md` 文件                   |
| **在资源管理器中定位**    | 在文件资源管理器中打开导出目录                   |
| **移至回收站**            | 软删除导出文件                                   |
| **OneDrive 路径解析**     | 解析 OneDrive 重定向的 Downloads 路径           |

**注册方式：**

```powershell
pwsh -File apps/extension/scripts/register-native-host.ps1 -ExtensionId "<your-extension-id>"
```

不可用时自动退化到浏览器 Downloads API。

## Server API

Fastify 归档服务提供 RESTful API，用于导入和查询已导出对话。

| 方法   | 端点                                            | 说明            |
| ------ | ----------------------------------------------- | --------------- |
| `POST` | `/api/v1/ingest/conversations`                  | 导入对话 bundle |
| `GET`  | `/api/v1/conversations`                         | 列表/搜索对话   |
| `GET`  | `/api/v1/conversations/:platform/:sourceId`     | 获取指定对话    |
| `GET`  | `/healthz`                                      | 健康检查        |

**`GET /api/v1/conversations` 查询参数：**

| 参数       | 类型   | 说明                                      |
| ---------- | ------ | ----------------------------------------- |
| `platform` | string | 按平台筛选（`chatgpt`、`gemini` 等）      |
| `q`        | string | 全文搜索（标题 + source ID）              |
| `cursor`   | string | 分页游标                                  |
| `limit`    | number | 每页条数（默认 50）                       |

## Dashboard

内置 React Dashboard 可从浏览器工具栏访问，提供三个标签页：

- **队列标签页** — 按平台查看 pending、processing、completed、failed 项目，可暂停/恢复单个平台服务。
- **日志标签页** — 实时后台调试日志，支持筛选和搜索。
- **设置标签页** — 配置导出目录、发现间隔、平台参数、语言（`en` / `zh-CN`）、主题和服务器同步。

## 配置指南

所有设置可通过 Dashboard → 设置标签页访问，存储在扩展存储（`browser.storage.local`）中。

### 导出设置

| 设置                      | 说明                                                    |
| ------------------------- | ------------------------------------------------------- |
| 导出根目录                | 所有导出的自定义目录（需 native host）                  |
| 旧版本处理方式            | 如何处理之前的导出：`disabled`、`recycle_previous`、`archive_then_recycle` |
| 本地保留修订版本数        | 磁盘上保留的旧版本数量                                  |
| 文件操作按钮              | 开启"打开最新 Markdown"和"显示导出目录"按钮            |

### 发现设置（按平台）

| 设置              | 说明                                                |
| ----------------- | --------------------------------------------------- |
| 已启用            | 开启/关闭该平台                                     |
| 自动导出          | 发现新对话后自动导出                                |
| 历史回填          | 扫动对话历史侧边栏/库页面                           |
| 发现模式          | `passive_only`（拦截网络）或主动 DOM sweep          |
| 最大并发数        | 该平台同时运行的最大 worker tab 数                  |

### 服务同步

| 设置          | 说明                                    |
| ------------- | --------------------------------------- |
| 同步到服务    | 将 bundle POST 到本地归档服务           |
| 服务 URL      | 归档服务 URL（锁定为 localhost）        |

## 开发指南

### 项目脚本

| 命令                                                 | 说明                            |
| ---------------------------------------------------- | ------------------------------- |
| `corepack pnpm install`                              | 安装所有工作区依赖              |
| `corepack pnpm build`                                | 构建所有包和应用                |
| `corepack pnpm dev:ext`                              | WXT 开发模式运行扩展（热重载）  |
| `corepack pnpm dev:server`                           | 启动 Fastify 服务（热重载）     |
| `corepack pnpm test`                                 | 运行所有 Vitest 测试套件        |
| `corepack pnpm typecheck`                            | 全工作区类型检查                |
| `corepack pnpm format`                               | Prettier 格式化                 |
| `corepack pnpm --filter <pkg> test`                  | 运行特定包的测试                |
| `corepack pnpm --filter @aiexporter/extension build` | 仅构建扩展                      |

### 测试

- **单元测试**：Vitest，与源码同级放置（`*.test.ts`）或在 `test/` 目录中。
- **浏览器测试**：参见 [`docs/browser-live-testing.md`](docs/browser-live-testing.md) 了解 CDP/Playwright 操作指南。
- **扩展冒烟测试**：`apps/extension/scripts/verify-dashboard-file-actions.cjs` 验证 dashboard 和 native host 集成。

### 代码风格

- 全面 TypeScript ESM
- 2 空格缩进、分号、双引号、尾逗号
- React 组件：`PascalCase` 文件名
- 工具/服务模块：`kebab-case` 文件名、`camelCase` 符号
- 使用 Prettier 格式化；提交前运行 `corepack pnpm format`

## 常见问题

| 现象                                                    | 可能原因                                  | 解决方案                                                      |
| ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| 扩展检测不到对话                                        | 未登录 AI 平台                            | 在浏览器中登录目标平台                                        |
| "Native host 不可用"警告                                | Native host 未注册                        | 运行注册脚本（参见 [Native Host](#native-hostwindows)）       |
| Gemini/AI Studio 发现不完整                             | Google 限流 / reCAPTCHA                   | 降低并发数，暂停其他平台，稍后重试                            |
| 导出 markdown 为空或不完整                              | 提取超时                                  | 在平台设置中增大 `navigationTimeoutMs`                        |
| DeepSeek 发现侧边栏未就绪                               | 侧边栏未打开或页面仍在加载                | 确保 DeepSeek 侧边栏可见；尝试刷新                            |
| Dashboard 白屏                                          | React 渲染时 JavaScript 错误              | 检查浏览器控制台；附带日志报告错误                            |
| 服务连接被拒绝                                          | 服务未运行                                | 运行 `corepack pnpm dev:server`                               |
| 下载中断（SERVER_FAILED / SERVER_BAD_CONTENT）          | 网络问题或远程资源异常                    | 项目将自动重试；检查网络连接                                  |

## 限制

- **Google 平台发现**依赖登录态 UI 在 DOM sweep 期间实际暴露的内容。Gemini 历史侧边栏有已知上限（约 587 条对话）。
- **Native host 仅支持 Windows**。其他平台使用 Downloads API，无法自定义导出目录。
- **后台调度**要求浏览器在线且已登录目标 AI 平台。
- **暂无独立的归档浏览 UI**——服务聚焦于 ingest 和 query。可使用任意 Markdown 编辑器浏览导出文件。
- **DeepSeek 附件文件**以元数据（名称 + 大小）记录，但无法自动下载（需要逐文件签名 URL）。
- **AI Studio Drive 资源**以链接形式存储，需要 Google 账号权限。

## 贡献

详见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，包含开发环境配置、代码风格和 PR 提交指南。

## 许可证

MIT。详见 [LICENSE](LICENSE)。

