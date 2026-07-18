import { useState } from "react";
import { AlertTriangle, Check, Download, RefreshCw } from "lucide-react";
import { SettingsRow } from "../SettingsRow";
import { updateStore, useUpdate, type UpdateChannel } from "../../../lib/updateService";

function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function downloadPercent(downloaded: number, total: number | null): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

const CHANNEL_OPTIONS: UpdateChannel[] = ["stable", "beta", "nightly"];

export function UpdatesSettings() {
  const update = useUpdate();
  const [showNotes, setShowNotes] = useState(false);

  const isBusy =
    update.status === "checking" ||
    update.status === "downloading" ||
    update.status === "installing" ||
    update.status === "restarting";

  const downloadSize = update.downloadTotal
    ? formatBytes(update.downloadTotal)
    : null;
  const downloadedSoFar = formatBytes(update.downloadBytes);
  const percent = downloadPercent(update.downloadBytes, update.downloadTotal);
  const lastCheckedLabel = formatDate(update.lastCheckedAt);

  const onPrimaryAction = () => {
    if (update.status === "downloaded") void updateStore.installAndRestart();
    else if (update.status === "update_available") void updateStore.downloadUpdate();
    else void updateStore.checkUpdate();
  };

  return (
    <div className="mx-auto max-w-[760px] px-10 py-12">
      <header className="mb-9">
        <h1 className="text-2xl font-medium text-white">Updates</h1>
        <p className="mt-2 text-sm text-white/50">
          Keep Whim current with signed, verified releases for your platform.
        </p>
      </header>

      {/* About */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]">
          <RefreshCw size={15} /> About
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
          <SettingsRow
            label="Current version"
            description={update.native ? `Whim ${update.currentVersion}` : "Native app required for updates"}
            control={{ type: "custom", node: <span className="text-xs text-white/40">{update.native ? update.currentVersion : "—"}</span> }}
          />
          <SettingsRow
            label="Update channel"
            description="Beta and nightly share the stable release stream until a dedicated channel manifest is published."
            control={{
              type: "select",
              value: update.channel,
              options: CHANNEL_OPTIONS,
              onChange: (value) => updateStore.setChannel(value as UpdateChannel),
            }}
          />
          <SettingsRow
            label="Automatic update checks"
            description="Check in the background a few hours after the last successful check."
            control={{
              type: "toggle",
              value: update.autoCheck,
              onChange: (value) => updateStore.setAutoCheck(value),
            }}
          />
          <SettingsRow
            label="Last checked"
            description={lastCheckedLabel ? `Next automatic check respects the cooldown.` : "Not checked yet"}
            control={{ type: "custom", node: <span className="text-xs text-white/40">{lastCheckedLabel ?? "—"}</span> }}
            borderBottom={false}
          />
        </div>
      </section>

      {/* Status */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]">
          <Download size={15} /> Status
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
          <StatusContent
            update={update}
            percent={percent}
            downloadedSoFar={downloadedSoFar}
            downloadSize={downloadSize}
            showNotes={showNotes}
            setShowNotes={setShowNotes}
            isBusy={isBusy}
            onPrimaryAction={onPrimaryAction}
          />
        </div>
      </section>
    </div>
  );
}

interface StatusContentProps {
  update: ReturnType<typeof useUpdate>;
  percent: number;
  downloadedSoFar: string | null;
  downloadSize: string | null;
  showNotes: boolean;
  setShowNotes: (value: boolean) => void;
  isBusy: boolean;
  onPrimaryAction: () => void;
}

function StatusContent({
  update,
  percent,
  downloadedSoFar,
  downloadSize,
  showNotes,
  setShowNotes,
  isBusy,
  onPrimaryAction,
}: StatusContentProps) {
  const lastSuccessLabel = formatDate(update.lastSuccessfulCheckAt);

  if (!update.native) {
    return (
      <SettingsRow
        label="Updates require the desktop app"
        description="Open Whim from the installed application to check for and install updates."
        control={{ type: "custom", node: null }}
        borderBottom={false}
      />
    );
  }

  switch (update.status) {
    case "idle":
      return (
        <SettingsRow
          label="Updates are checked automatically"
          description="You can also check manually."
          control={{
            type: "custom",
            node: (
              <button className="text-xs text-blue-400 hover:text-blue-300" onClick={onPrimaryAction}>
                Check for updates
              </button>
            ),
          }}
          borderBottom={false}
        />
      );

    case "checking":
      return (
        <SettingsRow
          label="Checking for updates…"
          description="Contacting update server"
          control={{ type: "custom", node: <span className="text-xs text-white/40">Checking…</span> }}
          borderBottom={false}
        />
      );

    case "up_to_date":
      return (
        <SettingsRow
          label="You’re using the latest version of Whim"
          description={
            lastSuccessLabel
              ? `Version ${update.currentVersion} · checked ${lastSuccessLabel}`
              : `Version ${update.currentVersion}`
          }
          control={{
            type: "custom",
            node: (
              <button className="text-xs text-blue-400 hover:text-blue-300" onClick={onPrimaryAction}>
                Check again
              </button>
            ),
          }}
          borderBottom={false}
        />
      );

    case "update_available":
      return (
        <>
          <SettingsRow
            label={`Whim ${update.newVersion} is available`}
            description={
              `Current ${update.currentVersion} → ${update.newVersion}` +
              (formatDate(update.releaseDate) ? ` · ${formatDate(update.releaseDate)}` : "")
            }
            control={{
              type: "custom",
              node: (
                <button
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded disabled:opacity-50"
                  onClick={onPrimaryAction}
                  disabled={isBusy}
                >
                  Download update
                </button>
              ),
            }}
          />
          {update.releaseNotes && (
            <>
              <SettingsRow
                label="Release notes"
                description={showNotes ? update.releaseNotes : update.releaseNotes.slice(0, 140) + (update.releaseNotes.length > 140 ? "…" : "")}
                control={{
                  type: "custom",
                  node: (
                    <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => setShowNotes(!showNotes)}>
                      {showNotes ? "Hide" : "View release notes"}
                    </button>
                  ),
                }}
                borderBottom={false}
              />
            </>
          )}
        </>
      );

    case "downloading":
      return (
        <SettingsRow
          label={`Downloading update — ${percent}%`}
          description={`${downloadedSoFar ?? "0 B"}${downloadSize ? ` of ${downloadSize}` : ""} · transfer in progress`}
          control={{
            type: "custom",
            node: (
              <span className="text-xs text-white/40">
                <Check size={13} className="inline mr-1" />
                {percent}%
              </span>
            ),
          }}
          borderBottom={false}
        >
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${percent}%` }} />
          </div>
        </SettingsRow>
      );

    case "downloaded":
      return (
        <SettingsRow
          label={`Whim ${update.newVersion} is ready to install`}
          description={
            update.workActive
              ? "Finish the active task, then install and restart."
              : "Install now to restart into the new version."
          }
          control={{
            type: "custom",
            node: (
              <button
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded disabled:opacity-50"
                onClick={onPrimaryAction}
                disabled={update.workActive || isBusy}
              >
                Install and restart
              </button>
            ),
          }}
          borderBottom={false}
        />
      );

    case "installing":
    case "restarting":
      return (
        <SettingsRow
          label="Installing update"
          description="Whim will restart when finished."
          control={{ type: "custom", node: <span className="text-xs text-white/40">Installing…</span> }}
          borderBottom={false}
        />
      );

    case "failed":
      return (
        <>
          <SettingsRow
            label="Update check failed"
            description={update.errorMessage ?? "The update could not be completed."}
            control={{
              type: "custom",
              node: (
                <button className="text-xs text-blue-400 hover:text-blue-300" onClick={onPrimaryAction}>
                  Retry
                </button>
              ),
            }}
          />
          {update.errorDetail && (
            <SettingsRow
              label="Technical details"
              description={update.errorDetail}
              control={{ type: "custom", node: <AlertTriangle size={14} className="text-amber-400" /> }}
              borderBottom={false}
            />
          )}
        </>
      );

    default:
      return (
        <SettingsRow
          label="Updates are checked automatically"
          description="You can also check manually."
          control={{
            type: "custom",
            node: (
              <button className="text-xs text-blue-400 hover:text-blue-300" onClick={onPrimaryAction}>
                Check for updates
              </button>
            ),
          }}
          borderBottom={false}
        />
      );
  }
}
