# AIexporter 分阶段实施方案

## 概述
- 从零起项目，先做 `Chromium 扩展 + 本地导出`，再补上你要求的 `Ubuntu Docker 后端归档`。
- 自动化边界锁定为：`浏览器在线且已登录官网时自动发现/排队/导出`，浏览器关闭后后端不独立抓取。
- 首个平台锁定为 `ChatGPT`；`Gemini`、`DeepSeek` 复用同一适配器架构按阶段接入。
- 主采集策略锁定为：`DOM 提取为主 + 页面主世界 fetch/XHR 观察为辅`，不把私有 API 直连当主路径。

## 技术选型
- Monorepo：`pnpm workspaces` + `TypeScript` + `Node 22 LTS`。
- 扩展端：`WXT` + `React` + Manifest V3，首发目标 `Edge/Chrome`，后续再出 Firefox 包。
- 后端：`Fastify` + `Zod` + `better-sqlite3`，Docker 部署到 Ubuntu。
- 共享包：统一放 `schema`、`markdown serializer`、`adapter SDK`，保证本地导出和后端落盘产物一致。
- 数据存储：`SQLite` 管索引和幂等，文件系统存 `bundle.json`、`markdown.md`、可选 `raw-capture.json`。

## 目录结构
```text
AIexporter/
  apps/
    extension/        # WXT browser extension
    server/           # Fastify ingest/archive service
  packages/
    core-schema/      # Zod + TS types
    core-markdown/    # canonical markdown serializer
    adapter-sdk/      # platform adapter interfaces + common helpers
    adapters-chatgpt/ # first platform
    adapters-gemini/  # phase 2
    adapters-deepseek/# phase 3
```

## 架构设计
- 扩展包含 5 个部件：`content script`、`main-world bridge script`、`background service worker`、`popup/options UI`、`local queue/storage`。
- `content script` 负责 DOM 观察、注入按钮、抽取当前对话；`main-world bridge` 只做页面内 `fetch/XHR/history` 观察并把事件 `postMessage` 回内容脚本。
- `background service worker` 维护导出队列、去重、重试、下载文件、调用本地后端。
- 后端只做归档与查询，不主动登录任何平台；它接收扩展发来的标准化数据并写入 SQLite + 文件。
- 默认不申请 `webRequest`/`devtools` 这类高权限能力；Manifest 只用 `storage`、`downloads`、`tabs`、`scripting`、`alarms`、目标站点 `host_permissions`。

## 数据流
1. 用户打开 `chatgpt.com`，扩展注入内容脚本和主世界桥接脚本。
2. 桥接脚本观察页面自己的会话列表/详情请求，抽取 `conversationId/title/updatedAt/url` 形成 `DiscoveryEvent`。
3. `background` 用 `(platform, sourceId, revisionFingerprint)` 去重；新会话或更新会进入 `pending queue`。
4. 队列处理器打开或复用一个后台标签页，等待页面稳定后让适配器滚动加载完整对话并抽取标准化 `ConversationBundle`。
5. 共享 `core-markdown` 把 bundle 序列化为规范 Markdown；扩展可本地下载，且可同时 `POST` 到本地后端。
6. 后端做幂等写入；重复 revision 直接返回 `duplicate`，新 revision 落库、写文件、更新 latest 指针。

## 公共接口与类型
```ts
type SourcePlatform = 'chatgpt' | 'gemini' | 'deepseek';

interface DiscoveryEvent {
  platform: SourcePlatform;
  sourceId: string;
  url: string;
  title?: string;
  sourceUpdatedAt?: string;
  revisionFingerprint: string;
}

interface ConversationBundle {
  platform: SourcePlatform;
  sourceId: string;
  url: string;
  title?: string;
  extractedAt: string;
  sourceUpdatedAt?: string;
  participants: { id: string; role: 'user' | 'assistant' | 'system'; name: string }[];
  messages: { id: string; role: string; markdown: string; createdAt?: string }[];
  meta?: Record<string, unknown>;
}

interface PlatformAdapter {
  platform: SourcePlatform;
  matches(url: string): boolean;
  observeDiscovery(ctx: AdapterContext): void;
  extractCurrentConversation(ctx: AdapterContext): Promise<ConversationBundle>;
}
```

## Markdown 产物规范
- 每个会话一个目录：`<platform>/<sourceId>/<revision>/`.
- 标准文件：`bundle.json`、`conversation.md`、可选 `raw-capture.json`。
- `conversation.md` 统一 frontmatter：
```yaml
---
aiexporter: v1
platform: chatgpt
conversation_id: <sourceId>
title: "<title>"
source_url: <url>
source_updated_at: <iso or empty>
exported_at: <iso>
message_count: <n>
revision: <sha256>
---
```

## 后端 API
- `POST /api/v1/ingest/conversations`
  - 请求：`{ bundle, rawCapture?, client: { extensionVersion, browser } }`
  - 响应：`{ status: 'created'|'updated'|'duplicate', conversationKey, revision, files }`
- `GET /api/v1/conversations?platform=&q=&limit=&cursor=`
  - 返回归档索引，给后续 Web UI 或 CLI 用。
- `GET /api/v1/conversations/:platform/:sourceId`
  - 返回最新 revision 元数据和文件路径。
- `GET /healthz`
  - 健康检查。
- 默认监听 `127.0.0.1:8787`；`0.0.0.0` 只作为显式可配置项，不默认开启。

## 里程碑
1. `M0 基础骨架`
   - 初始化 Git、workspace、lint/test/typecheck、共享 schema、markdown serializer、fixture 测试框架。
2. `M1 ChatGPT 手动导出`
   - 当前会话页按钮、一键本地导出 `.md`、基础 DOM 抽取、代码块/表格/数学公式保真。
3. `M2 ChatGPT 自动发现与批量导出`
   - DiscoveryEvent、revision fingerprint、pending queue、批量导出、失败重试、popup 队列面板。
4. `M3 本地后端与 Docker`
   - Fastify ingest、SQLite 索引、文件归档、Dockerfile、docker-compose、扩展端后端同步开关。
5. `M4 Gemini 适配器`
   - 复用同一 adapter SDK，优先验证 DOM->Markdown 质量和自动发现兼容性。
6. `M5 DeepSeek 适配器`
   - 接入会话发现与导出，补长对话、LaTeX、代码块、特殊引用格式处理。
7. `M6 开源化整理`
   - README、架构图、贡献指南、fixture 录制流程、隐私说明、浏览器商店打包脚本。

## 测试与验收
- 单元测试：Markdown serializer、revision fingerprint、幂等 ingest、队列状态机。
- 适配器 fixture 测试：保存真实页面 HTML/已脱敏响应 JSON，验证消息顺序、代码块、表格、公式。
- 后端 API 测试：重复上传同一 revision 返回 `duplicate`；更新 revision 正确落新目录。
- 扩展集成测试：桥接脚本事件到 background 队列的消息流；离线后端时任务保留并可重试。
- 手工验收 1：在 Edge 中打开 ChatGPT，新回复完成后自动把当前会话加入待导出队列。
- 手工验收 2：点击“导出待处理”后，本地生成规范 `.md`，再次运行不会重复导出同一 revision。
- 手工验收 3：启动 Ubuntu Docker 后端后，同一会话既能本地下载，也能写入服务器归档。
- 手工验收 4：浏览器关闭后不再继续抓取；重新打开并登录后能继续增量同步。

## 关键默认值与假设
- 第一版只保证 `浏览器在线自动`，不实现“后端离线独立抓取”。
- 第一版部署模型是 `localhost / 局域网无认证`，但后端代码要预留 `AuthProvider` 接口，未来可加 token。
- 首发只保证 `Edge/Chrome`；Firefox、Safari 不进首个正式里程碑。
- 统一用 `ConversationBundle` 作为唯一标准中间格式，所有平台都先归一化再导出 Markdown。
- 私有接口观察仅作为“发现更新的辅助手段”；真正导出时仍以页面可见内容抽取为准，减少站点变更风险。
- `deep-share` 只参考思路，不直接复用实现，因为其 README 标注 `CC BY-NC 4.0`；`ai-chat-exporter`、`ctxport`、`chatgpt-exporter` 可参考其 MIT/Apache 风格架构与实现方式。

## 参考依据
- Chrome content scripts isolated world: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome manifest content scripts / `MAIN` world: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- Chrome `chrome.scripting`: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome `chrome.webRequest` in MV3: https://developer.chrome.com/docs/extensions/reference/api/webRequest
- Edge Chromium extension compatibility: https://learn.microsoft.com/en-us/microsoft-edge/extensions/
- WXT: https://wxt.dev/
- `ai-chat-exporter`: https://github.com/amazingpaddy/ai-chat-exporter
- `chatgpt-exporter`: https://github.com/FdezRomero/chatgpt-exporter
- `ctxport`: https://github.com/nicepkg/ctxport
- `deep-share`: https://github.com/Yorick-Ryu/deep-share
