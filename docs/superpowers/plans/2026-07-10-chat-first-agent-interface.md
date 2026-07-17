# Chat-First Agent Interface Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Whim's "Compose a task / Active tasks" flow with a chat-first coding-agent interface — three-column layout, rich agent conversation, smart auto-scroll, collapsible inspector, sticky composer.

**Architecture:** Refactor App.tsx to a three-column CSS grid. Create new components for the conversation timeline, context inspector, file change cards, and auto-scroll hook. Restructure sidebar. Deprecate OrchestrationPanel. The orchestration engine stays but runs behind the chat surface.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn UI, motion (framer-motion), Tauri 2 backend via bridge IPC.

## Global Constraints

- All components must use Tailwind v4 classes + shadcn primitives
- CSS grid for layout, not flex-based three-column hacks
- Right inspector is conditionally mounted (not just visibility:hidden)
- No page-level horizontal scrolling
- All text must follow LLM-friendly coding standard (no shorthand, self-documenting names, one function = one action)
- New files follow the existing project's pattern (type exports, function components, named exports)
- No changes to Rust backend unless required for the chat/run data model
- All existing tests must continue to pass

---

### Task 1: AppShell Layout (new component)

**Files:**
- Create: `src/components/AppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css` (new grid layout classes)
- Delete from App.css: `.build-workspace`, `.workbench`, `.workbench-main`, `.mission-control`

**Interfaces:**
- Consumes: `ProjectSidebar`, `ContextInspector`, `AgentConversation`, `ConversationHeader` (props TBD by Tasks 2-5)
- Produces: `<AppShell inspectorOpen={boolean} onToggleInspector={() => void}>` wrapping the three-column grid

- [ ] **Step 1: Create AppShell.tsx**

```tsx
import { useState, type ReactNode } from "react";
import { ProjectSidebar } from "./ProjectSidebar";
import { ConversationHeader } from "./ConversationHeader";
import { ContextInspector } from "./ContextInspector";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);

  return (
    <div
      className="app-shell"
      data-inspector-open={inspectorOpen ? "true" : "false"}
    >
      <ProjectSidebar />

      <main className="chat-column">
        <ConversationHeader
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />
        {children}
      </main>

      {inspectorOpen && <ContextInspector />}
    </div>
  );
}
```

- [ ] **Step 2: Add grid layout CSS to index.css**

```css
/* Three-column app shell */
.app-shell {
  display: grid;
  height: 100%;
  width: 100%;
  overflow: hidden;
  grid-template-columns: 230px minmax(0, 1fr);
}

.app-shell[data-inspector-open="true"] {
  grid-template-columns: 230px minmax(0, 1fr) 280px;
}

.chat-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--background);
}
```

- [ ] **Step 3: Refactor App.tsx to use AppShell**

The App.tsx main render structure changes from:
```tsx
<div className="whim-app relative">
  <Titlebar />
  <div className="app-body">
    {view !== "autopilot" && view !== "settings" ? (
      <div className="build-workspace">
        <ProjectSidebar />
        <div className="workbench">
          <div className="workbench-main">...</div>
        </div>
      </div>
    ) : null}
  </div>
</div>
```

To:
```tsx
<div className="whim-app relative">
  <Titlebar />
  <div className="app-body">
    {view === "build" || view === "chat" ? (
      <AppShell>
        <AgentConversation
          workspace={workspacePath}
          ...
        />
      </AppShell>
    ) : view !== "autopilot" && view !== "settings" ? (
      <div className="build-workspace">
        <ProjectSidebar />
        <div className="workbench">
          <div className="workbench-main">...other views...</div>
        </div>
      </div>
    ) : null}
  </div>
</div>
```

Note: App.tsx keeps existing state management but wraps the "build" and "chat" views in AppShell. Other views keep old layout. This is incremental — not a full rewrite of App.tsx.

- [ ] **Step 4: Remove old orchestration CSS from App.css**

Remove the following CSS blocks from App.css:
- `.build-workspace` (replaced by `.app-shell`)
- `.workbench` (replaced by `.chat-column`)
- `.workbench-main` (no longer needed)
- `.mission-control` and `.mission-control-split` (replaced by AgentConversation)
- `.mission-header` (replaced by ConversationHeader)

- [ ] **Step 5: Run typecheck and fix any issues**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppShell.tsx src/App.tsx src/index.css src/App.css
git commit -m "feat: add three-column AppShell layout"
```

---

### Task 2: Restructure ProjectSidebar (230px spec)

**Files:**
- Modify: `src/components/ProjectSidebar.tsx`

**Interfaces:**
- Consumes: Existing props pattern (onViewChange, workspace, etc.)
- Produces: Updated sidebar matching the 230px spec with Pinned, Projects (expandable folders), Chats sections

- [ ] **Step 1: Restructure sidebar layout**

The current sidebar is 268px with a search bar, Collapsible project sections, Recent tasks, Chats. Replace with:

Section order:
1. **Product name** ("Whim") + Search button
2. **Primary nav**: New chat, Scheduled, Plugins (clarified icons)
3. **Pinned** — section with pinned conversations/goals
4. **Projects** — expandable folders with conversations nested inside
5. **Chats** — conversations not attached to projects
6. **Bottom**: account/workspace, Settings, usage indicator

Key changes:
- Remove the "Recent tasks" section (replaced by projects/chats)
- Generate conversation titles from first message
- No "continue" entries
- Width 230px (currently 268px)

- [ ] **Step 2: Update width from 268px to 230px**

Change `w-[268px]` to `w-[230px]` in the sidebar container.

- [ ] **Step 3: Add "New chat" as primary action**

The "New chat" button should trigger `onViewChange?.("chat")` and then dispatch a `whim:focus-chat` event to focus the composer.

- [ ] **Step 4: Add Pinned section**

A simple list of pinned items (stored in localStorage for now):
```tsx
{pinnedItems.length > 0 && (
  <section>
    <div className="flex h-7 items-center px-2 text-xs text-muted-foreground">
      Pinned
    </div>
    {pinnedItems.map(...)}
  </section>
)}
```

- [ ] **Step 5: Rename "build" view to primary agent surface**

In the nav items, change "New task" → "New chat". The viewId can remain "build" for backward compat but the label changes.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProjectSidebar.tsx
git commit -m "feat: restructure ProjectSidebar to 230px chat-first layout"
```

---

### Task 3: ConversationHeader component

**Files:**
- Create: `src/components/ConversationHeader.tsx`

**Interfaces:**
- Consumes: `{ inspectorOpen: boolean; onToggleInspector: () => void; title?: string; }`
- Produces: Renders top bar

- [ ] **Step 1: Create ConversationHeader.tsx**

```tsx
import { PanelRightClose, PanelRightOpen, MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button";

type ConversationHeaderProps = {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  title?: string;
};

export function ConversationHeader({
  inspectorOpen,
  onToggleInspector,
  title = "New chat",
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="More options">
          <MoreHorizontal size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
          onClick={onToggleInspector}
        >
          {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add conversation header CSS**

```css
.conversation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--background);
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ConversationHeader.tsx src/index.css
git commit -m "feat: add ConversationHeader with inspector toggle"
```

---

### Task 4: AgentConversation component (main chat timeline)

**Files:**
- Create: `src/components/AgentConversation.tsx`
- Create: `src/hooks/useSmartAutoScroll.ts`
- Create: `src/components/MessageComposer.tsx`
- Create: `src/components/TimelineEvent.tsx`

- [ ] **Step 1: Create useSmartAutoScroll.ts hook**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_FOLLOW_THRESHOLD_PX = 120;

export function useSmartAutoScroll(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const lastScrollTop = useRef(0);

  const checkPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_FOLLOW_THRESHOLD_PX;
    setIsAtBottom(atBottom);
    if (!atBottom && el.scrollHeight > lastScrollTop.current) {
      setShowJumpButton(true);
    }
    lastScrollTop.current = el.scrollHeight;
  }, [containerRef]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
    setShowJumpButton(false);
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkPosition);
    return () => el.removeEventListener("scroll", checkPosition);
  }, [checkPosition]);

  return { isAtBottom, showJumpButton, scrollToBottom };
}
```

- [ ] **Step 2: Create TimelineEvent.tsx**

```tsx
import { useState } from "react";
import {
  LoaderCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode2,
  TestTube,
  User,
  Bot,
  ChevronDown,
} from "lucide-react";

type TimelineEventStatus = "pending" | "running" | "succeeded" | "warning" | "failed" | "cancelled";

type TimelineEventType = "user_message" | "assistant_text" | "tool_invocation" | "tool_result" | "file_change" | "test_result" | "warning" | "error" | "run_completion";

export type TimelineEventData = {
  id: string;
  type: TimelineEventType;
  status: TimelineEventStatus;
  label: string;
  detail?: string;
  duration?: string;
  expanded?: boolean;
};

const statusIcons: Record<TimelineEventStatus, typeof LoaderCircle> = {
  pending: LoaderCircle,
  running: LoaderCircle,
  succeeded: CheckCircle2,
  warning: AlertTriangle,
  failed: XCircle,
  cancelled: XCircle,
};

const typeIcons: Record<TimelineEventType, typeof Bot> = {
  user_message: User,
  assistant_text: Bot,
  tool_invocation: FileCode2,
  tool_result: FileCode2,
  file_change: FileCode2,
  test_result: TestTube,
  warning: AlertTriangle,
  error: XCircle,
  run_completion: CheckCircle2,
};

type TimelineEventProps = {
  event: TimelineEventData;
};

export function TimelineEvent({ event }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(event.expanded ?? false);
  const StatusIcon = statusIcons[event.status];
  const TypeIcon = typeIcons[event.type];

  return (
    <div className={`timeline-event timeline-event--${event.status}`}>
      <div className="timeline-event-header" onClick={() => event.detail && setExpanded(!expanded)}>
        <span className="timeline-event-icon">
          {event.status === "running" ? (
            <LoaderCircle className="animate-spin" size={14} />
          ) : (
            <TypeIcon size={14} />
          )}
        </span>
        <span className="timeline-event-label">{event.label}</span>
        {event.duration && (
          <span className="timeline-event-duration">{event.duration}</span>
        )}
        {event.detail && (
          <ChevronDown
            size={12}
            className={`timeline-event-chevron ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </div>
      {expanded && event.detail && (
        <div className="timeline-event-detail">{event.detail}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create MessageComposer.tsx**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { Button } from "./ui/button";

type MessageComposerProps = {
  onSend: (content: string) => void;
  onStop?: () => void;
  isRunning?: boolean;
  placeholder?: string;
};

export function MessageComposer({
  onSend,
  onStop,
  isRunning = false,
  placeholder = "What do you want to build?",
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isRunning && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isRunning]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed);
    setValue("");
  }, [value, isRunning, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="message-composer">
      <div className="message-composer-inner">
        <button
          type="button"
          className="composer-attach-button"
          aria-label="Attach files"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isRunning}
        />
        {isRunning ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onStop}
            aria-label="Stop"
            className="composer-stop-button"
          >
            <Square size={16} />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon-sm"
            onClick={handleSend}
            disabled={!value.trim()}
            aria-label="Send"
            className="composer-send-button"
          >
            <ArrowUp size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create AgentConversation.tsx**

```tsx
import { useRef } from "react";
import type { UIMessage } from "ai";
import { useSmartAutoScroll } from "../hooks/useSmartAutoScroll";
import { TimelineEvent, type TimelineEventData } from "./TimelineEvent";
import { MessageComposer } from "./MessageComposer";

type AgentConversationProps = {
  messages: UIMessage[];
  isRunning?: boolean;
  onSend: (content: string) => void;
  onStop?: () => void;
  emptyState?: React.ReactNode;
};

export function AgentConversation({
  messages,
  isRunning = false,
  onSend,
  onStop,
  emptyState,
}: AgentConversationProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, showJumpButton, scrollToBottom } = useSmartAutoScroll(scrollContainerRef);

  return (
    <div className="agent-conversation">
      <div ref={scrollContainerRef} className="agent-conversation-scroll">
        <div className="agent-conversation-content">
          {messages.length === 0 && emptyState ? (
            emptyState
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`conversation-message conversation-message--${msg.role}`}
              >
                {/* Render message parts */}
                {msg.parts?.map((part, i) => {
                  if (part.type === "text") {
                    return <p key={i} className="message-text">{part.text as string}</p>;
                  }
                  if (part.type === "tool-invocation") {
                    const toolPart = part as Record<string, unknown>;
                    return (
                      <TimelineEvent
                        key={i}
                        event={{
                          id: String(toolPart.toolCallId ?? i),
                          type: "tool_invocation",
                          status: isRunning ? "running" : "succeeded",
                          label: `Using ${String(toolPart.toolName ?? "tool")}`,
                          detail: JSON.stringify(toolPart.args, null, 2),
                        }}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {showJumpButton && (
        <button
          type="button"
          className="jump-to-latest-button"
          onClick={scrollToBottom}
        >
          Jump to latest ↓
        </button>
      )}

      <MessageComposer
        onSend={onSend}
        onStop={onStop}
        isRunning={isRunning}
      />
    </div>
  );
}
```

- [ ] **Step 5: Add CSS for conversation components**

```css
.agent-conversation {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.agent-conversation-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 0;
}

.agent-conversation-content {
  max-width: 820px;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px;
}

.conversation-message {
  margin-bottom: 16px;
}

.conversation-message--user {
  /* User messages styling */
}

.conversation-message--assistant {
  /* Assistant messages styling */
}

.message-text {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Timeline event styles */
.timeline-event {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 4px 0;
  background: var(--card);
}

.timeline-event-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
}

.timeline-event-icon {
  display: grid;
  place-items: center;
  color: var(--muted-foreground);
}

.timeline-event-label {
  flex: 1;
  font-size: 13px;
  color: var(--foreground);
}

.timeline-event-duration {
  font-size: 11px;
  color: var(--muted-foreground);
}

.timeline-event-chevron {
  color: var(--muted-foreground);
  transition: transform 0.15s;
}

.timeline-event-detail {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted-foreground);
  font-family: var(--font-code);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.timeline-event--running .timeline-event-icon {
  color: var(--primary);
}

.timeline-event--succeeded .timeline-event-icon {
  color: var(--primary);
}

.timeline-event--failed .timeline-event-icon,
.timeline-event--warning .timeline-event-icon {
  color: #f6c66f;
}

/* Composer styles */
.message-composer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--background);
  flex-shrink: 0;
}

.message-composer-inner {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  background: var(--card);
}

.composer-textarea {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--foreground);
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  max-height: 200px;
  min-height: 24px;
  font-family: inherit;
}

.composer-textarea::placeholder {
  color: var(--muted-foreground);
}

.composer-attach-button,
.composer-send-button,
.composer-stop-button {
  flex-shrink: 0;
}

.jump-to-latest-button {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--card);
  color: var(--foreground);
  font-size: 12px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.jump-to-latest-button:hover {
  background: var(--accent);
}
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/components/AgentConversation.tsx src/components/TimelineEvent.tsx src/components/MessageComposer.tsx src/hooks/useSmartAutoScroll.ts src/index.css
git commit -m "feat: add AgentConversation, TimelineEvent, MessageComposer, useSmartAutoScroll"
```

---

### Task 5: ContextInspector component (right panel)

**Files:**
- Create: `src/components/ContextInspector.tsx`

- [ ] **Step 1: Create ContextInspector.tsx**

```tsx
import { GitBranch, FileOutput, Folders, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";

export function ContextInspector() {
  return (
    <aside className="context-inspector">
      <div className="inspector-card">
        <div className="inspector-card-header">
          <GitBranch size={14} />
          <span>Environment</span>
        </div>
        <div className="inspector-card-body">
          <div className="inspector-row">
            <span className="inspector-label">Branch</span>
            <span className="inspector-value">main</span>
          </div>
          <div className="inspector-row">
            <span className="inspector-label">Changes</span>
            <span className="inspector-value">12 files</span>
          </div>
        </div>
      </div>

      <div className="inspector-card">
        <div className="inspector-card-header">
          <FileOutput size={14} />
          <span>Outputs</span>
        </div>
        <div className="inspector-card-body">
          <p className="inspector-empty">No outputs yet</p>
        </div>
      </div>

      <div className="inspector-card">
        <div className="inspector-card-header">
          <Folders size={14} />
          <span>Sources</span>
        </div>
        <div className="inspector-card-body">
          <p className="inspector-empty">No sources for this conversation</p>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Add inspector CSS**

```css
.context-inspector {
  width: 280px;
  border-left: 1px solid var(--border);
  background: var(--background);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 8px;
  overflow-y: auto;
  flex-shrink: 0;
}

.inspector-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  overflow: hidden;
}

.inspector-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted-foreground);
  border-bottom: 1px solid var(--border);
}

.inspector-card-body {
  padding: 8px 10px;
}

.inspector-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
  font-size: 12px;
}

.inspector-label {
  color: var(--muted-foreground);
}

.inspector-value {
  color: var(--foreground);
  font-weight: 500;
}

.inspector-empty {
  color: var(--muted-foreground);
  font-size: 11px;
  margin: 4px 0;
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ContextInspector.tsx src/index.css
git commit -m "feat: add ContextInspector right panel"
```

---

### Task 6: Wire AppShell into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the main agent hub view in App.tsx**

When `view === "build"`, render the new AppShell + AgentConversation instead of MissionControl. When `view === "chat"`, use AppShell + AgentConversation with chat-specific props.

The mapping:
```
view === "build" → AppShell > AgentConversation (with agent backend)
view === "chat"  → AppShell > AgentConversation (with chat backend)
```

- [ ] **Step 2: Route "orchestrate" view to the new agent chat**

When user clicks a task from sidebar, instead of showing OrchestrationPanel, navigate to `view === "build"` with the conversation context pre-populated.

- [ ] **Step 3: Hide MissionControl and OrchestrationPanel behind a VIBE_CLASSIC flag or remove**

For now, keep MissionControl importable but route the "build" view to AppShell. We can fully remove OrchestrationPanel later.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire AppShell into App.tsx as primary agent interface"
```

---

### Task 7: FileChangeCard component

**Files:**
- Create: `src/components/FileChangeCard.tsx`

- [ ] **Step 1: Create FileChangeCard.tsx**

```tsx
import { useState } from "react";
import { FileCode2, ChevronDown, Eye, Undo2 } from "lucide-react";
import { Button } from "./ui/button";

type FileChange = {
  path: string;
  additions: number;
  deletions: number;
};

type FileChangeCardProps = {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
};

const INITIAL_DISPLAY_COUNT = 4;

export function FileChangeCard({ files, totalAdditions, totalDeletions }: FileChangeCardProps) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? files : files.slice(0, INITIAL_DISPLAY_COUNT);

  return (
    <div className="file-change-card">
      <div className="file-change-card-header">
        <div className="file-change-card-summary">
          <FileCode2 size={16} />
          <span>
            Edited <strong>{files.length}</strong> file{files.length === 1 ? "" : "s"}
          </span>
          <span className="file-change-card-stats">
            <span className="text-green-400">+{totalAdditions}</span>
            <span className="text-red-400">-{totalDeletions}</span>
          </span>
        </div>
        <div className="file-change-card-actions">
          <Button variant="ghost" size="icon-sm" aria-label="Review">
            <Eye size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Undo">
            <Undo2 size={14} />
          </Button>
        </div>
      </div>
      <div className="file-change-card-list">
        {displayed.map((file) => (
          <div key={file.path} className="file-change-card-item">
            <span className="file-change-card-path">{file.path}</span>
            <span className="file-change-card-diff">
              <span className="text-green-400">+{file.additions}</span>
              <span className="text-red-400">-{file.deletions}</span>
            </span>
          </div>
        ))}
        {files.length > INITIAL_DISPLAY_COUNT && !showAll && (
          <button
            type="button"
            className="file-change-card-show-more"
            onClick={() => setShowAll(true)}
          >
            Show {files.length - INITIAL_DISPLAY_COUNT} more files
            <ChevronDown size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add FileChangeCard CSS**

```css
.file-change-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  margin: 12px 0;
  overflow: hidden;
}

.file-change-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.file-change-card-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.file-change-card-stats {
  display: flex;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
}

.file-change-card-actions {
  display: flex;
  gap: 4px;
}

.file-change-card-list {
  padding: 4px 0;
}

.file-change-card-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 12px;
  font-size: 12px;
}

.file-change-card-path {
  color: var(--foreground);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-change-card-diff {
  display: flex;
  gap: 6px;
  font-weight: 600;
  font-size: 11px;
  margin-left: 12px;
  flex-shrink: 0;
}

.file-change-card-show-more {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted-foreground);
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
}

.file-change-card-show-more:hover {
  color: var(--foreground);
  background: var(--accent);
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/FileChangeCard.tsx src/index.css
git commit -m "feat: add FileChangeCard for structured change summaries"
```

---

### Task 8: Connect composer to agent backend

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AgentConversation.tsx` (if needed)

- [ ] **Step 1: Wire onSend from AgentConversation to the existing bridge.runAgent/send**

The `onSend` handler in App.tsx should call the same agent execution path as MissionControl.send currently does. Extract the key logic:
1. Create the user message
2. Set running state
3. Call bridge.runAgent (or bridge.runChat for chat mode)
4. Stream results back
5. Generate title
6. Persist conversation

- [ ] **Step 2: Add title generation**

Create a simple title generator based on the first user message:
```ts
function generateTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 64) || "New chat";
}
```

- [ ] **Step 3: Ensure "New chat" creates a fresh empty conversation**

When user clicks "New chat" or navigates to `view === "build"` without a conversation context, show the empty state with greeting and suggestions.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: connect agent conversation to backend execution"
```

---

### Task 9: Cleanup and verification

**Files:**
- Delete: `src/components/OrchestrationPanel.tsx` (after verifying nothing depends on it)
- Modify: `src/App.tsx` — remove OrchestrationPanel import and lazy load

- [ ] **Step 1: Remove OrchestrationPanel usage from App.tsx**

Replace the `view === "orchestrate"` route with the same AppShell + AgentConversation used by `view === "build"`.

- [ ] **Step 2: Remove unused imports from App.tsx**

Remove OrchestrationPanel, IntentBriefCard, ContextIndexCard, VerificationCard, WorktreeCard, TaskLedger etc. they are no longer top-level routed views.

- [ ] **Step 3: Run full check suite**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: All pass.

- [ ] **Step 4: Run production build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git rm src/components/OrchestrationPanel.tsx
git commit -m "refactor: remove OrchestrationPanel, cleanup App.tsx imports"
```

---

### Task 10: Dynamic right inspector content

**Files:**
- Modify: `src/components/ContextInspector.tsx`

- [ ] **Step 1: Pass real workspace data to inspector**

Add props for workspace info, branch, changes count:
```tsx
type ContextInspectorProps = {
  branch?: string | null;
  changesCount?: number;
  generatedFiles?: string[];
  previewUrls?: string[];
};
```

- [ ] **Step 2: Populate cards with live data**

Environment card shows:
- Branch name from git state
- Changes count
- Build/release state (from bridge)

Outputs card shows:
- Generated files list
- Preview links

Sources card shows:
- Can be populated from conversation memory/web search results

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ContextInspector.tsx
git commit -m "feat: wire ContextInspector to live workspace data"
```
