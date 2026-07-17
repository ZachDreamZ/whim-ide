# Whim Chat-First Agent Interface — Design Spec

## Overview

Replace Whim's current "Compose a task / Active tasks" experience with a polished, chat-first coding-agent interface. The final experience is a professional desktop coding agent: New chat → clean agent conversation → user sends goal → agent executes inside conversation → progress, tools, edits, errors, results all in that conversation.

## Architecture

### Layout Shell

Three-column application shell using CSS Grid:

```
rightInspectorOpen
  ? grid-template-columns: 230px minmax(0, 1fr) 280px
  : grid-template-columns: 230px minmax(0, 1fr)
```

- Left sidebar: 230px fixed
- Main chat: flexible, centered content at 720-820px preferred / 900px max
- Right inspector: 280px, conditionally rendered (not just hidden)
- All columns independently scrollable
- No page-level horizontal scrolling
- Dark desktop-native appearance with thin borders and rounded cards

### Component Tree

```
AppShell (App.tsx refactor)
├── ProjectSidebar (left, 230px)
├── main.chat-column
│   ├── ConversationHeader (top bar)
│   ├── AgentConversation (scrollable chat area)
│   │   ├── TimelineEvent[] (user msg, assistant text, tool event, file change, test result, error)
│   │   └── SmartAutoScroll behavior
│   ├── FileChangeCard (structured change summary)
│   └── MessageComposer (sticky bottom)
└── ContextInspector (right, 280px, conditional)
    ├── Environment card
    ├── Outputs card
    └── Sources card
```

### Data Model

Three related but distinct concepts:

1. **Conversation** — User-visible chat history
   - id, title, projectId, createdAtMs, updatedAtMs, messages[]
   - activeRunId reference

2. **AgentRun** — Execution lifecycle
   - id, conversationId, status, parentRunId
   - toolCalls, events[], cancellation state
   - usage, error info, duration
   - Child run references

3. **TimelineEvent** — Items rendered in the conversation
   - type: user_message | assistant_text | tool_invocation | tool_result | file_change | test_result | warning | error | run_completion
   - status: pending | running | succeeded | warning | failed | cancelled
   - Compact default, expandable

**Flow**: User sends message → create/modify Conversation → persist user message → create parent AgentRun → stream run events into conversation → generate title → update route → keep UI mounted.

## Detailed Component Specs

### 1. Left Sidebar (ProjectSidebar.tsx)

Structure:
```
TOP
  Whim (product name)
  [Search button]
  [New chat] — primary action
  Scheduled
  Plugins

PINNED
  Pinned conversations/goals

PROJECTS (expandable folders)
  whim-ide
    Fix hanging features and bugs
    Transform Whim IDE platform
  signalos
    Analyze this project

GENERAL CHATS
  Create autonomous assistant
  Build GitHub code scraper
  Review IMRAD gaps

BOTTOM
  Current account/workspace
  Settings
  Usage indicator
```

- Each conversation uses a generated title from first meaningful user request
- No "continue" or repeated low-information entries
- Resize from current 268px to 230px
- Replace `Collapsible` sections with cleaner folder UI
- Replace `ScrollArea` with native scroll

### 2. Top Bar (ConversationHeader.tsx)

Compact bar containing:
- Current conversation title
- Optional project/folder icon
- Overflow menu (rename, delete, export)
- Button to toggle right inspector
- Minimal separator below the bar

No large dashboard heading. Uses shadcn-like styling matching app theme.

### 3. Main Agent Conversation (AgentConversation.tsx)

Real conversation timeline rendering:
- User messages
- Assistant progress updates
- Assistant final responses
- Tool activity (reads, edits, tests, search)
- File edits and results
- Errors and recovery attempts
- File change summaries
- Sources and citations
- Runtime duration
- Stop and retry controls

Content width: 720-820px preferred, 900px max, centered. Wider cards may extend slightly.

States: loading, streaming, complete, error, empty (greeting)

### 4. Verbose Response Style

Rich user-facing execution summaries:
- What was completed
- What changed
- Files created/modified
- Implementation explanation
- Verification performed
- Test results
- Remaining limitations
- Next recommended steps

No chain-of-thought, no private scratchpad reasoning.

### 5. Live Execution Timeline (TimelineEvent.tsx)

Compact event cards with:
- Icon + label
- Status (pending/running/succeeded/warning/failed/cancelled)
- Expandable details
- In-place updates (no duplicate events)
- Duration

Recoverable failures don't mark the entire run as failed. Show:
"An execution step failed. The agent is inspecting the failure and attempting recovery."
Raw logs under "View details" section.

### 6. File Change Card (FileChangeCard.tsx)

Structured summary:
```
Edited 17 files                    Undo  Review
+802  -42
───────────────────────────────────────────────
src/components/ProjectSidebar.tsx      +288  -3
src/App.tsx                             +39 -26
...
Show 14 more files
```

- Number of files edited
- Total additions/deletions
- Short initial file list with "Show more"
- "Review" button opens diff view
- "Undo" only when safe undo is supported
- Clicking a file opens its diff/editor view

### 7. Right Context Inspector (ContextInspector.tsx)

Optional, collapsible (280px). Cards:

**ENVIRONMENT**
- Changes (number, summary)
- Local/linked state
- Current branch
- Commit/push status
- Compare branch
- Build/release state

**OUTPUTS**
- Generated files
- Sites/preview links
- Artifacts

**SOURCES**
- Web search results
- Documentation references
- Memory items
- Repository context

No empty region → removed from layout when closed. Preserves width on reopen.

### 8. Message Composer (MessageComposer.tsx)

Sticky at bottom of middle column. Contains:
- Multiline text input (expands vertically, max height then scrollable)
- Add/attachment button (+)
- Agent mode or custom-instruction control
- Optional provider/model selector
- Microphone (if supported)
- Send button
- Stop button (while agent running)

Width same as conversation. Stays visible while reading latest response.
Focus auto-regains after send, auto-focuses on new chat.
No separate task form required before sending.

### 9. Smart Auto-Scroll (useSmartAutoScroll.ts hook)

- Automatically follows new output when user is near bottom (~120px threshold)
- Handles streamed tokens, tool events, markdown, code blocks, file cards
- Pauses when user scrolls upward
- Preserves reading position on pause
- Shows "Jump to latest" button when new content arrives while paused
- Resumes on: scroll to bottom, click "Jump to latest", send message, new conversation

### 10. New Task → Agent Chat Flow

Replace:
```
New task → Compose a task (textarea, mode, provider, model) → Create task → Active tasks board → separate execution screen
```

With:
```
New chat → empty Agent Chat opens → composer focused → user sends instruction → backend creates conversation+run → execution streams into conversation
```

Conceptual transaction:
1. User submits first message
2. Create one conversation
3. Persist user message
4. Create one parent agent run
5. Stream run events into conversation
6. Generate meaningful title
7. Replace `/chat/new` with `/chat/{conversationId}`
8. Keep UI mounted (no interruption)

### 11. Multi-Agent Presentation

Child agents appear as compact expandable entries inside the same Agent Chat:
```
Delegated to code-analysis agent
  Inspecting routing and session creation
Delegated to UI-validation agent
  Checking clipping and responsive layout
```

Child results return to parent. Parent provides final response.
No sidebar conversations for child-agent messages.

## Files to Create/Modify

### New files
- `src/components/ConversationHeader.tsx` — Top bar
- `src/components/AgentConversation.tsx` — Main chat timeline
- `src/components/ContextInspector.tsx` — Right panel
- `src/components/FileChangeCard.tsx` — File change summary
- `src/components/MessageComposer.tsx` — Sticky input
- `src/components/TimelineEvent.tsx` — Individual event renderer
- `src/hooks/useSmartAutoScroll.ts` — Auto-scroll hook
- `src/components/AppShell.tsx` — New layout shell

### Modified files
- `src/App.tsx` — Use AppShell instead of current layout
- `src/components/ProjectSidebar.tsx` — Restructure to 230px spec
- `src/App.css` / `src/index.css` — New layout CSS, remove old orchestration CSS
- `src/lib/bridge.ts` — May need timeline event types

### Removed/deprecated
- `OrchestrationPanel.tsx` — Replaced by chat flow
- Various orchestration-specific CSS classes from App.css

## Non-Goals
- Changing the underlying orchestration engine (it remains, behind Agent Chat)
- Changing the Rust backend agent harness
- Changing the provider management UI (moved to settings)
- Adding actual file system undo (only UI for it)
- Cross-platform Tauri changes

## Verification
- TypeScript compiles with zero errors
- Existing frontend tests pass
- Production build succeeds
- No console errors in runtime
- Left sidebar matches spec structure
- Right inspector collapses and removes from grid
- Composer is sticky at bottom
- Auto-scroll follows output when at bottom
- New chat opens empty conversation with focused composer
- No duplicate "continue" conversations created
