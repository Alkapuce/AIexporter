# Contributing to AIexporter

Thanks for your interest in contributing! This document outlines the process for setting up your development environment, making changes, and submitting pull requests.

## Development Setup

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0 (managed via Corepack)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Alkapuce/AIexporter.git
cd aiexporter

# Enable Corepack and install dependencies
corepack enable
corepack pnpm install

# Build all packages
corepack pnpm build

# Run tests
corepack pnpm test

# Type-check the entire monorepo
corepack pnpm typecheck
```

### Running in Development

```bash
# Start the archive server (http://127.0.0.1:8787)
corepack pnpm dev:server

# Start the extension in development mode (load unpacked in Edge/Chrome)
corepack pnpm dev:ext

# Register the Windows native host (required for file operations)
corepack pnpm --filter @aiexporter/extension register:native-host
```

## Project Structure

This is a **pnpm monorepo** with the following layout:

```
apps/
  extension/   # WXT-based Chromium extension
  server/      # Fastify + SQLite archive service
packages/
  adapter-sdk/        # Shared types and utilities for platform adapters
  adapters-chatgpt/   # ChatGPT platform adapter
  adapters-deepseek/  # DeepSeek platform adapter
  adapters-gemini/    # Gemini + AI Studio platform adapter
  core-markdown/      # Markdown serialization
  core-schema/        # Zod schemas and shared types
```

## Code Style

- **TypeScript** with ESM modules
- 2-space indentation
- Semicolons
- Double quotes
- Trailing commas
- Format with Prettier: `corepack pnpm format`

See [AGENTS.md](AGENTS.md) for detailed coding conventions.

## Making Changes

1. **Create a branch** from `main` with a descriptive name (e.g., `fix/queue-dedup`, `feat/gemini-discovery`)
2. **Keep changes scoped** to the relevant app or package
3. **Add tests** for new functionality or bug fixes
4. **Run the full CI check** before submitting:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm format:check
```

## Commit Messages

Use short imperative subjects, optionally with a Conventional Commit prefix:

- `feat: add platform X adapter`
- `fix: guard missing history nodes`
- `chore: update dependencies`
- `docs: add API reference`

## Pull Request Process

1. Ensure all checks pass (typecheck, test, build, format)
2. Include a clear description of:
   - What was changed and why
   - Which apps/packages are affected
   - How to verify the change
3. Add screenshots for dashboard, popup, or native-host UX changes
4. Link any related issues or tasks

## Testing

- **Test runner**: Vitest
- **Run all tests**: `corepack pnpm test`
- **Run a specific package**: `corepack pnpm --filter @aiexporter/server test`
- Tests should be placed beside source files (`*.test.ts`) or in a local `test/` directory

## Reporting Bugs

- Use GitHub Issues
- Include: browser version, extension version, steps to reproduce, expected vs actual behavior
- For extension bugs, include the background debug logs from the dashboard Logs tab

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
