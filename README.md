# AIexporter

[English](README.md) | [简体中文](README.zh-CN.md)

AIexporter is a pnpm monorepo for exporting browser AI conversations into normalized Markdown archives and optional local server archives.

This repository currently focuses on a Windows-first developer workflow with:

- a Chromium extension built with WXT
- background queueing and worker-based export orchestration
- local Markdown and bundle persistence via the Downloads API
- optional Windows native-host actions for opening files and revealing folders
- a Fastify + SQLite archive service for local ingestion and query

## Status at a glance

| Area | Current status |
| --- | --- |
| ChatGPT extension flow | Implemented |
| DeepSeek extension flow | Implemented with dedicated discovery and worker logic |
| Gemini extension flow | Implemented with conservative DOM-first discovery and export |
| AI Studio extension flow | Implemented with DOM-first discovery, export, and settings metadata capture |
| Dashboard / popup controls | Implemented with multi-platform controls and queue visibility |
| Local Markdown export | Implemented |
| Local artifact index | Implemented |
| Native host file actions | Implemented for Windows, with browser fallback |
| Fastify ingest server | Implemented |
| Browser archive viewer | Not implemented |

## Workspace layout

```text
apps/
  extension/   WXT Chromium extension
  server/      Fastify ingest and archive API
packages/
  adapter-sdk/         shared runtime contracts and defaults
  adapters-chatgpt/    ChatGPT extraction helpers
  adapters-deepseek/   DeepSeek extraction and discovery helpers
  adapters-gemini/     Gemini + AI Studio extraction and discovery helpers
  core-markdown/       canonical Markdown serializer
  core-schema/         shared schema and bundle types
docs/
  browser-live-testing.md  practical Edge/CDP/Playwright testing notes
  PLAN.md              original staged implementation plan
  refactor-roadmap.md  current refactor notes and next priorities
```

## Core architecture

### Extension pipeline

1. A content script observes a supported conversation page.
2. A page-world bridge collects discovery signals from in-page network activity where applicable.
3. The background service worker deduplicates discovery events into a queue.
4. A platform worker tab loads the conversation and requests full extraction from the content script.
5. The extension serializes the normalized bundle into Markdown and bundle JSON.
6. Artifacts are stored locally through the browser Downloads API.
7. If server sync is enabled, the same bundle is also POSTed to the local Fastify service.

### Background layering after this refactor

The background runtime is no longer centered around a single oversized file.

- `apps/extension/entrypoints/background.ts` wires listeners and bootstraps services.
- `apps/extension/src/background/runtime-router.ts` owns runtime message routing.
- `apps/extension/src/background/service-runtime.ts` owns queue orchestration, worker scheduling, and platform ticks.
- `apps/extension/src/background/tab-runtime.ts` owns content-script messaging and worker-tab readiness checks.
- `apps/extension/src/background/artifact-persistence.ts` owns artifact writes, pruning, and native-host assisted file actions.
- `apps/extension/src/background/state-access.ts` owns queue-state normalization and derived service updates.
- `apps/extension/src/background/shared.ts` owns shared constants and archive naming helpers.

For the current debt register and the next refactor targets, see `docs/refactor-roadmap.md`.

## Supported platform surface

### ChatGPT

- current-page extraction
- queue-driven export
- local persistence
- optional server sync

### DeepSeek

- passive discovery from page activity
- historical discovery sweep support
- dedicated worker-tab lifecycle handling
- local persistence
- optional server sync

### Gemini

- current-page extraction
- background DOM-history discovery with lazy-load handling
- worker-driven export and local persistence
- conservative throttling tuned for Google properties

### AI Studio

- current prompt/chat extraction
- library-page DOM discovery
- run-settings metadata capture
- worker-driven export and local persistence

## Prerequisites

Validated in this workspace with:

- Node.js 22+
- pnpm 10+
- PowerShell 7 on Windows

The extension targets Chromium browsers. The current native-host helper is Windows-specific.

## Getting started

### 1. Install dependencies

```powershell
corepack pnpm install
```

### 2. Run verified checks

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

These commands are the current repository baseline and should stay green before any release or archival step.

### 3. Start the local archive server

```powershell
corepack pnpm dev:server
```

Default server address: `http://127.0.0.1:8787`

### 4. Build or run the extension

Development mode:

```powershell
corepack pnpm dev:ext
```

One-off build:

```powershell
corepack pnpm --filter @aiexporter/extension build
```

The unpacked extension output is written to:

```text
apps/extension/.output/chrome-mv3
```

## Native host integration

Windows native-host files live under `apps/extension/native-host/`.

They are used for two UX cases in the dashboard:

- open the latest exported Markdown with the system default handler
- reveal the export target in Explorer

If the native host is unavailable, the extension falls back to browser-level download actions where possible.

Relevant implementation files:

- `apps/extension/native-host/host.cjs`
- `apps/extension/native-host/manifest.json`
- `apps/extension/scripts/register-native-host.ps1`
- `apps/extension/src/runtime/native-host.ts`

The native host now resolves the Windows Downloads known-folder first, so OneDrive-redirected Downloads paths are respected.

## Archive format

Local and server-side archives share the same normalized layout:

```text
AIexporter/<platform>/<conversation-folder>/<revision>/
  <artifact>.md
  <artifact>.bundle.json
```

The Markdown file contains frontmatter such as:

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

The extension also maintains browser-local indexes for:

- discovered conversations
- export queue state
- retained local artifacts
- debug logs

## Server API

The Fastify service currently exposes:

- `POST /api/v1/ingest/conversations`
- `GET /api/v1/conversations?platform=&q=&limit=&cursor=`
- `GET /api/v1/conversations/:platform/:sourceId`
- `GET /healthz`

The server source lives under `apps/server/src/`.

## Verification workflow

### Automated checks

The repository currently uses these verified commands during development:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

### Browser-level validation

This project should not be considered done by build output alone.

When validating extension changes, prefer a real browser session that confirms:

- the background worker initializes successfully
- the dashboard can read queue and debug state
- manual export still works on supported sites
- file-action buttons still reach native-host or browser fallback behavior

The existing browser verification helper lives at:

- `apps/extension/scripts/verify-dashboard-file-actions.cjs`
- `docs/browser-live-testing.md`

It assumes a compatible Chromium debugging session and a loaded extension build.

## Current limitations

- Google properties still use conservative DOM-first discovery, so historical completeness depends on what the logged-in UI exposes and lazy-loads during the sweep.
- Native-host enhanced file actions are Windows-specific.
- Background scheduling and manual verification still assume the browser is online and already authenticated into the target AI site.
- There is no dedicated archive browsing web UI yet; the current server focuses on ingestion and query.

## Roadmap

Short-term priorities after this pass:

- split `apps/extension/entrypoints/deepseek.content.ts`
- split `apps/extension/src/ui/dashboard/DashboardApp.tsx`
- document release and contribution workflows in more detail
- add a browser smoke flow that does not depend on a personal Edge profile

Historical implementation planning is kept in `docs/PLAN.md`.
Current refactor notes are tracked in `docs/refactor-roadmap.md`.

## Release and archival workflow

This repository is now organized around a clean initial baseline:

- keep `typecheck`, `test`, and `build` green
- keep temporary local debugging assets out of version control
- tag the initial baseline as `v0.1.0`
- push the cleaned monorepo to a private GitHub repository first

That keeps the first public-facing history focused on a modular extension runtime instead of a monolithic background implementation.
