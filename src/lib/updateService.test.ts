import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri runtime so the store can be exercised without a native app.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }));
vi.mock("./bridge", () => ({ bridge: { isNative: () => true } }));

import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import * as Update from "./updateService";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const checkMock = check as unknown as ReturnType<typeof vi.fn>;

/** Re-import the module to get a fresh singleton store per test. */
async function loadStore() {
  vi.resetModules();
  return (await import("./updateService")) as typeof Update;
}

function persisted(overrides: Record<string, unknown> = {}) {
  return {
    currentVersion: "0.4.0",
    channel: "stable",
    autoCheck: true,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    availableVersion: null,
    releaseDate: null,
    releaseNotes: null,
    downloadBytes: null,
    downloadTotal: null,
    status: null,
    ...overrides,
  };
}

describe("version comparison (semver, not lexicographic)", () => {
  it("treats 0.4.10 as newer than 0.4.9", () => {
    expect(Update.compareVersions("0.4.9", "0.4.10")).toBeLessThan(0);
    expect(Update.compareVersions("0.4.10", "0.4.9")).toBeGreaterThan(0);
  });

  it("treats 1.0.0 as newer than 0.99.0", () => {
    expect(Update.compareVersions("0.99.0", "1.0.0")).toBeLessThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(Update.compareVersions("0.4.0", "0.4.0")).toBe(0);
  });

  it("strips a leading v and a prerelease suffix before comparing", () => {
    expect(Update.compareVersions("v0.4.9", "0.4.10")).toBeLessThan(0);
    // Prerelease suffix is stripped, so the numeric base equals the release.
    expect(Update.compareVersions("0.4.9-beta.1", "0.4.9")).toBe(0);
  });
});

describe("isUpgradeAvailable (channel gating)", () => {
  it("stable users do not receive prereleases", () => {
    expect(Update.isUpgradeAvailable("0.4.0", "0.5.0-beta.1", "stable")).toBe(false);
    expect(Update.isUpgradeAvailable("0.5.0-beta.1", "0.5.0-beta.2", "stable")).toBe(false);
  });

  it("prerelease channels may receive prereleases", () => {
    expect(Update.isUpgradeAvailable("0.4.0", "0.5.0-beta.1", "beta")).toBe(true);
    expect(Update.isUpgradeAvailable("0.4.0", "0.5.0-nightly.3", "nightly")).toBe(true);
  });

  it("only a strictly newer version is an upgrade", () => {
    expect(Update.isUpgradeAvailable("0.4.0", "0.4.0", "stable")).toBe(false);
    expect(Update.isUpgradeAvailable("0.5.0", "0.4.9", "stable")).toBe(false);
  });

  it("a local dev build is not downgraded by an older release", () => {
    expect(Update.isUpgradeAvailable("0.5.0", "0.4.1", "stable")).toBe(false);
  });
});

describe("describeUpdateError (failure -> user message)", () => {
  it("maps signature failures clearly", () => {
    const { message } = Update.describeUpdateError(new Error("signature verification failed"));
    expect(message).toMatch(/signature verification/i);
  });

  it("maps missing manifest / 404", () => {
    const { message } = Update.describeUpdateError(new Error("request failed: 404 Not Found"));
    expect(message).toMatch(/release manifest/i);
  });

  it("maps network errors", () => {
    const { message } = Update.describeUpdateError(new Error("failed to connect: ECONNREFUSED"));
    expect(message).toMatch(/contact the update server/i);
  });

  it("maps malformed manifest", () => {
    const { message } = Update.describeUpdateError(new Error("could not parse json"));
    expect(message).toMatch(/invalid/i);
  });

  it("falls back to a generic message", () => {
    const { message } = Update.describeUpdateError(new Error("something odd happened"));
    expect(message).toMatch(/update check failed/i);
  });
});

describe("store state machine", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    checkMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("check with no newer version -> up_to_date and caches last successful check", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    await S.updateStore.checkUpdate();
    const snap = S.updateStore.getSnapshot();

    expect(snap.status).toBe("up_to_date");
    expect(snap.newVersion).toBeNull();
    expect(snap.lastSuccessfulCheckAt).not.toBeNull();
    expect(snap.errorMessage).toBeNull();
  });

  it("check with a newer version -> update_available with details", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockResolvedValue({
      version: "0.4.1",
      date: "2026-07-17T12:00:00Z",
      body: "Improved update reliability.",
    });

    await S.updateStore.init();
    await S.updateStore.checkUpdate();
    const snap = S.updateStore.getSnapshot();

    expect(snap.status).toBe("update_available");
    expect(snap.newVersion).toBe("0.4.1");
    expect(snap.releaseDate).toBe("2026-07-17T12:00:00Z");
    expect(snap.releaseNotes).toBe("Improved update reliability.");
  });

  it("failed check -> failed, never up_to_date", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockRejectedValue(new Error("failed to contact the update server: ECONNREFUSED"));

    await S.updateStore.init();
    await S.updateStore.checkUpdate();
    const snap = S.updateStore.getSnapshot();

    expect(snap.status).toBe("failed");
    expect(snap.errorMessage).toMatch(/contact the update server/i);
    expect(snap.errorDetail).toMatch(/ECONNREFUSED/);
  });

  it("single-flight: concurrent checks run the native check exactly once", async () => {
    const S = await loadStore();
    let calls = 0;
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockImplementation(async () => {
      calls += 1;
      return null;
    });

    await S.updateStore.init();
    await Promise.all([S.updateStore.checkUpdate(), S.updateStore.checkUpdate(), S.updateStore.checkUpdate()]);

    expect(calls).toBe(1);
    expect(S.updateStore.getSnapshot().status).toBe("up_to_date");
  });

  it("download shows progress then downloaded", async () => {
    const S = await loadStore();
    const fakeUpdate = {
      version: "0.4.1",
      date: "2026-07-17T12:00:00Z",
      body: "notes",
      download: vi.fn(async (onEvent: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 60 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
      }),
      install: vi.fn(async () => {}),
    };
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockResolvedValue(fakeUpdate);

    await S.updateStore.init();
    await S.updateStore.checkUpdate();
    expect(S.updateStore.getSnapshot().status).toBe("update_available");

    await S.updateStore.downloadUpdate();
    const snap = S.updateStore.getSnapshot();
    expect(snap.status).toBe("downloaded");
    expect(snap.downloadBytes).toBe(100);
    expect(snap.downloadTotal).toBe(100);
    expect(fakeUpdate.download).toHaveBeenCalledOnce();
  });

  it("install and restart gates on active work and transitions to restarting", async () => {
    const S = await loadStore();
    let installed = false;
    const fakeUpdate = {
      version: "0.4.1",
      date: null,
      body: null,
      download: vi.fn(async () => {}),
      install: vi.fn(async () => {
        installed = true;
      }),
    };
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "load_update_state" ? persisted() : undefined));
    checkMock.mockResolvedValue(fakeUpdate);

    await S.updateStore.init();
    await S.updateStore.checkUpdate();
    await S.updateStore.downloadUpdate();

    // Blocked while work is active.
    S.updateStore.setWorkActive(true);
    await S.updateStore.installAndRestart();
    expect(installed).toBe(false);
    expect(S.updateStore.getSnapshot().status).toBe("failed");

    // Allowed when idle.
    S.updateStore.setWorkActive(false);
    await S.updateStore.installAndRestart();
    expect(installed).toBe(true);
    expect(S.updateStore.getSnapshot().status).toBe("restarting");
  });
});

describe("cooldown and recovery", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    checkMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("background check is skipped while cooldown is active", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_update_state"
        ? persisted({ lastSuccessfulCheckAt: new Date().toISOString() })
        : undefined,
    );
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("background check runs once the cooldown has elapsed", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_update_state"
        ? persisted({ lastSuccessfulCheckAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() })
        : undefined,
    );
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    expect(checkMock).toHaveBeenCalled();
  });

  it("surfaces up_to_date on restart when a prior successful check left nothing available", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_update_state"
        ? persisted({ lastSuccessfulCheckAt: new Date().toISOString(), availableVersion: null })
        : undefined,
    );
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    const snap = S.updateStore.getSnapshot();
    expect(snap.status).toBe("up_to_date");
    expect(snap.newVersion).toBeNull();
    expect(snap.errorMessage).toBeNull();
  });

  it("recovers a known available version across a restart", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "load_update_state"
        ? persisted({ availableVersion: "0.4.1", releaseDate: "2026-07-17T12:00:00Z", releaseNotes: "notes" })
        : undefined,
    );
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    const snap = S.updateStore.getSnapshot();
    expect(snap.status).toBe("update_available");
    expect(snap.newVersion).toBe("0.4.1");
  });

  it("replaces a stale available record with up_to_date when the running build is already current or newer", async () => {
    const S = await loadStore();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "load_update_state") return persisted({ availableVersion: "0.4.0" });
      return undefined;
    });
    checkMock.mockResolvedValue(null);

    await S.updateStore.init();
    const snap = S.updateStore.getSnapshot();
    expect(snap.status).toBe("up_to_date");
    expect(snap.newVersion).toBeNull();
    // The stale offer is replaced (not merely deleted) so "Last checked" survives.
    expect(invokeMock).toHaveBeenCalledWith("save_update_state", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("clear_update_state");
  });
});
