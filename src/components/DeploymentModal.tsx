import { useMemo, useState } from "react";
import { Rocket, LoaderCircle, X, CheckCircle, AlertCircle, Globe2, Sparkles, Cloud, Layers3, Container, type LucideIcon } from "lucide-react";
import { bridge, errorMessage } from "../lib/bridge";

type Props = {
  workspace: string;
  onClose: () => void;
};

type DeployAdapter = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
};

const adapters: DeployAdapter[] = [
  { id: "vercel", name: "Vercel", description: "Framework-aware preview deployments", icon: Globe2, color: "#f5f5f5" },
  { id: "netlify", name: "Netlify", description: "Sites, functions, and deploy previews", icon: Sparkles, color: "#55e6cf" },
  { id: "cloudflare", name: "Cloudflare", description: "Workers, Pages, D1, and R2", icon: Cloud, color: "#ff9e45" },
  { id: "render", name: "Render", description: "Blueprint-backed apps and databases", icon: Layers3, color: "#8976ff" },
  { id: "railway", name: "Railway", description: "Services from source or containers", icon: Rocket, color: "#b08cff" },
  { id: "fly", name: "Fly.io", description: "Global apps built from OCI images", icon: Globe2, color: "#8b9cff" },
  { id: "docker", name: "Docker", description: "Portable local or self-hosted delivery", icon: Container, color: "#5daeff" },
];

const previewTargets = new Set(["vercel", "netlify", "cloudflare", "railway"]);

export function DeploymentModal({ workspace, onClose }: Props) {
  const [adapterId, setAdapterId] = useState("vercel");
  const [mode, setMode] = useState<"preview" | "production">("preview");
  const [preflightStatus, setPreflightStatus] = useState<"idle" | "checking" | "ready" | "blocked">("idle");
  const [deployStatus, setDeployStatus] = useState<"idle" | "deploying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [url, setUrl] = useState<string | null>(null);
  const [productionConfirmed, setProductionConfirmed] = useState(false);

  const adapter = useMemo(() => adapters.find((a) => a.id === adapterId) ?? adapters[0], [adapterId]);
  const supportsPreview = previewTargets.has(adapterId);
  const isLocal = adapterId === "docker";

  const runPreflight = async (): Promise<boolean> => {
    setPreflightStatus("checking");
    setMessage(`Checking ${adapter.name} configuration...`);
    try {
      const result = await bridge.deployPreflight(workspace, adapterId);
      if (result.success) {
        setPreflightStatus("ready");
        setMessage("");
        return true;
      }
      setPreflightStatus("blocked");
      setMessage(result.message ?? `${adapter.name} preflight failed`);
      return false;
    } catch (err) {
      setPreflightStatus("blocked");
      setMessage(errorMessage(err));
      return false;
    }
  };

  const handleDeploy = async () => {
    if (preflightStatus !== "ready") {
      const ready = await runPreflight();
      if (!ready) return;
    }
    setDeployStatus("deploying");
    setMessage(`Starting ${adapter.name} deployment...`);
    try {
      const isProduction = mode === "production";
      if (isProduction && !productionConfirmed) {
        setDeployStatus("idle");
        setMessage("Confirm the production impact before deploying.");
        return;
      }
      const result = await bridge.deploy(workspace, adapterId, isProduction, productionConfirmed);
      if (result.success) {
        setDeployStatus("success");
        const reportedUrl = (result.stdout ?? "").match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;
        setMessage(reportedUrl ? `Deployed to ${adapter.name}` : `${adapter.name} deployment completed, but no public URL reported.`);
        setUrl(reportedUrl);
      } else {
        setDeployStatus("error");
        setMessage(result.stderr || `${adapter.name} deployment failed.`);
      }
    } catch (err) {
      setDeployStatus("error");
      setMessage(errorMessage(err));
    }
  };

  const reset = () => {
    setDeployStatus("idle");
    setPreflightStatus("idle");
    setMessage("");
    setUrl(null);
    setProductionConfirmed(false);
  };

  const busy = preflightStatus === "checking" || deployStatus === "deploying";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="deployment-title" className="w-[440px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#222]">
          <h2 id="deployment-title" className="text-sm font-semibold text-white flex items-center gap-2">
            <Rocket size={16} className="text-blue-400" /> Ship It
          </h2>
          <button type="button" aria-label="Close deployment" onClick={onClose} className="p-1 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {(deployStatus === "idle" || preflightStatus !== "idle") && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">Deploy Target</label>
                <div className="flex gap-2 flex-wrap">
                  {adapters.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setAdapterId(item.id); reset(); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                          adapterId === item.id
                            ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                        }`}
                      >
                        <Icon size={14} /> {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">Mode</label>
                <div className="flex gap-2">
                  {supportsPreview && (
                    <button
                      type="button"
                      onClick={() => { setMode("preview"); setProductionConfirmed(false); }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        mode === "preview"
                          ? "bg-green-600/20 border-green-500/50 text-green-300"
                          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      Preview
                    </button>
                  )}
                  {!isLocal && (
                    <button
                      type="button"
                      onClick={() => { setMode("production"); setProductionConfirmed(false); }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                        mode === "production"
                          ? "bg-amber-600/20 border-amber-500/50 text-amber-300"
                          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      Production
                    </button>
                  )}
                </div>
              </div>

              {preflightStatus === "ready" && (
                <div className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2">
                  <CheckCircle size={12} className="inline mr-1" /> {adapter.name} preflight passed
                </div>
              )}
              {preflightStatus === "blocked" && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                  {message}
                </div>
              )}

              {mode === "production" && (
                <label className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                  <input
                    type="checkbox"
                    checked={productionConfirmed}
                    onChange={(event) => setProductionConfirmed(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand this can create public infrastructure, consume billing, and replace the current production release.</span>
                </label>
              )}

              <button
                onClick={handleDeploy}
                disabled={busy || (mode === "production" && !productionConfirmed)}
                className="w-full flex justify-center items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Rocket size={16} />}
                {busy
                  ? `${preflightStatus === "checking" ? "Checking" : "Deploying"}...`
                  : `Deploy to ${mode === "production" ? "Production" : mode === "preview" ? "Preview" : adapter.name}`}
              </button>
            </>
          )}

          {deployStatus === "deploying" && (
            <div className="flex flex-col items-center justify-center py-6 gap-4">
              <LoaderCircle size={32} className="text-blue-500 animate-spin" />
              <div className="text-sm text-white/80">{message}</div>
            </div>
          )}

          {deployStatus === "success" && (
            <div className="flex flex-col items-center justify-center py-4 gap-4">
              <CheckCircle size={40} className="text-green-500" />
              <div className="text-sm text-white font-medium">{message}</div>
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline break-all text-center">
                  {url}
                </a>
              )}
            </div>
          )}

          {deployStatus === "error" && (
            <div className="flex flex-col items-center justify-center py-4 gap-4">
              <AlertCircle size={40} className="text-red-500" />
              <div className="text-sm text-white font-medium text-center">Deployment Failed</div>
              <div className="text-xs text-red-400/80 bg-red-500/10 p-3 rounded-md border border-red-500/20 w-full whitespace-pre-wrap font-mono max-h-[150px] overflow-auto">
                {message}
              </div>
            </div>
          )}
        </div>

        {(deployStatus === "success" || deployStatus === "error") && (
          <div className="px-6 pb-4">
            <button onClick={onClose} className="w-full px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
