# Performance & Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Reduce bundle size, add code splitting, harden error handling.

**Architecture:** App.tsx lazy imports, package.json dep removal, vite.config.ts code splitting, main.tsx rejection handler.

**Spec:** `docs/superpowers/specs/2026-07-17-performance-polish-design.md`

## Global Constraints

- Must pass `npm run check` (typecheck + lint + test)
- `npm run build` must succeed with no chunk-size warnings
- React.lazy requires default exports or named export wrappers
- Remove packages only if zero imports exist in `/src/` and `/src-tauri/`

---

### Task 1: Remove Unused Dependencies

**Files:**
- Modify: `package.json`

- [ ] Remove these from `dependencies`:
  - `zod`
  - `@langchain/core`
  - `@monaco-editor/react`
  - `next-themes`
  - `@radix-ui/react-dropdown-menu`
  - `@radix-ui/react-scroll-area`
  - `@radix-ui/react-slot`
  - `@radix-ui/react-tooltip`

- [ ] Run `rm -rf node_modules && npm install` (or just `npm install` which prunes)
- [ ] Run `npm run check`
- [ ] Run `npm run build` to verify build succeeds
- [ ] Commit: `git add package.json package-lock.json && git commit -m "perf: remove 8 unused dependencies (~850KB)"`

---

### Task 2: Lazy-Load Hubs

**Files:**
- Modify: `src/App.tsx`

- [ ] Import `lazy`, `Suspense` from React:
```tsx
import { lazy, Suspense } from "react";
```

- [ ] Replace all 14 eager hub imports with `lazy(() => import(...))`:

```tsx
const MissionControl = lazy(() => import("./components/MissionControl"));
const ChatHub = lazy(() => import("./components/ChatHub"));
const NativeBrowserHub = lazy(() => import("./components/NativeBrowserHub"));
const CreativeStudio = lazy(() => import("./components/CreativeStudio"));
const ProviderHub = lazy(() => import("./components/ProviderHub"));
const ScheduledTasksHub = lazy(() => import("./components/ScheduledTasksHub"));
const PluginsHub = lazy(() => import("./components/PluginsHub"));
const EveHub = lazy(() => import("./components/EveHub"));
const SitesHub = lazy(() => import("./components/SitesHub"));
const PullRequestsHub = lazy(() => import("./components/PullRequestsHub"));
const EcosystemHub = lazy(() => import("./components/EcosystemHub"));
const OrchestrationPanel = lazy(() => import("./components/OrchestrationPanel"));
const ShipHub = lazy(() => import("./components/ShipHub"));
const AutopilotHub = lazy(() => import("./components/AutopilotHub"));
```

- [ ] Wrap the main content area in `<Suspense fallback={<LoadingFallback />}>`. Create a simple fallback component:

```tsx
function LoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0b0d0d]">
      <div className="text-sm text-[#666]">Loading…</div>
    </div>
  );
}
```

- [ ] Run `npm run check`
- [ ] Run `npm run build` to verify
- [ ] Commit: `git add src/App.tsx && git commit -m "perf: lazy-load all hub components with React.lazy"`

---

### Task 3: Code Splitting Config

**Files:**
- Modify: `vite.config.ts`

- [ ] Add `manualChunks` to the build config:

```ts
build: {
  chunkSizeWarningLimit: 2000,
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes("node_modules/motion")) return "vendor-motion";
        if (id.includes("node_modules/@tabler/icons-react")) return "vendor-icons";
        if (id.includes("node_modules/monaco-editor")) return "vendor-monaco";
        if (id.includes("node_modules")) return "vendor";
      },
    },
  },
},
```

Note: Keep `chunkSizeWarningLimit: 2000` — lazy hubs already reduce initial chunk size. The manualChunks further splits vendors.

- [ ] Run `npm run build` to verify
- [ ] Commit: `git add vite.config.ts && git commit -m "perf: add manualChunks for vendor code splitting"`

---

### Task 4: Unhandled Rejection Handler

**Files:**
- Modify: `src/main.tsx`

- [ ] Add global unhandled rejection listener before `root.render`:

```tsx
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Unhandled Rejection]", event.reason);
});
```

- [ ] Run `npm run typecheck` to verify
- [ ] Commit: `git add src/main.tsx && git commit -m "fix: add global unhandledrejection handler"`
