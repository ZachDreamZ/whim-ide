import { useState } from "react";
import { Rocket, LoaderCircle, X, CheckCircle, AlertCircle } from "lucide-react";
import { bridge, errorMessage } from "../lib/bridge";

type Props = {
  workspace: string;
  onClose: () => void;
};

export function DeploymentModal({ workspace, onClose }: Props) {
  const [target, setTarget] = useState<string>("preview");
  const [status, setStatus] = useState<"idle" | "deploying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [url, setUrl] = useState<string | null>(null);
  const [productionConfirmed, setProductionConfirmed] = useState(false);

  const handleDeploy = async () => {
    setStatus("deploying");
    setMessage("Starting deployment...");
    try {
      const isProduction = target === "production";
      if (isProduction && !productionConfirmed) {
        setStatus("idle");
        setMessage("Confirm the production impact before deploying.");
        return;
      }
      const result = await bridge.deploy(workspace, "vercel", isProduction, productionConfirmed);
      if (result.success) {
        setStatus("success");
        const reportedUrl = (result.stdout ?? "").match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? null;
        setMessage(reportedUrl ? "Deployment completed." : "Deployment completed, but the provider did not report a public URL.");
        setUrl(reportedUrl);
      } else {
        setStatus("error");
        setMessage(result.stderr || "Deployment failed.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(errorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="deployment-title" className="w-[400px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#222]">
          <h2 id="deployment-title" className="text-sm font-semibold text-white flex items-center gap-2">
            <Rocket size={16} className="text-blue-400" /> Ship It
          </h2>
          <button type="button" aria-label="Close deployment" onClick={onClose} className="p-1 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        
        <div className="p-6 flex flex-col gap-5">
          {status === "idle" && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-white/70">Deployment Target</label>
                <select 
                  value={target}
                  onChange={(e) => { setTarget(e.target.value); setProductionConfirmed(false); setMessage(""); }}
                  className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                >
                  <option value="preview">Preview Environment</option>
                  <option value="staging">Staging Environment</option>
                  <option value="production">Production Environment</option>
                </select>
              </div>
              {target === "production" && (
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
              {message && <p role="status" className="text-xs text-amber-300">{message}</p>}
              <button 
                onClick={handleDeploy}
                disabled={target === "production" && !productionConfirmed}
                className="w-full flex justify-center items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Rocket size={16} /> Deploy to {target === "production" ? "Production" : target === "staging" ? "Staging" : "Preview"}
              </button>
            </>
          )}

          {status === "deploying" && (
            <div className="flex flex-col items-center justify-center py-6 gap-4">
              <LoaderCircle size={32} className="text-blue-500 animate-spin" />
              <div className="text-sm text-white/80">{message}</div>
            </div>
          )}

          {status === "success" && (
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

          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-4 gap-4">
              <AlertCircle size={40} className="text-red-500" />
              <div className="text-sm text-white font-medium text-center">Deployment Failed</div>
              <div className="text-xs text-red-400/80 bg-red-500/10 p-3 rounded-md border border-red-500/20 w-full whitespace-pre-wrap font-mono max-h-[150px] overflow-auto">
                {message}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
