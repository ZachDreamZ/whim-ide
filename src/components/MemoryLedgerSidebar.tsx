import { useEffect, useState } from "react";
import { Database, X, BrainCircuit, RefreshCw } from "lucide-react";
import { bridge, Observation } from "../lib/bridge";


interface MemoryLedgerSidebarProps {
  workspace: string;
  onClose: () => void;
}

export function MemoryLedgerSidebar({ workspace, onClose }: MemoryLedgerSidebarProps) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadObservations = async () => {
    setLoading(true);
    try {
      const data = await bridge.getObservationalMemory(workspace);
      // Sort newest first
      data.sort((a, b) => b.timestamp - a.timestamp);
      setObservations(data);
    } catch (e) {
      console.error("Failed to load observational memory", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadObservations();
  }, [workspace]);

  return (
    <div className="w-[380px] h-full bg-[#111111] border-l border-white/5 flex flex-col animate-in slide-in-from-right-8 fade-in duration-300">
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <h3 className="font-semibold flex items-center gap-2">
          <Database size={16} className="text-emerald-500" />
          Observational Memory
        </h3>
        <div className="flex items-center gap-2">
          <button 
            onClick={loadObservations}
            disabled={loading}
            className="p-1 hover:bg-white/10 rounded transition-colors text-[#a3a3a3] hover:text-white disabled:opacity-50"
            title="Refresh memory"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors text-[#a3a3a3] hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {loading ? (
          <div className="text-center py-8 text-[#a3a3a3] text-sm">Loading memories...</div>
        ) : observations.length === 0 ? (
          <div className="text-center py-12 flex flex-col items-center gap-4">
            <BrainCircuit size={48} className="text-white/10" />
            <div className="text-[#a3a3a3] text-sm">
              <p className="font-medium text-white mb-1">No observations yet</p>
              <p>The agent will automatically store memories about the project context after successful jobs.</p>
            </div>
          </div>
        ) : (
          observations.map((obs) => (
            <div 
              key={obs.id} 
              className={`p-3 rounded-md border ${obs.merged ? "border-white/5 bg-white/5 opacity-60" : "border-emerald-500/20 bg-emerald-500/5"} transition-all`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs text-[#a3a3a3] font-medium">
                  {new Date(obs.timestamp).toLocaleString()}
                </span>
                {obs.merged ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[#a3a3a3]">Merged</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Active</span>
                )}
              </div>
              <p className="text-sm text-[#e5e5e5] leading-relaxed whitespace-pre-wrap font-sans">
                {obs.content}
              </p>
            </div>
          ))
        )}
      </div>
      
      <div className="p-4 border-t border-white/5 bg-white/[0.02]">
        <p className="text-xs text-[#a3a3a3] leading-snug">
          This persistent text ledger is prepended to the system prompt automatically, utilizing LLM Prompt Caching.
        </p>
      </div>
    </div>
  );
}
