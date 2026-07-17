# DX/Dev Polish — Design Spec

**Project**: Whim IDE (v0.4.0)
**Date**: 2026-07-17
**Status**: Approved design

## Goal

Harden developer experience and engineering guardrails before UI/bug-fix passes. Every change after this benefits from stricter lint, typed checks, and automated gates.

## 1. ESLint Hardening

### Current
- `@typescript-eslint/no-explicit-any: off` — blanket suppression
- `no-control-regex: off` — blanket suppression
- `react-hooks/exhaustive-deps` — not configured
- `no-console` — not configured

### Target
- `@typescript-eslint/no-explicit-any` → `warn` — intentional `any` gets a local suppression comment
- `no-control-regex` → `warn` — only suppress where regexes genuinely need control chars
- Add `react-hooks/exhaustive-deps: warn` — catches stale closures in effects
- Add `no-console: warn` — catches debug logging, `console.error` gets a suppression
- All new warns are fixable or suppressible per-site

## 2. Scripts & Tooling

### New npm scripts
```json
"typecheck": "tsc --noEmit",
"check": "npm run typecheck && npm run lint && npm test",
"clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true}); require('fs').rmSync('.tsbuildinfo',{recursive:true,force:true})\""
```

### Formatter
- Add Prettier with a minimal config (no semicolons, single quotes, 100 width — match existing style)
- Scripts: `format` (write), `format:check` (CI-safe)
- `.prettierignore` mirroring `.gitignore`

## 3. CI Pipeline

### File: `.github/workflows/ci.yml`
Triggers: push to main, pull requests

Jobs (sequential for fast failure):
1. **lint** — `npm run lint`
2. **typecheck** — `npm run typecheck`
3. **test** — `npm test` (vitest, jsdom)
4. **rust-check** — `cargo check` in `src-tauri/`
5. **rust-clippy** — `cargo clippy --all-targets --all-features -- -D warnings`
6. **rust-test** — `cargo test`
7. **build** — `npm run build`

Rust steps use `actions-rust-toolchain` with stable MSVC on `windows-latest`.

## 4. Git Hygiene

### `.gitignore` additions
```
# Build artifacts
artifacts/
coverage/
.tsbuildinfo

# Whim runtime
.whim/context/

# OS
Thumbs.db
```

### `.gitattributes`
```
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

## 5. Editor Configuration

### `.vscode/extensions.json`
Recommended extensions:
- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`
- `rust-lang.rust-analyzer`
- `tauri-apps.tauri-vscode`
- `bradlc.vscode-tailwindcss`

### `.vscode/settings.json`
- `editor.formatOnSave: true`
- `editor.defaultFormatter: esbenp.prettier-vscode`
- `eslint.validate: ["typescript", "typescriptreact"]`
- `typescript.tsdk: "node_modules/typescript/lib"`
- `files.associations` for Tauri configs

Note: `.vscode/settings.json` must be explicitly tracked (`.gitignore` has `.vscode/*` but `!.vscode/extensions.json` — add `!vscode/settings.json`).

## Non-goals

- No dependency updates (separate pass)
- No architectural changes
- No test additions beyond what lint/types catch
- No Prettier plugin ecosystem (just core)

## Acceptance criteria

1. `npm run check` passes (typecheck + lint + test)
2. `cargo clippy --all-targets --all-features -- -D warnings` passes
3. CI workflow runs all checks
4. Editor config ensures format-on-save for new files
5. Existing code is not reformatted in bulk (formatting only touches files edited in subsequent passes)
