# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] - 2026-05-05

### Security

- SSRF protection: block fetching remote assets from private/internal IP ranges (localhost, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, IPv6 ULA/link-local)
- Remote asset size hard cap at 50 MB with streaming read to prevent memory exhaustion
- Server sync URL locked to localhost-only (127.0.0.1, localhost, ::1)
- Content Security Policy hardening for extension pages
- Native host PowerShell path normalization (`path.resolve + path.normalize`) to prevent traversal

### Added

- Dashboard `ErrorBoundary` component to catch React render errors and prevent white screen
- Artifact index in-memory cache with automatic invalidation to reduce repeated JSON parsing
- `sanitizeClone()` shared DOM utility in `@aiexporter/adapter-sdk` (deduplicated from three adapters)
- `exports` field in all package.json files for proper ESM module resolution
- Prettier configuration (`.prettierrc`) and `format` / `format:check` scripts
- MIT `LICENSE` file
- `CONTRIBUTING.md` with development setup, code style, and PR guidelines
- New unit tests: `export-root.test.ts`, `state-access.test.ts`, `tab-runtime.test.ts`, `native-host.test.ts` (28 new tests)
- `clean` script for removing build artifacts across workspaces

### Fixed

- Background initialization failures now properly logged instead of silently swallowed
- Main-world bridge discovery fetch errors (ChatGPT, DeepSeek, Gemini) now logged with context
- `.catch(() => undefined)` replaced with commented no-op blocks for self-documenting intent

### Changed

- Dockerfile pins pnpm version via `corepack prepare` matching `package.json` → `packageManager`
- `adapters-deepseek` adds `jsdom` dev dependency for future DOM-based testing
- `adapters-deepseek` and `adapters-gemini` tsconfig adds `"types": ["node"]`
- `.gitignore` now excludes `apps/extension/native-host/manifest.json`

## [0.2.4] - 2026-05-05

### Added

- Windows native host for custom export directory picker, file open, reveal in Explorer, and recycle bin operations
- Automatic artifact sync from disk on browser startup
- Pause/resume controls for per-platform discovery and extraction
- Chinese (zh-CN) locale support in dashboard UI
- DeepSeek platform adapter with history extraction and pagination

### Fixed

- Guard against missing DeepSeek history nodes causing extraction failure
- Artifact persistence skip logic for duplicate downloads
- Queue deduplication edge cases during rapid discovery events

### Changed

- Improved dashboard UI with real-time log viewer and queue inspection
- Refined platform tab counts and state normalization

## [0.2.3] - 2026-02-15

### Added

- Google AI Studio platform adapter (alongside Gemini)
- Dark/light theme support in dashboard
- Queue deduplication for discovery events
- Worker tab lifecycle management with timeout handling

### Fixed

- Markdown serialization edge cases for code blocks and LaTeX
- Conversation title extraction from page context

## [0.2.2] - 2026-01-20

### Added

- Gemini platform adapter with network-based discovery
- Turndown-based HTML-to-Markdown conversion for all platforms
- Artifact export with embedded asset support

### Fixed

- ChatGPT discovery pagination boundary conditions
- Background service worker lifecycle across browser restarts

## [0.2.1] - 2025-12-10

### Added

- Fastify + SQLite archive server with ingest API
- Dashboard settings tab with configurable export root and intervals

### Changed

- Unified adapter SDK package extracted from platform-specific code
- Core schema refined with optional metadata fields

## [0.2.0] - 2025-11-01

### Added

- Chromium extension with background queue and React dashboard
- ChatGPT platform adapter (discovery + DOM extraction)
- Core Markdown serialization and bundle JSON export
- Workspace monorepo structure (pnpm + WXT)

[0.2.5]: https://github.com/user/aiexporter/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/user/aiexporter/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/user/aiexporter/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/user/aiexporter/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/user/aiexporter/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/user/aiexporter/releases/tag/v0.2.0
