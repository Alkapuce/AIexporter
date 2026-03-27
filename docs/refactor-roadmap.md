# Refactor Roadmap

## Scope of this pass

This pass focuses on the extension background layer and repository hygiene.
It does **not** rewrite the entire monorepo.

## What changed in this pass

- Replaced the monolithic background entrypoint with a thin bootstrap file.
- Promoted `apps/extension/src/background/shared.ts` and `apps/extension/src/background/state-access.ts` to the single source of truth for shared helpers and queue-state mutations.
- Wired the pre-extracted modules into production:
  - `artifact-persistence.ts`
  - `tab-runtime.ts`
  - `service-runtime.ts`
  - `runtime-router.ts`
- Added focused router tests to keep the background message surface stable.
- Updated repository ignore rules so local debug scratch files under `tmp/` do not leak into the initial archive.

## Pre-refactor snapshot

### Largest source files before this pass

| File | Approx. size | Notes |
| --- | ---: | --- |
| `apps/extension/entrypoints/background.ts` | 60.2 KB / 1638 lines | Mixed bootstrap, queue orchestration, artifact persistence, worker lifecycle, and runtime message routing |
| `apps/extension/entrypoints/deepseek.content.ts` | 22.8 KB | DeepSeek DOM extraction, history discovery, page-world bridge handling |
| `apps/extension/src/ui/dashboard/DashboardApp.tsx` | 20.4 KB | Dashboard state, tabs, filtering, action wiring |
| `apps/extension/src/ui/dashboard/components/SettingsTab.tsx` | 11.0 KB | Settings editor UI |
| `apps/extension/src/background/artifact-persistence.ts` | 9.2 KB | Download/native-host persistence workflow |

### Structural debt before this pass

- `background.ts` duplicated helpers already extracted into `src/background/shared.ts` and `src/background/state-access.ts`.
- Runtime message handling relied on a long `if (message.type === ...)` chain.
- Browser worker lifecycle, persistence, and scheduler logic were coupled in a single file, which made regression risk high.
- Repository root contained temporary CDP/debug scripts under `tmp/`, which were useful locally but should not be part of the initial project archive.

## Current status after refactor

### Background layer

- `apps/extension/entrypoints/background.ts` is now a thin entrypoint focused on:
  - initialization
  - alarm wiring
  - tab-removal wiring
  - runtime message error wrapping
- Message-specific behavior now lives in `apps/extension/src/background/runtime-router.ts`.
- Queue orchestration and worker scheduling live in `apps/extension/src/background/service-runtime.ts`.
- Content-script communication helpers live in `apps/extension/src/background/tab-runtime.ts`.
- Artifact persistence and native-host fallback logic live in `apps/extension/src/background/artifact-persistence.ts`.

### Validation completed in this pass

- `corepack pnpm --filter @aiexporter/extension typecheck`
- `corepack pnpm --filter @aiexporter/extension test`

## Deferred work

### Priority 1: `deepseek.content.ts`

Why deferred:
- It is the next biggest extension hotspot.
- It already contains multiple responsibilities: floating export UI, DOM hydration, historical API pagination, and page-world message handling.
- This pass intentionally avoided touching extraction behavior unless required for background compatibility.

Recommended next split:
- `deepseek-ui.ts`
- `deepseek-history.ts`
- `deepseek-page-world.ts`
- `deepseek-extract.ts`

### Priority 2: `DashboardApp.tsx`

Why deferred:
- It is large but currently stable.
- Recent regressions were hook-order sensitive, so it is safer to refactor after the background layer is stabilized.

Recommended next split:
- dashboard data hooks
- queue table + filters
- logs viewer
- overview summary cards
- settings form state

### Priority 3: repository packaging and release ergonomics

Recommended next tasks:
- add a dedicated contribution guide
- add a release checklist for extension + server
- document optional native-host installation paths for Windows in a separate ops doc
- add a lightweight browser smoke script that does not depend on a personal Edge profile

## Why this order

- The background layer was the highest-risk maintenance bottleneck.
- Splitting it first lowers the cost of later DeepSeek and dashboard refactors.
- It also makes the initial Git history cleaner: the first commit now reflects a modular extension runtime instead of a single oversized background file.
