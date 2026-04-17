# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

A browser extension that automatically exports your AI conversations (ChatGPT, DeepSeek, Gemini, AI Studio) into clean, portable Markdown archives.

Built as a pnpm monorepo with a WXT-based Chromium extension, background queue orchestration, and an optional local Fastify archive server.

## What it does

- Discovers conversations from supported AI platforms via page-level network interception and DOM observation
- Queues and exports them in the background with worker-tab scheduling
- Writes normalized Markdown + JSON bundles to a configurable local directory
- Optionally syncs bundles to a local Fastify + SQLite archive service
- Provides a dashboard UI for queue monitoring, settings, and file actions

## Supported platforms

| Platform | Discovery | Export | Thinking blocks | Attachments |
| --- | --- | --- | --- | --- |
| ChatGPT | Network interception | Full conversation | Yes | — |
| DeepSeek | Network + history sweep | Full conversation | Yes | — |
| Gemini | DOM + RPC response parsing | Full conversation | Yes | Images, links |
| AI Studio | DOM + library page sweep | Full conversation | Yes | — |

## Workspace layout

```
apps/
  extension/        WXT Chromium extension (content scripts, background, dashboard)
  server/           Fastify + SQLite archive API
packages/
  adapter-sdk/      Shared runtime contracts, defaults, fingerprinting
  adapters-chatgpt/ ChatGPT extraction and discovery
  adapters-deepseek/DeepSeek extraction and discovery
  adapters-gemini/  Gemini + AI Studio extraction, RPC parsing, discovery
  core-markdown/    Markdown serializer with frontmatter and format variants
  core-schema/      Shared types, bundle schema, title/URL normalization
```

## Quick start

Requires Node.js 22+, pnpm 10+. Windows recommended for native-host features.

```bash
corepack pnpm install        # install dependencies
corepack pnpm typecheck      # type-check all workspaces
corepack pnpm test           # run all Vitest suites
corepack pnpm build          # build everything
```

### Run the extension

```bash
corepack pnpm dev:ext        # WXT dev mode with hot reload
```

Load the unpacked extension from `apps/extension/.output/chrome-mv3` in your Chromium browser.

### Run the archive server (optional)

```bash
corepack pnpm dev:server     # http://127.0.0.1:8787
```

## How it works

1. Content scripts detect supported conversation pages
2. Main-world bridges intercept network responses for discovery signals
3. Background service worker deduplicates events into a platform-specific queue
4. Worker tabs load conversations and extract structured data via content scripts
5. Bundles are serialized to Markdown (with YAML frontmatter) and JSON
6. Artifacts are written to the configured export directory via native host or Downloads API
7. If server sync is enabled, bundles are also POSTed to the Fastify service

### Background architecture

The background runtime is split into focused modules:

- `service-runtime.ts` — queue orchestration, worker scheduling, platform ticks, challenge detection
- `runtime-router.ts` — message routing between background, content scripts, and dashboard
- `tab-runtime.ts` — worker-tab lifecycle, content-script readiness
- `artifact-persistence.ts` — file writes, pruning, export-root resolution
- `artifact-sync.ts` — artifact verification and re-import from disk
- `state-access.ts` — queue-state normalization and derived updates
- `export-root.ts` — configurable export directory support

## Archive format

Exports follow a consistent directory structure:

```
<export-root>/AIexporter/<platform>/<conversation-folder>/<revision>/
  <artifact>.md
  <artifact>.bundle.json
```

Markdown frontmatter example:

```yaml
---
aiexporter: 2026-04-15.2
platform: gemini
conversation_id: abc123
title: Building a REST API
source_url: https://gemini.google.com/app/abc123
source_updated_at: 2026-04-10T12:00:00.000Z
exported_at: 2026-04-10T12:01:30.000Z
message_count: 24
revision: f7a...
---
```

## Native host (Windows)

The optional native host (`apps/extension/native-host/`) enables:

- Custom export directory selection via folder picker dialog
- Open exported files with system default handler
- Reveal export folder in Explorer
- Move files to Recycle Bin
- Resolve OneDrive-redirected Downloads paths

Register with:

```powershell
pwsh -File apps/extension/scripts/register-native-host.ps1
```

Falls back to browser Downloads API when unavailable.

## Server API

The Fastify archive service provides:

| Endpoint | Description |
| --- | --- |
| `POST /api/v1/ingest/conversations` | Ingest a conversation bundle |
| `GET /api/v1/conversations` | List/search conversations |
| `GET /api/v1/conversations/:platform/:sourceId` | Get a specific conversation |
| `GET /healthz` | Health check |

## Dashboard

The extension dashboard (accessible from the browser toolbar) provides:

- Queue tab — view pending, processing, completed, and failed items per platform
- Logs tab — real-time background debug logs
- Settings tab — configure export root, discovery intervals, platform-specific tuning, locale (en/zh-CN)

## Current limitations

- Google platform discovery depends on what the logged-in UI exposes during DOM sweeps
- Native-host file actions are Windows-only
- Background scheduling requires the browser to be online and authenticated into target AI sites
- No dedicated archive browsing UI yet; the server focuses on ingestion and query

## License

Private.
