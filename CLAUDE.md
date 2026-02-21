# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

htmx-ext-tus is an HTMX extension that integrates the [tus protocol](https://tus.io/) for resumable file uploads. It allows using tus uploads declaratively via HTMX attributes (`data-tus-*`). The package follows the official `htmx-ext-*` naming convention.

## Architecture

- **`src/index.js`** — Extension source. Registers `htmx.defineExtension('tus', ...)`. The `init()` method attaches public API to `htmx.tus` namespace for IIFE users. Intercepts `htmx:configRequest` to handle file uploads via tus-js-client. Cleans up on `htmx:beforeCleanupElement`. Also exports `configure()`, `resetConfig()`, `activeUploads`, and `tus` via ES modules.
- **`esbuild.config.js`** — Produces two bundles:
  - `dist/htmx-ext-tus.js` (IIFE) — bundles tus-js-client, expects htmx as browser global
  - `dist/htmx-ext-tus.esm.js` (ESM) — externalizes both tus-js-client and htmx.org
- **`test/`** — Vitest tests with jsdom environment. `test/patch-xpath.js` patches jsdom's XPathExpression for htmx compatibility.

## Development Commands

All commands run via Podman (no local Node.js required):

```bash
./dev.sh install       # npm install
./dev.sh build         # Build dist/
./dev.sh test          # Run tests
./dev.sh test:watch    # Watch mode
./dev.sh dev           # Build watch mode
./dev.sh shell         # Container shell
```

## Key Patterns

### Attributes
Extension reads config from `data-tus-*` attributes, inherited up the DOM tree:
- **Core:** `endpoint`, `chunk-size`, `retry-delays`, `parallel`, `resume`, `metadata`, `headers`
- **Upload options:** `upload-url`, `upload-size`, `upload-data-during-creation`, `override-patch-method`, `add-request-id`, `upload-length-deferred`, `remove-fingerprint-on-success`, `protocol`
- **Extension-specific:** `terminate` (DELETE on cleanup), `auto-resume` (findPreviousUploads flow), `complete-url` (POST after all uploads finish)

### Events
Custom events dispatched (all bubble): `tus:start`, `tus:progress`, `tus:success`, `tus:error`, `tus:chunk-complete`, `tus:upload-url-available`, `tus:before-request`, `tus:after-response`, `tus:should-retry` (cancelable), `tus:resume`.

### JS API
Available via ES module exports or `htmx.tus` namespace (IIFE):
- `configure(options)` — Set global defaults for function-valued options (`httpStack`, `fileReader`, `urlStorage`, `fingerprint`, `metadataForPartialUploads`). Merged into every `new tus.Upload()` call.
- `resetConfig()` — Clear all global defaults set via `configure()`.
- `activeUploads` — WeakMap of element → upload instances.
- `tus` — Re-exported tus-js-client module (ESM only). IIFE exposes `isSupported` and `canStoreURLs` directly on `htmx.tus`.

### Auto-resume flow
When `data-tus-auto-resume="true"`, `startUpload()` calls `findPreviousUploads()` asynchronously before calling `upload.start()`. The upload instance is returned synchronously and tracked immediately; only the start is deferred.

## Testing Notes

- Tests use `vi.resetModules()` + `vi.clearAllMocks()` to get fresh htmx + extension instances per test.
- `test/patch-xpath.js` must load before `test/setup.js` (configured in vitest.config.js `setupFiles` order) to patch jsdom's XPathExpression.evaluate for htmx compatibility.
- tus-js-client is mocked via `vi.mock('tus-js-client')`.
- When a test uses `tus.Upload.mockImplementation()`, subsequent tests in the same describe block must reset it (mockImplementation persists across `clearAllMocks`).

## License

Apache License 2.0
