# Repository Guidelines

## Project Structure & Module Organization
AIexporter is a `pnpm` monorepo.

- `apps/extension/`: WXT-based Chromium extension, including entrypoints, background runtime, React dashboard UI, and Windows native-host helpers.
- `apps/server/`: Fastify + SQLite archive service.
- `packages/`: shared TypeScript libraries such as `adapter-sdk`, platform adapters, `core-markdown`, and `core-schema`.
- `docs/`: notes and live browser testing instructions.

Keep changes scoped to the relevant package or app. Shared contracts belong in `packages/`, not in app-local code.

## Build, Test, and Development Commands
Run commands from the repo root unless a package-specific command is needed.

- `corepack pnpm install`: install workspace dependencies.
- `corepack pnpm typecheck`: run `tsc --noEmit` across all workspaces.
- `corepack pnpm test`: run Vitest suites across the monorepo.
- `corepack pnpm build`: build all packages and apps.
- `corepack pnpm dev:server`: start the Fastify server on `http://127.0.0.1:8787`.
- `corepack pnpm dev:ext`: run the WXT extension in development mode.
- `corepack pnpm --filter @aiexporter/extension register:native-host`: register the Windows native host when testing file actions.

## Coding Style & Naming Conventions
This repo is TypeScript-first and uses ESM modules. Follow the existing style: 2-space indentation, semicolons, double quotes, and trailing commas where supported. Prettier is installed; use it for formatting consistency.

- React components: `PascalCase` files and exports.
- Utilities, services, and runtime modules: `kebab-case` filenames with `camelCase` symbols.
- Tests: place `*.test.ts` beside source files or under a local `test/` directory.

Prefer small modules with explicit imports. Do not mix unrelated refactors into feature work.

## Testing Guidelines
Vitest is the test runner across apps and packages. Add or update tests whenever extraction logic, queue behavior, runtime messaging, or persistence changes.

- Run all tests: `corepack pnpm test`
- Run one package: `corepack pnpm --filter @aiexporter/server test`

For browser-specific work, also follow `docs/browser-live-testing.md` for Edge/CDP verification.

## Commit & Pull Request Guidelines
History is still short, but current commits use short imperative subjects, sometimes with a Conventional Commit prefix such as `chore:`. Prefer `type: concise summary` when it fits, for example `fix: guard missing DeepSeek history nodes`.

PRs should include:

- a clear summary of affected apps/packages
- linked issue or task context
- test commands run
- screenshots or notes for dashboard, popup, or native-host UX changes

## Security & Configuration Tips
This repository is Windows-first. Do not commit profiles, browser data, SQLite archives, or secrets. Treat native-host registration and archive paths as machine-specific configuration.
