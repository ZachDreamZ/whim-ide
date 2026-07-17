# Visual/UI Polish — Design Spec

**Project**: Whim IDE (v0.4.0)
**Date**: 2026-07-17
**Status**: Approved design

## Goal

Add view transitions, fix font loading, expose Tailwind theme tokens, and fill hover/focus gaps on interactive elements.

## 1. View Transitions (P1)

Wrap App.tsx's conditional view rendering with `AnimatePresence` + `motion.div` for fade+slide-enter/exit between hubs (MissionControl, ChatHub, ProviderHub, EcosystemHub, ShipHub, AutopilotHub).

## 2. Geist Font Import (P1)

Add `@import "@fontsource-variable/geist";` to `src/index.css` so the AppearanceSettings font option works.

## 3. Tailwind Theme Tokens (P2)

Map semantic CSS custom properties in `@theme inline` block in `src/index.css`:
- `--color-background`, `--color-foreground`, `--color-primary`, `--color-primary-foreground`, `--color-secondary`, `--color-secondary-foreground`, `--color-muted`, `--color-muted-foreground`, `--color-card`, `--color-card-foreground`, `--color-popover`, `--color-popover-foreground`, `--color-border`, `--color-ring`, `--color-accent`, `--color-accent-foreground`, `--color-destructive`, `--color-destructive-foreground`

## 4. Collapsible Component (P2)

Add `focus-visible:ring`, hover state, and transition to the collapsible trigger.

## 5. Focus Rings (P3)

- VoiceOrb buttons: add `focus-visible:ring`
- Titlebar window controls: add `focus-visible` ring styling

## Acceptance criteria

1. `npm run check` passes
2. App.tsx views animate on switch (fade+slide)
3. Geist font loads and is usable
4. `bg-background` Tailwind class resolves
5. Collapsible trigger has visible focus ring
6. VoiceOrb buttons have focus ring
