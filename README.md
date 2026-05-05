# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

**Automatically export your AI conversations to clean, portable Markdown archives — locally, privately, forever.**

A browser extension that captures conversations from ChatGPT, DeepSeek, Gemini, and Google AI Studio, then writes them as structured Markdown + JSON bundles to a directory you control. Built as a pnpm monorepo with a WXT-based Chromium extension, background queue orchestration, and an optional local Fastify archive server.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Table of Contents

- [What it does](#what-it-does)
- [Supported Platforms](#supported-platforms)
- [Workspace Layout](#workspace-layout)
- [Quick Start](#quick-start)
- [Installation & Setup](#installation--setup)
  - [Prerequisites](#prerequisites)
  - [Build from Source](#build-from-source)
  - [Load the Extension](#load-the-extension)
  - [Register Native Host (Windows)](#register-native-host-windows)
  - [Run the Archive Server (Optional)](#run-the-archive-server-optional)
  - [Docker Deployment](#docker-deployment)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
  - [Extension Pipeline](#extension-pipeline)
  - [Background Modules](#background-modules)
  - [Platform Adapters](#platform-adapters)
- [Archive Format](#archive-format)
- [Native Host (Windows)](#native-host-windows)
- [Server API](#server-api)
- [Dashboard](#dashboard)
- [Configuration Guide](#configuration-guide)
- [Development](#development)
  - [Project Scripts](#project-scripts)
  - [Testing](#testing)
  - [Code Style](#code-style)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

- **Auto-discovery**: Detects conversations on supported platforms via network interception and DOM observation — no manual clicking required.
- **Background queue**: Schedules worker tabs to extract conversations without blocking your browsing.
- **Normalized Markdown**: Every conversation becomes a clean `.md` file with YAML frontmatter, plus a `.bundle.json` for programmatic use.
- **Configurable export directory**: Write to any local folder (with native host) or use the browser Downloads folder.
- **Optional local archive server**: Sync bundles to a self-hosted Fastify + SQLite service for search and query.
- **Dashboard UI**: Monitor queue status, view logs, and manage settings from a built-in React dashboard.

## Supported Platforms

| Platform   | Discovery                     | Export             | Thinking Blocks | Attachments    |
| ---------- | ----------------------------- | ------------------ | --------------- | -------------- |
| ChatGPT    | Network interception          | Full conversation  | Yes             | —              |
| DeepSeek   | Network + history sidebar     | Full conversation  | Yes             | File metadata  |
| Gemini     | RPC response parsing + DOM    | Full conversation  | Yes             | Images, links  |
| AI Studio  | Library page sweep + gRPC-Web | Full conversation  | Yes             | Drive links    |

## Workspace Layout

```
AIexporter/
├── apps/
│   ├── extension/          WXT Chromium extension
│   │   ├── entrypoints/    Content scripts, main-world bridges, background
│   │   ├── src/            Background runtime, dashboard UI, runtime helpers
│   │   ├── native-host/    Windows native messaging host
│   │   ├── scripts/        Registration & verification scripts
│   │   └── wxt.config.ts   WXT configuration
│   └── server/             Fastify + SQLite archive service
│       └── src/
│           ├── index.ts    Server entry point
│           ├── app.ts      Fastify app setup
│           ├── db.ts       SQLite database layer
│           └── routes/     API route handlers
├── packages/
│   ├── adapter-sdk/        Shared types, defaults, fingerprinting, utilities
│   ├── adapters-chatgpt/   ChatGPT adapter (discovery + extraction)
│   ├── adapters-deepseek/  DeepSeek adapter (discovery + extraction)
│   ├── adapters-gemini/    Gemini & AI Studio adapter (RPC parsing)
│   ├── core-markdown/      Markdown serializer with frontmatter
│   └── core-schema/        Zod schemas, bundle types, title/URL normalization
├── docs/                   Reference documentation
├── docker-compose.yml      Docker deployment
└── package.json            Root workspace configuration
```

## Quick Start

```bash
# 1. Install dependencies
corepack pnpm install

# 2. Type-check everything
corepack pnpm typecheck

# 3. Run tests
corepack pnpm test

# 4. Build all packages and apps
corepack pnpm build

# 5. Start the extension in dev mode
corepack pnpm dev:ext

# 6. (Optional) Start the archive server
corepack pnpm dev:server
```

## Installation & Setup

### Prerequisites

| Requirement | Version    | Notes                                    |
| ----------- | ---------- | ---------------------------------------- |
| Node.js     | >= 22.0.0  | Required for ESM and modern APIs         |
| pnpm        | >= 10.0.0  | Managed via Corepack (`corepack enable`) |
| Browser     | Chromium   | Edge, Chrome, Brave, etc.               |
| OS          | Windows    | Recommended; native host is Windows-only |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Alkapuce/AIexporter.git
cd aiexporter

# Enable Corepack (if not already)
corepack enable

# Install dependencies
corepack pnpm install

# Build everything
corepack pnpm build
```

### Load the Extension

1. Open your Chromium browser and navigate to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `apps/extension/.output/chrome-mv3` directory.
4. The AIexporter icon should appear in your toolbar.

> **Tip**: For development, use `corepack pnpm dev:ext` to enable hot-reload. The extension rebuilds automatically when you edit source files.

### Register Native Host (Windows)

The native host enables direct filesystem operations — custom export directory, open/reveal/recycle files, and OneDrive Downloads path resolution.

```powershell
# Register the native host (replace <your-extension-id> with the actual ID from chrome://extensions)
pwsh -File apps/extension/scripts/register-native-host.ps1 -ExtensionId "<your-extension-id>"
```

Without the native host, the extension falls back to the browser Downloads API.

### Run the Archive Server (Optional)

The server provides a searchable, queryable archive of all exported conversations.

```bash
# Development mode (with hot reload)
corepack pnpm dev:server
# → http://127.0.0.1:8787

# Production build & run
corepack pnpm --filter @aiexporter/server build
node apps/server/dist/index.js
```

**Environment variables:**

| Variable              | Default        | Description                |
| --------------------- | -------------- | -------------------------- |
| `AIEXPORTER_HOST`     | `127.0.0.1`    | Server bind address        |
| `AIEXPORTER_PORT`     | `8787`         | Server port                |
| `AIEXPORTER_DATA_DIR` | `./data`       | SQLite & archive directory |

### Docker Deployment

```bash
docker compose up -d
# Server available at http://127.0.0.1:8787
```

The `data/` directory is mounted as a volume for persistence.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    AI Platform Page                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Content Script│  │ Main-World   │  │ Page Network  │  │
│  │ (DOM observe) │  │ Bridge       │  │ Interception  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
└─────────┼─────────────────┼───────────────────┼──────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│              Background Service Worker                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ Discovery│──▶  Queue   │──▶  Worker Tab Scheduler │  │
│  │ Events   │  │ Dedup    │  │                       │  │
│  └──────────┘  └──────────┘  └───────────┬───────────┘  │
│                                          │              │
│  ┌───────────────────────────────────────┘              │
│  │  ┌──────────────┐  ┌──────────────┐                 │
│  │  │ Extraction   │──▶ Persistence  │                 │
│  │  │ (via content │  │ (Markdown +   │                 │
│  │  │  script)     │  │  JSON bundle) │                 │
│  │  └──────────────┘  └──────┬───────┘                 │
│  │                           │                          │
└──┼───────────────────────────┼──────────────────────────┘
   │                           │
   ▼                           ▼
┌──────────────────┐   ┌──────────────────┐
│  Export Directory │   │  Archive Server   │
│  (local disk)    │   │  (Fastify+SQLite) │
└──────────────────┘   └──────────────────┘
```

### Pipeline Steps

1. **Detection**: Content scripts observe supported conversation pages.
2. **Discovery**: Main-world bridges intercept network responses to discover conversation IDs and metadata.
3. **Queue**: The background service worker deduplicates discovery events into a per-platform queue.
4. **Extraction**: Worker tabs load conversations and content scripts extract structured data (messages, thinking blocks, attachments).
5. **Serialization**: Bundles are serialized to Markdown (with YAML frontmatter) and JSON.
6. **Persistence**: Artifacts are written to the configured export directory via native host or Downloads API.
7. **Sync** (optional): Bundles are POSTed to the local Fastify archive service.

## Architecture

### Extension Pipeline

The extension uses WXT (Web eXtension Toolkit) with Manifest V3:

- **Content Scripts** (`entrypoints/*.content.ts`): Run in the page context of each supported AI platform. They observe the DOM and respond to extraction requests from the background.
- **Main-World Bridges** (`entrypoints/*-main-world.ts`): Injected into the page's main JavaScript world to intercept network requests and access in-page state.
- **Background Service Worker** (`entrypoints/background.ts`): Central orchestrator that manages the queue, schedules worker tabs, and coordinates persistence.

### Background Modules

| Module                        | Responsibility                                                   |
| ----------------------------- | ---------------------------------------------------------------- |
| `runtime-router.ts`           | Message routing between background, content scripts, dashboard   |
| `service-runtime.ts`          | Queue orchestration, worker scheduling, platform ticks           |
| `tab-runtime.ts`              | Worker tab lifecycle, content script readiness detection         |
| `artifact-persistence.ts`     | File writes, pruning, export root resolution, remote asset fetch |
| `artifact-sync.ts`            | Artifact verification and re-import from disk                    |
| `artifact-sync-state.ts`      | Sync state tracking                                              |
| `automatic-artifact-sync.ts`  | Scheduled background sync on browser startup                     |
| `state-access.ts`             | Queue state normalization and derived updates                    |
| `export-root.ts`              | Configurable export directory support                            |
| `shared.ts`                   | Shared constants and archive naming                              |

### Platform Adapters

Each supported platform has:

- **Adapter package** (`packages/adapters-*/`): Discovery, DOM extraction, and turndown configuration.
- **Content script** (`entrypoints/*.content.ts`): Injected into the platform page.
- **Main-world bridge** (`entrypoints/*-main-world.ts`): Network interception and RPC calls.

| Platform   | Discovery Method                          | Extraction Method                          |
| ---------- | ----------------------------------------- | ------------------------------------------ |
| ChatGPT    | Intercept `/backend-api/conversation/{id}` | Page-world API response parsing            |
| DeepSeek   | Intercept `/api/v0/chat_session/fetch_page` | Page-world history messages API            |
| Gemini     | Intercept `batchexecute` RPC              | RPC payload recursive traversal + DOM fallback |
| AI Studio  | Library page `ListPrompts` + DOM sweep    | gRPC-Web `ResolveDriveResource` + DOM      |

## Archive Format

Exports follow a consistent, human-readable directory structure:

```
<export-root>/
└── AIexporter/
    └── <platform>/               # chatgpt, deepseek, gemini, aistudio
        └── <conversation-folder>/ # Title + source ID suffix
            └── <revision>/        # Content hash (first 12 hex chars)
                ├── <artifact>.md           # Markdown with YAML frontmatter
                ├── <artifact>.bundle.json  # Full structured data
                └── <artifact>.assets/      # Downloaded images & attachments
                    ├── 00-image.jpg
                    └── ...
```

**Markdown frontmatter example:**

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
revision: f7a3b2c1d4e5
---
```

The `.bundle.json` contains the complete structured data including all messages, thinking blocks, attachments, and metadata — suitable for programmatic processing.

## Native Host (Windows)

The optional Windows native messaging host (`apps/extension/native-host/`) communicates with the extension via stdin/stdout JSON messages. It enables:

| Capability                     | Description                                              |
| ------------------------------ | -------------------------------------------------------- |
| **Custom export directory**    | Pick any local folder via native folder picker dialog    |
| **Open files**                 | Open exported `.md` with system default handler          |
| **Reveal in Explorer**         | Open the export folder in File Explorer                  |
| **Move to Recycle Bin**        | Soft-delete exported files                               |
| **OneDrive path resolution**   | Resolve OneDrive-redirected Downloads paths              |

**Registration:**

```powershell
pwsh -File apps/extension/scripts/register-native-host.ps1 -ExtensionId "<your-extension-id>"
```

When the native host is unavailable, the extension automatically falls back to the browser Downloads API.

## Server API

The Fastify archive service provides a RESTful API for ingesting and querying exported conversations.

| Method | Endpoint                                        | Description                    |
| ------ | ----------------------------------------------- | ------------------------------ |
| `POST` | `/api/v1/ingest/conversations`                  | Ingest a conversation bundle   |
| `GET`  | `/api/v1/conversations`                         | List/search conversations      |
| `GET`  | `/api/v1/conversations/:platform/:sourceId`     | Get a specific conversation    |
| `GET`  | `/healthz`                                      | Health check                   |

**Query parameters for `GET /api/v1/conversations`:**

| Parameter  | Type    | Description                                  |
| ---------- | ------- | -------------------------------------------- |
| `platform` | string  | Filter by platform (`chatgpt`, `gemini`, etc.)|
| `q`        | string  | Full-text search (title + source ID)         |
| `cursor`   | string  | Pagination cursor                            |
| `limit`    | number  | Results per page (default: 50)               |

## Dashboard

The built-in React dashboard is accessible from the browser toolbar. It provides three tabs:

- **Queue** — View pending, processing, completed, and failed items per platform. Pause/resume individual platform services.
- **Logs** — Real-time background debug logs with filtering and search.
- **Settings** — Configure export root, discovery intervals, platform-specific tuning, locale (`en` / `zh-CN`), theme, and server sync.

## Configuration Guide

All settings are accessible from the Dashboard → Settings tab, and stored in extension storage (`browser.storage.local`).

### Export Settings

| Setting                    | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| Export Root Path           | Custom directory for all exports (requires native host)  |
| Revision History Mode      | How to handle previous exports: `disabled`, `recycle_previous`, `archive_then_recycle` |
| Retain Local Revision Count| Number of old revisions to keep on disk                  |
| Open File Actions          | Enable "Open Markdown" and "Show in Folder" buttons      |

### Discovery Settings (per platform)

| Setting              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| Enabled              | Enable/disable this platform                             |
| Auto-Export          | Automatically export newly discovered conversations      |
| History Backfill     | Sweep the conversation history sidebar/library page      |
| Discovery Mode       | `passive_only` (intercept network) or active DOM sweep   |
| Max Concurrency      | Maximum simultaneous worker tabs for this platform       |

### Server Sync

| Setting        | Description                                    |
| -------------- | ---------------------------------------------- |
| Sync to Server | POST bundles to the local archive server       |
| Server URL     | Archive server URL (locked to localhost)       |

## Development

### Project Scripts

| Command                                              | Description                                |
| ---------------------------------------------------- | ------------------------------------------ |
| `corepack pnpm install`                              | Install all workspace dependencies         |
| `corepack pnpm build`                                | Build all packages and apps                |
| `corepack pnpm dev:ext`                              | Run extension in WXT dev mode (hot reload) |
| `corepack pnpm dev:server`                           | Start Fastify server with hot reload       |
| `corepack pnpm test`                                 | Run all Vitest test suites                 |
| `corepack pnpm typecheck`                            | Type-check all workspaces                  |
| `corepack pnpm format`                               | Format with Prettier                       |
| `corepack pnpm --filter <pkg> test`                  | Run tests for a specific package           |
| `corepack pnpm --filter @aiexporter/extension build` | Build only the extension                   |

### Testing

- **Unit tests**: Vitest, co-located with source (`*.test.ts`) or in `test/` directories.
- **Browser testing**: See [`docs/browser-live-testing.md`](docs/browser-live-testing.md) for CDP/Playwright instructions.
- **Extension smoke test**: `apps/extension/scripts/verify-dashboard-file-actions.cjs` validates the dashboard and native host integration.

### Code Style

- TypeScript ESM throughout
- 2-space indentation, semicolons, double quotes, trailing commas
- React components: `PascalCase` files
- Utilities/services: `kebab-case` filenames, `camelCase` symbols
- Prettier for formatting; run `corepack pnpm format` before committing

## Troubleshooting

| Symptom                                                  | Likely Cause                              | Solution                                                      |
| -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Extension doesn't detect conversations                   | Not logged into the AI platform           | Log into the target platform in your browser                  |
| "Native host not available" warning                      | Native host not registered                | Run the registration script (see [Native Host](#native-host-windows)) |
| Gemini/AI Studio discovery incomplete                    | Google rate limiting / reCAPTCHA          | Reduce concurrency, pause other platforms, try again later    |
| Exported markdown is empty or incomplete                 | Extraction timed out                      | Increase `navigationTimeoutMs` in platform settings           |
| DeepSeek discovery sidebar not ready                     | Sidebar not open or page still loading    | Ensure the DeepSeek sidebar is visible; try refreshing        |
| Dashboard white screen                                   | JavaScript error in React render          | Check browser console; report the error with logs             |
| Server connection refused                                | Server not running                        | Run `corepack pnpm dev:server`                                |
| Download was interrupted (SERVER_FAILED / SERVER_BAD_CONTENT) | Network issue or bad remote asset | The item will be retried; check network connectivity          |

## Limitations

- **Google platform discovery** depends on what the logged-in UI exposes during DOM sweeps. Gemini's history sidebar has a known cap (~587 conversations).
- **Native host is Windows-only**. On other platforms, the extension uses the Downloads API and cannot customize the export directory.
- **Background scheduling** requires the browser to be online and authenticated into the target AI platforms.
- **No dedicated archive browsing UI** yet — the server focuses on ingestion and query. Use your favorite Markdown editor to browse exports.
- **DeepSeek attachment files** are recorded as metadata (name + size) but cannot be downloaded automatically (requires per-file signed URLs).
- **AI Studio Drive resources** are stored as links requiring Google account permissions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, code style, and pull request guidelines.

## License

MIT. See [LICENSE](LICENSE) for details.
