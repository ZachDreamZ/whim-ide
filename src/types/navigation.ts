/**
 * Workspace view identifiers.
 *
 * Centralized here so the app shell, sidebar, and command palette share one
 * source of truth. Only views that App actually renders belong in this union.
 */
export type ViewId =
  | "services"
  | "build"
  | "scheduled"
  | "plugins"
  | "sites"
  | "pullRequests"
  | "chat"
  | "browser"
  | "creative"
  | "providers"
  | "ecosystem"
  | "ship"
  | "autopilot"
  | "settings";
