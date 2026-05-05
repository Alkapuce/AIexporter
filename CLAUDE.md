# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AIexporter is a pnpm monorepo for exporting browser AI conversations (ChatGPT, DeepSeek, Gemini, AI Studio) into normalized Markdown archives and an optional local server archive.

- **apps/extension/**: WXT-based Chromium extension with background queue, content scripts, React dashboard, and Windows native-host helpers.
- **apps/server/**: Fastify + SQLite archive service (ingest and query).
- **packages/**: Shared TypeScript libraries (`adapter-sdk`, platform adapters, `core-markdown`, `core-schema`).

## Essential commands

Run all commands from the repo root using `corepack pnpm` (pnpm 10+ required).

```bash
corepack pnpm install          # Install dependencies
corepack pnpm typecheck        # Type-check all workspaces
corepack pnpm test             # Run all Vitest suites
corepack pnpm build            # Build all packages and apps
corepack pnpm dev:server       # Start Fastify server (http://127.0.0.1:8787)
corepack pnpm dev:ext          # Run WXT extension in dev mode
corepack pnpm --filter @aiexporter/extension register:native-host  # Register Windows native host
```

Run a specific package's tests:
```bash
corepack pnpm --filter @aiexporter/server test
```

## Architecture

### Extension pipeline
1. Content script observes supported conversation page.
2. Page-world bridge collects discovery signals from in-page network activity.
3. Background service worker deduplicates discovery events into a queue.
4. Platform worker tab loads conversation and requests extraction from content script.
5. Extension serializes normalized bundle into Markdown and bundle JSON.
6. Artifacts stored via browser Downloads API; optionally POSTed to local Fastify service.

### Background layering
- `entrypoints/background.ts` - wires listeners and bootstraps services.
- `src/background/runtime-router.ts` - runtime message routing between background, content scripts, and dashboard.
- `src/background/service-runtime.ts` - queue orchestration, worker scheduling, platform ticks, challenge detection.
- `src/background/tab-runtime.ts` - worker-tab lifecycle, content-script readiness.
- `src/background/artifact-persistence.ts` - artifact writes, pruning, export-root resolution.
- `src/background/artifact-sync.ts` - artifact verification and re-import from disk.
- `src/background/artifact-sync-state.ts` - sync state tracking.
- `src/background/automatic-artifact-sync.ts` - scheduled background sync logic.
- `src/background/export-root.ts` - configurable export directory support.
- `src/background/state-access.ts` - queue-state normalization and derived updates.
- `src/background/shared.ts` - shared constants, archive naming.

### Platform adapters
Each platform (ChatGPT, DeepSeek, Gemini, AI Studio) has:
- A content script (`entrypoints/*.content.ts`)
- A main-world bridge (`entrypoints/*-main-world.ts`) for network interception
- Adapter logic in `packages/adapters-*/` (discovery, DOM extraction, turndown config)

### Native host (Windows)
- Located in `apps/extension/native-host/` (host.cjs, manifest.json).
- Capabilities: custom export directory picker, open file, reveal in Explorer, move to Recycle Bin, resolve OneDrive-redirected Downloads paths.
- Falls back to browser Downloads API when unavailable.
- Registration script: `apps/extension/scripts/register-native-host.ps1`.

### Archive format
Exports follow a consistent directory structure:
```
<export-root>/AIexporter/<platform>/<conversation-folder>/<revision>/
  <artifact>.md
  <artifact>.bundle.json
```

### Dashboard
The extension dashboard provides:
- Queue tab — view pending, processing, completed, and failed items per platform.
- Logs tab — real-time background debug logs.
- Settings tab — configure export root, discovery intervals, platform-specific tuning, locale (en/zh-CN).

## Testing
- Vitest is the test runner. Tests are co-located with source (`*.test.ts`) or in a `test/` directory.
- For browser verification: `apps/extension/scripts/verify-dashboard-file-actions.cjs` and `docs/browser-live-testing.md`.

## Coding style
- TypeScript ESM, 2-space indentation, semicolons, double quotes, trailing commas.
- React components: `PascalCase` files.
- Utilities/services: `kebab-case` filenames with `camelCase` symbols.

## Important documentation
- `README.md` - detailed status, layout, archive format, server API.
- `AGENTS.md` - repository guidelines (build, test, commit style).
- `CONTRIBUTING.md` - contribution guidelines and PR process.
- `CHANGELOG.md` - version history and release notes.
- `docs/browser-live-testing.md` - Edge/CDP/Playwright testing notes.

## Commit style
Use short imperative subjects, optionally with Conventional Commit prefix (`chore:`, `fix:`, `feat:`). Example: `fix: guard missing DeepSeek history nodes`.

## Notes for Claude Code
- The user's global `CLAUDE.md` (in `C:\Users\qpj\.claude\`) has additional environment preferences (PowerShell 7, uv for Python, etc.). Prefer PowerShell commands when running scripts, but the repo scripts use `corepack pnpm` which works in any shell.
- When making changes, keep scope limited to the relevant app or package. Avoid cross-cutting refactors unrelated to the task.
- The extension uses WXT - refer to WXT docs for entrypoint and build configuration.
- Native host changes require re-registration; the user may need to run the PowerShell script manually.
- Server uses SQLite (better-sqlite3). Migrations are handled via code in `apps/server/src/db.ts`.
