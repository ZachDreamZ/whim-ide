/**
 * Central update service for Whim.
 *
 * One singleton store drives every update surface (Settings > Updates page and
 * the chat-first notification). It owns the full state machine, a single-flight
 * check guard, a cooldown for background startup checks, real download progress
 * events, failure-to-message mapping, and durable recovery state.
 *
 * The native Tauri updater plugin (`@tauri-apps/plugin-updater`) is the only
 * thing that performs the real work: check(), download(onEvent), install().
 * Everything here is orchestration + UX state; no successful update is ever
 * faked.
 */

import { invoke } from "@tauri-apps/api/core";
import { check as pluginCheck, type Update } from "@tauri-apps/plugin-updater";
import { bridge } from "./bridge";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "update_available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "restarting"
  | "cancelled"
  | "failed";

export type UpdateChannel = "stable" | "beta" | "nightly";

export interface UpdateSnapshot {
  status: UpdateStatus;
  native: boolean;
  currentVersion: string;
  newVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  downloadBytes: number;
  downloadTotal: number | null;
  channel: UpdateChannel;
  autoCheck: boolean;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  workActive: boolean;
  /** True while an agent run / tool call is blocking a restart. */
  notificationDismissed: boolean;
}

const COOLDOWN_MS = 6 * 60 * 60 * 1000; // once every 6 hours
const CHECK_TIMEOUT_MS = 15_000;

/** Parse "v1.2.3-beta.1" -> [1,2,3] using only the numeric base. */
function parseVersion(version: string): [number, number, number] {
  const base = String(version)
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
  const parts = base.split(".").map((part) => parseInt(part, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareVersions(current: string, available: string): number {
  const a = parseVersion(current);
  const b = parseVersion(available);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/** A version is an upgrade only when it is strictly newer and channel-legal. */
export function isUpgradeAvailable(
  current: string,
  available: string,
  channel: UpdateChannel,
): boolean {
  if (!available) return false;
  if (channel === "stable") {
    // Stable users must not receive prereleases.
    if (/-/.test(available)) return false;
    if (/-/.test(current)) return false;
  }
  return compareVersions(current, available) < 0;
}

export function describeUpdateError(error: unknown): { message: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const lower = message.toLowerCase();
  if (lower.includes("signature") || lower.includes("verify")) {
    return {
      message: "The downloaded update did not pass signature verification.",
      detail: message,
    };
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("manifest")) {
    return {
      message: "The release manifest could not be found.",
      detail: message,
    };
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("econn") ||
    lower.includes("timeout") ||
    lower.includes("connect") ||
    lower.includes("dns")
  ) {
    return {
      message: "Could not contact the update server.",
      detail: message,
    };
  }
  if (lower.includes("process") || lower.includes("another") || lower.includes("running")) {
    return {
      message: "Installation could not start because another Whim process is running.",
      detail: message,
    };
  }
  if (lower.includes("invalid") || lower.includes("parse") || lower.includes("json")) {
    return {
      message: "The release manifest is invalid.",
      detail: message,
    };
  }
  return { message: "The update check failed.", detail: message };
}

// ─── Durable state persisted through Rust (recovery + last-checked cache) ───

interface PersistedUpdateState {
  currentVersion: string;
  channel: UpdateChannel;
  autoCheck: boolean;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  downloadBytes: number | null;
  downloadTotal: number | null;
  status: UpdateStatus | null;
}

async function loadPersisted(): Promise<PersistedUpdateState | null> {
  try {
    return (await invoke("load_update_state")) as PersistedUpdateState;
  } catch {
    return null;
  }
}

async function savePersisted(state: PersistedUpdateState): Promise<void> {
  try {
    await invoke("save_update_state", { state });
  } catch {
    // Persistence is best-effort; the in-memory snapshot still drives the UI.
  }
}

// ─── Store internals ───

let pendingUpdate: Update | null = null;
let checkInFlight = false;
let initialized = false;
const listeners = new Set<() => void>();

function initialSnapshot(): UpdateSnapshot {
  return {
    status: "idle",
    native: bridge.isNative(),
    currentVersion: "0.0.0",
    newVersion: null,
    releaseDate: null,
    releaseNotes: null,
    downloadBytes: 0,
    downloadTotal: null,
    channel: "stable",
    autoCheck: true,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    errorMessage: null,
    errorDetail: null,
    workActive: false,
    notificationDismissed: false,
  };
}

let snapshot: UpdateSnapshot = initialSnapshot();

function setSnapshot(patch: Partial<UpdateSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UpdateSnapshot {
  return snapshot;
}

function snapshotToPersisted(): PersistedUpdateState {
  return {
    currentVersion: snapshot.currentVersion,
    channel: snapshot.channel,
    autoCheck: snapshot.autoCheck,
    lastCheckedAt: snapshot.lastCheckedAt,
    lastSuccessfulCheckAt: snapshot.lastSuccessfulCheckAt,
    availableVersion: snapshot.newVersion,
    releaseDate: snapshot.releaseDate,
    releaseNotes: snapshot.releaseNotes,
    downloadBytes: snapshot.downloadBytes || null,
    downloadTotal: snapshot.downloadTotal,
    status: snapshot.status === "update_available" || snapshot.status === "downloaded" || snapshot.status === "up_to_date"
      ? snapshot.status
      : null,
  };
}

function cooldownElapsed(): boolean {
  if (!snapshot.lastSuccessfulCheckAt) return true;
  const last = Date.parse(snapshot.lastSuccessfulCheckAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= COOLDOWN_MS;
}

// ─── Public actions ───

async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!snapshot.native) return;

  const persisted = await loadPersisted();
  const appVersion = await readCurrentVersion();
  const next: Partial<UpdateSnapshot> = { currentVersion: appVersion };
  if (persisted) {
    next.channel = (persisted.channel as UpdateChannel) || "stable";
    next.autoCheck = persisted.autoCheck ?? true;
    next.lastCheckedAt = persisted.lastCheckedAt ?? null;
    next.lastSuccessfulCheckAt = persisted.lastSuccessfulCheckAt ?? null;
    if (persisted.availableVersion) {
      if (isUpgradeAvailable(appVersion, persisted.availableVersion, next.channel as UpdateChannel)) {
        // Recover the "available" knowledge across restarts. The in-memory download
        // is gone after a relaunch, so surface it as update_available (re-download)
        // rather than downloaded.
        next.status = "update_available";
        next.newVersion = persisted.availableVersion;
        next.releaseDate = persisted.releaseDate ?? null;
        next.releaseNotes = persisted.releaseNotes ?? null;
      } else {
        // Already installed this (or a newer) version: show up to date, do not
        // re-offer the same version.
        next.status = "up_to_date";
        next.newVersion = null;
        next.releaseDate = null;
        next.releaseNotes = null;
      }
    } else if (persisted.lastSuccessfulCheckAt) {
      // Prior successful check with nothing newer available: surface up to date
      // immediately on restart (the startup check may be skipped by cooldown), so
      // "Last checked" stays visible without waiting for the next check.
      next.status = "up_to_date";
      next.newVersion = null;
    }
  }
  setSnapshot(next);

  // If a previously "available" version is now installed, persist the clean
  // up_to_date record immediately (the startup check below may be skipped by
  // cooldown). This keeps "Last checked" visible after a successful update.
  if (persisted && snapshot.status === "up_to_date") {
    void savePersisted(snapshotToPersisted());
  }

  // Background startup check: only if enabled, cooldown elapsed, and we are not
  // already showing an available update. Never blocks the initial window.
  const doTrigger = snapshot.autoCheck && cooldownElapsed() && snapshot.status !== "update_available";
  if (doTrigger) {
    void checkUpdate();
  }
}

async function readCurrentVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

async function checkUpdate(): Promise<void> {
  if (!snapshot.native) {
    return;
  }
  if (checkInFlight) {
    return;
  }
  checkInFlight = true;
  setSnapshot({
    status: "checking",
    errorMessage: null,
    errorDetail: null,
    notificationDismissed: false,
    lastCheckedAt: new Date().toISOString(),
  });
  try {
    const update = await pluginCheck({ timeout: CHECK_TIMEOUT_MS });
    pendingUpdate = update;
    const now = new Date().toISOString();
    if (!update) {
      // Up to date. Clear any stale available state so the same version is
      // not repeatedly offered.
      setSnapshot({
        status: "up_to_date",
        newVersion: null,
        releaseDate: null,
        releaseNotes: null,
        downloadBytes: 0,
        downloadTotal: null,
        lastSuccessfulCheckAt: now,
        errorMessage: null,
        errorDetail: null,
      });
    } else if (isUpgradeAvailable(snapshot.currentVersion, update.version, snapshot.channel)) {
      setSnapshot({
        status: "update_available",
        newVersion: update.version,
        releaseDate: update.date ?? null,
        releaseNotes: update.body ?? null,
        lastSuccessfulCheckAt: now,
        errorMessage: null,
        errorDetail: null,
      });
    } else {
      // Available version is not an upgrade for this channel (e.g. older or a
      // prerelease on stable). Treat as up to date without offering it.
      setSnapshot({
        status: "up_to_date",
        newVersion: null,
        lastSuccessfulCheckAt: now,
        errorMessage: null,
        errorDetail: null,
      });
    }
    await savePersisted(snapshotToPersisted());
  } catch (error) {
    const { message, detail } = describeUpdateError(error);
    setSnapshot({ status: "failed", errorMessage: message, errorDetail: detail });
    await savePersisted(snapshotToPersisted());
  } finally {
    checkInFlight = false;
  }
}

function onDownloadEvent(event: { event: string; data?: { contentLength?: number; chunkLength?: number } }): void {
  if (event.event === "Started") {
    setSnapshot({ downloadTotal: event.data?.contentLength ?? null, downloadBytes: 0 });
  } else if (event.event === "Progress") {
    setSnapshot({ downloadBytes: snapshot.downloadBytes + (event.data?.chunkLength ?? 0) });
  }
}

async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) {
    // No in-memory update (e.g. recovered from persisted state). Re-check first.
    await checkUpdate();
    if (!pendingUpdate) {
      setSnapshot({
        status: "failed",
        errorMessage: "Could not start the download. Run a check again.",
        errorDetail: null,
      });
      return;
    }
  }
  setSnapshot({
    status: "downloading",
    downloadBytes: 0,
    downloadTotal: null,
    errorMessage: null,
    errorDetail: null,
  });
  try {
    await pendingUpdate.download((event) => onDownloadEvent(event as never));
    setSnapshot({ status: "downloaded" });
    await savePersisted(snapshotToPersisted());
  } catch (error) {
    const { message, detail } = describeUpdateError(error);
    setSnapshot({ status: "failed", errorMessage: message, errorDetail: detail });
  }
}

async function installAndRestart(): Promise<void> {
  if (snapshot.workActive) {
    setSnapshot({
      status: "failed",
      errorMessage: "Cannot restart while a task is still running.",
      errorDetail: "Finish or cancel the active agent run before installing the update.",
    });
    return;
  }
  if (!pendingUpdate) {
    await downloadUpdate();
    if (!pendingUpdate) return;
  }
  setSnapshot({ status: "installing", errorMessage: null, errorDetail: null });
  try {
    // On Windows this launches the NSIS installer with /UPDATE and then exits
    // the process, which relaunches into the new version. The "restarting"
    // state is brief; the next process starts clean and clears stale state.
    await pendingUpdate.install();
    setSnapshot({ status: "restarting" });
  } catch (error) {
    const { message, detail } = describeUpdateError(error);
    setSnapshot({ status: "failed", errorMessage: message, errorDetail: detail });
  }
}

function setChannel(channel: UpdateChannel): void {
  setSnapshot({ channel });
  void savePersisted(snapshotToPersisted());
}

function setAutoCheck(autoCheck: boolean): void {
  setSnapshot({ autoCheck });
  void savePersisted(snapshotToPersisted());
}

function setWorkActive(workActive: boolean): void {
  setSnapshot({ workActive });
}

function dismissNotification(): void {
  setSnapshot({ notificationDismissed: true });
}

export const updateStore = {
  init,
  checkUpdate,
  downloadUpdate,
  installAndRestart,
  setChannel,
  setAutoCheck,
  setWorkActive,
  dismissNotification,
  subscribe,
  getSnapshot,
};

import { useSyncExternalStore } from "react";

/** Subscribe a React component to the update service snapshot. */
export function useUpdate(): UpdateSnapshot {
  return useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot,
    updateStore.getSnapshot,
  );
}
