# Bug / Edge-Case Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add error boundary, fix empty states, clean up sidecar logs.

**Architecture:** Two new files (ErrorBoundary.tsx, ErrorBoundary.module.css) and edits to 4 existing files.

**Spec:** `docs/superpowers/specs/2026-07-17-bug-edge-case-polish-design.md`

## Global Constraints

- Error boundary is a class component (React requires `componentDidCatch`)
- All changes must pass `npm run check` (typecheck + lint + test)
- No `any` type additions — strict TypeScript

---

### Task 1: Error Boundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/main.tsx`

- [ ] Create `src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh w-dvh items-center justify-center bg-[#0f0f0f] p-8">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-lg font-semibold text-[#e0e0e0]">Something went wrong</h1>
            <p className="mb-6 text-sm text-[#888]">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-[#5adf9a] px-4 py-2 text-sm font-medium text-[#0f0f0f] transition-colors hover:bg-[#4bcb88]"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] In `src/main.tsx`, wrap `<App />`:
```tsx
import { ErrorBoundery } from "./components/ErrorBoundary";  // note: named export

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
```

- [ ] Run `npm run check` to verify
- [ ] Commit: `git add src/components/ErrorBoundary.tsx src/main.tsx && git commit -m "fix: add React error boundary for render crash resilience"`

---

### Task 2: Empty states

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/MemoryLedgerSidebar.tsx`

- [ ] In `CommandPalette.tsx`, after the filter mapping, add a conditional for empty `shown`:
```tsx
{shown.length === 0 && (
  <div className="px-4 py-8 text-center text-sm text-[#888]">
    No matching commands
  </div>
)}
```

- [ ] In `MemoryLedgerSidebar.tsx`, in the observations section, add a conditional:
```tsx
{observations.length === 0 && (
  <div className="px-4 py-8 text-center text-sm text-[#666]">
    No observations yet
  </div>
)}
```

- [ ] Run `npm run check` to verify
- [ ] Commit: `git add src/components/CommandPalette.tsx src/components/MemoryLedgerSidebar.tsx && git commit -m "fix: add empty-state placeholders for command palette and memory ledger"`

---

### Task 3: Sidecar log cleanup

**Files:**
- Modify: `src-sidecar/index.ts`

- [ ] Replace 4 `console.log` calls with `console.debug`
- [ ] Run `npm run typecheck` and `npm run lint` to verify
- [ ] Commit: `git add src-sidecar/index.ts && git commit -m "chore: downgrade sidecar init logs to console.debug"`
