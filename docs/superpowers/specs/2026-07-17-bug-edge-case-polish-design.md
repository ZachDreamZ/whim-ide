# Bug / Edge-Case Polish — Design Spec

**Project**: Whim IDE (v0.4.0)
**Date**: 2026-07-17
**Status**: Approved design

## Goal

Fix the highest-risk bugs and edge cases identified in the scout audit before visual or performance passes.

## 1. Error Boundary (HIGH)

### Current
No React error boundary. Any render crash in any component takes down the entire app. In a Tauri desktop app there is no browser refresh — the user must close and relaunch.

### Fix
- Create `src/components/ErrorBoundary.tsx` — class component with `componentDidCatch`, renders a fallback UI with:
  - "Something went wrong" heading
  - Error message (dev mode) or generic message (production)
  - "Reload" button that calls `window.location.reload()`
- Wrap `<App />` in `src/main.tsx` with the boundary

## 2. Empty States (MEDIUM)

### CommandPalette
When `shown` array is empty after filtering, render: "No matching commands"

### MemoryLedgerSidebar
When observations array is empty, render: "No observations yet"

## 3. Sidecar Logs (LOW)

### Current
`src-sidecar/index.ts` has 4 `console.log` calls for pipeline initialization.

### Fix
Replace `console.log` with `console.debug`.

## Non-goals

- No `any` type cleanup (touches 30+ files, separate pass)
- No test additions for these components (scope-limited pass)
- No Rust changes (Rust error handling is already clean)

## Acceptance criteria

1. `npm run check` passes (typecheck + lint + test)
2. App survives a render crash with fallback UI
3. CommandPalette shows "No matching commands" on empty filter
4. MemoryLedgerSidebar shows "No observations yet" when empty
5. No `console.log` in sidecar (only `console.debug`)
