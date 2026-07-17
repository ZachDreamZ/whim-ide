# Performance & Hardening — Design Spec

**Project**: Whim IDE (v0.4.0)
**Date**: 2026-07-17
**Status**: Approved design

## Goal

Reduce initial bundle size via lazy-loading hubs and removing unused deps. Add code splitting and unhandled rejection hardening.

## 1. Lazy-Load Hubs (P1)

Convert eager imports in `src/App.tsx` to `React.lazy(() => import(...))` for: MissionControl, ChatHub, NativeBrowserHub, CreativeStudio, ProviderHub, ScheduledTasksHub, PluginsHub, EveHub, SitesHub, PullRequestsHub, EcosystemHub, OrchestrationPanel, ShipHub, AutopilotHub.

Add `<Suspense fallback={<LoadingFallback />}>` wrapper in App.tsx.

## 2. Remove Unused Dependencies (P1)

Remove from `package.json`:
- `zod` — no imports in src/
- `@langchain/core` — only `@langchain/langgraph` is used
- `@monaco-editor/react` — no imports
- `next-themes` — no imports
- `@radix-ui/react-dropdown-menu` — base-ui/menu used instead
- `@radix-ui/react-scroll-area` — base-ui/scroll-area used instead
- `@radix-ui/react-slot` — no imports
- `@radix-ui/react-tooltip` — no imports

Also remove any unused `@types/` if their main package is removed.

## 3. Code Splitting (P2)

In `vite.config.ts`, add `manualChunks` for vendor splits.

## 4. Unhandled Rejection Handler (P3)

Add global `window.addEventListener("unhandledrejection", ...)` in `main.tsx`.

## Acceptance criteria

1. `npm run check` passes
2. `npm run build` succeeds with no chunk-size warnings
3. App loads and renders correctly
4. All hub views render correctly after lazy-loading
5. No broken imports from removed packages
