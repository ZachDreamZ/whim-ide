# Visual/UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** View transitions, Geist font, Tailwind theme tokens, collapsible focus, focus rings.

**Architecture:** CSS changes in index.css and App.css, component changes in App.tsx, Collapsible.tsx, VoiceOrb.tsx.

**Spec:** `docs/superpowers/specs/2026-07-17-visual-ui-polish-design.md`

## Global Constraints

- Must pass `npm run check` (typecheck + lint + test)
- Must not break existing animations or transitions
- Tailwind v4 `@theme inline` syntax

---

### Task 1: Geist Font Import

**Files:**
- Modify: `src/index.css`

- [ ] Add `@import "@fontsource-variable/geist";` at the top of `src/index.css` after the existing font imports (around line 1-3)
- [ ] Run `npm run check`
- [ ] Commit: `git add src/index.css && git commit -m "fix: import Geist font variable so AppearanceSettings font option works"`

---

### Task 2: Tailwind Theme Tokens

**Files:**
- Modify: `src/index.css`

- [ ] In the `@theme inline` block (current only has `--font-heading`, `--font-sans`, `--color-border`, `--color-ring`, radius tokens), add the semantic color mappings:

```css
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-border: var(--border);
--color-ring: var(--ring);
```

Note: `--color-border` and `--color-ring` are already in the block — update them to use `var(--border)` and `var(--ring)` for consistency.

- [ ] Run `npm run check`
- [ ] Commit: `git add src/index.css && git commit -m "feat: expose semantic color tokens in Tailwind theme"`

---

### Task 3: View Transitions

**Files:**
- Modify: `src/App.tsx`

- [ ] Import `AnimatePresence` and `motion` from `motion/react` (or `motion` depending on project convention)
- [ ] Wrap the conditional view rendering block in `<AnimatePresence mode="wait">`
- [ ] Wrap each view in `<motion.div key={view}>` with:
  - `initial={{ opacity: 0, y: 8 }}`
  - `animate={{ opacity: 1, y: 0 }}`
  - `exit={{ opacity: 0, y: -8 }}`
  - `transition={{ duration: 0.15 }}`
- [ ] Run `npm run check`
- [ ] Commit: `git add src/App.tsx && git commit -m "feat: add AnimatePresence view transitions between hubs"`

---

### Task 4: Collapsible Focus/Hover

**Files:**
- Modify: `src/components/ui/collapsible.tsx`

- [ ] Add focus-visible ring, hover background, and transition to the collapsible trigger button.
- [ ] Run `npm run check`
- [ ] Commit: `git add src/components/ui/collapsible.tsx && git commit -m "fix: add focus-visible ring and hover state to collapsible trigger"`

---

### Task 5: Focus Rings

**Files:**
- Modify: `src/components/ui/VoiceOrb.tsx` (or `src/App.css` if styles in CSS)
- Modify: `src/components/Titlebar.tsx` (or `src/App.css` for window controls)

- [ ] Add `focus-visible:ring-2 focus-visible:ring-ring/50` to VoiceOrb buttons
- [ ] Add `focus-visible` ring to titlebar window control buttons
- [ ] Run `npm run check`
- [ ] Commit: `git add src/components/ui/VoiceOrb.tsx src/components/Titlebar.tsx && git commit -m "fix: add focus-visible rings to VoiceOrb and titlebar controls"`
