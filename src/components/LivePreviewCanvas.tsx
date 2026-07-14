import { useRef, useState } from "react";
import { Maximize2, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";

type PreviewDevice = "desktop" | "tablet" | "mobile";

const widths: Record<PreviewDevice, string> = {
  desktop: "w-full",
  tablet: "w-[768px]",
  mobile: "w-[375px]",
};

export function LivePreviewCanvas({ url, title = "Local preview" }: { url?: string | null; title?: string }) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [reloadKey, setReloadKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="flex flex-col w-full h-full bg-card rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[#2d2d2d] border-b border-white/5">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white/80">{title}</div>
          <div className="truncate text-[10px] text-white/40">{url ?? "No preview server connected"}</div>
        </div>
        <div className="flex items-center gap-1">
          {(["desktop", "tablet", "mobile"] as const).map((option) => {
            const Icon = option === "desktop" ? Monitor : option === "tablet" ? Tablet : Smartphone;
            return (
              <button
                key={option}
                type="button"
                disabled={!url}
                onClick={() => setDevice(option)}
                aria-label={`${option} preview`}
                aria-pressed={device === option}
                className={`p-1.5 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${device === option ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              >
                <Icon size={14} />
              </button>
            );
          })}
          <button type="button" disabled={!url} onClick={() => setReloadKey((value) => value + 1)} aria-label="Reload preview" className="p-1.5 rounded text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
            <RefreshCw size={14} />
          </button>
          <button type="button" disabled={!url} onClick={() => void containerRef.current?.requestFullscreen()} aria-label="Open preview fullscreen" className="p-1.5 rounded text-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#1a1a1a] p-4 flex items-center justify-center">
        {url ? (
          <div className={`h-full ${widths[device]} min-w-0 bg-white rounded-md overflow-hidden shadow-lg transition-[width] duration-200 border border-white/20`}>
            <iframe key={`${url}-${reloadKey}`} src={url} className="w-full h-full bg-white" title="Local application preview" />
          </div>
        ) : (
          <div className="max-w-sm rounded-lg border border-dashed border-white/10 bg-white/[0.025] p-6 text-center">
            <Monitor size={22} className="mx-auto mb-3 text-white/35" />
            <h3 className="text-sm font-medium text-white/80">No local preview is running</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/45">Ask Whim to run the local preview. This panel connects only after the native agent reports an actual localhost URL.</p>
          </div>
        )}
      </div>
    </div>
  );
}
