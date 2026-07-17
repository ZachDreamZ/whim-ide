# DX/Dev Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden lint, add formatter, improve scripts, add CI, and tighten git hygiene for Whim IDE.

**Architecture:** All changes are config-only — no runtime code modified. ESLint config updated, Prettier added, npm scripts extended, VS Code config added, CI workflow added, gitignore/gitattributes updated.

**Tech Stack:** ESLint 10 flat config, Prettier, GitHub Actions, Rust toolchain (stable MSVC).

**Spec:** `docs/superpowers/specs/2026-07-17-dx-dev-polish-design.md`

## Global Constraints

- ESLint config is flat ESM (`eslint.config.js`) — no `.eslintrc`
- All new ESLint rules use `warn` severity, not `error`
- No bulk reformatting of existing code — Prettier runs only on files touched in subsequent passes
- Rust must remain at `-D warnings` for Clippy
- Existing npm scripts must not be renamed or removed
- `.gitignore` entries: add `artifacts/`, `coverage/`, `.tsbuildinfo`, `Thumbs.db`

---

### Task 1: ESLint hardening

**Files:**
- Modify: `eslint.config.js` (rules section)

**Interfaces:**
- Consumes: existing flat ESLint config
- Produces: updated config that warns on `no-explicit-any`, `no-control-regex`, `no-console`, and `react-hooks/exhaustive-deps`

- [ ] **Step 1: Update ESLint rules**

Edit `eslint.config.js` rules block to:

```js
rules: {
  "@typescript-eslint/no-explicit-any": "warn",
  "no-control-regex": "warn",
  "no-console": "warn",
  "react-hooks/exhaustive-deps": "warn",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
},
```

- [ ] **Step 2: Run lint to verify**

Run: `npm run lint`
Expected: Passes (may have warnings, no errors). Warnings are expected for existing `any` usage — new code will see them as warnings.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "chore: harden ESLint rules — warn on any, console, control-regex, exhaustive-deps"
```

---

### Task 2: Prettier configuration

**Files:**
- Create: `.prettierrc`
- Create: `.prettierignore`

**Interfaces:**
- Consumes: project root directory
- Produces: formatter config that matches existing code style

- [ ] **Step 1: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always",
  "endOfLine": "auto"
}
```

- [ ] **Step 2: Create `.prettierignore`**

```
node_modules
dist
dist-ssr
src-tauri/target
src-sidecar
artifacts
scratch
.whim
```

- [ ] **Step 3: Commit**

```bash
git add .prettierrc .prettierignore
git commit -m "chore: add Prettier config"
```

---

### Task 3: npm scripts + git hygiene

**Files:**
- Modify: `package.json` (scripts section)
- Modify: `.gitignore`

- [ ] **Step 1: Add npm scripts**

Edit `package.json` scripts to add:

```json
"typecheck": "tsc --noEmit",
"format": "prettier --write \"src/**/*.{ts,tsx,css,json}\"",
"format:check": "prettier --check \"src/**/*.{ts,tsx,css,json}\"",
"check": "npm run typecheck && npm run lint && npm test",
"clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true}); require('fs').rmSync('.tsbuildinfo',{recursive:true,force:true})\""
```

Insert after existing `"preview"` line, before `"tauri"` line.

- [ ] **Step 2: Update `.gitignore`**

Add to end of `.gitignore`:

```
# Build artifacts
artifacts/
coverage/
.tsbuildinfo

# OS
Thumbs.db
```

- [ ] **Step 3: Create `.gitattributes`**

```
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

- [ ] **Step 4: Run check to verify**

Run: `npm run check`
Expected: typecheck passes, lint passes (warnings OK), tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore .gitattributes
git commit -m "chore: add typecheck/format/check scripts, update gitignore, add gitattributes"
```

---

### Task 4: VS Code configuration

**Files:**
- Modify: `.vscode/extensions.json`
- Create: `.vscode/settings.json`

- [ ] **Step 1: Update `extensions.json`**

```json
{
  "recommendations": [
    "tauri-apps.tauri-vscode",
    "rust-lang.rust-analyzer",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss"
  ]
}
```

- [ ] **Step 2: Create `settings.json`**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.validate": ["typescript", "typescriptreact"],
  "typescript.tsdk": "node_modules/typescript/lib",
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "[toml]": {
    "editor.defaultFormatter": "tamasfe.even-better-toml"
  }
}
```

- [ ] **Step 3: Update `.gitignore` to track settings**

Change `.vscode/*` block from:
```
.vscode/*
!.vscode/extensions.json
```
to:
```
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
```

- [ ] **Step 4: Commit**

```bash
git add .vscode/extensions.json .vscode/settings.json .gitignore
git commit -m "chore: add VS Code settings, track settings.json"
```

---

### Task 5: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: windows-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: windows-latest
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npm test

  rust-check:
    runs-on: windows-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-toolchain@v1
        with:
          toolchain: stable
          profile: minimal
      - run: cargo check --manifest-path src-tauri/Cargo.toml

  rust-clippy:
    runs-on: windows-latest
    needs: rust-check
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-toolchain@v1
        with:
          toolchain: stable
          profile: minimal
          components: clippy
      - run: cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings

  rust-test:
    runs-on: windows-latest
    needs: rust-clippy
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-toolchain@v1
        with:
          toolchain: stable
          profile: minimal
      - run: cargo test --manifest-path src-tauri/Cargo.toml

  build:
    runs-on: windows-latest
    needs: [test, rust-test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow — lint, typecheck, test, rust, build"
```

---

### Task 6: Final verification

**Files:**
- Run: all checks

- [ ] **Step 1: Run full check suite**

Run: `npm run check`
Expected: typecheck passes, lint passes (warnings OK), tests pass.

- [ ] **Step 2: Verify git status is clean**

Run: `git status`
Expected: no uncommitted changes (only the committed files above).

- [ ] **Step 3: Push if applicable**

```bash
git log --oneline -5
```
