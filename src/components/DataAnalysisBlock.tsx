import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, LoaderCircle, Copy, Check } from "lucide-react";

type DataAnalysisBlockProps = {
  code: string;
  output?: string;
  status: "running" | "success" | "error";
  language?: string;
};

export function DataAnalysisBlock({ code, output, status, language = "python" }: DataAnalysisBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl border border-white/10 bg-[#1a1a1a] overflow-hidden">
      {/* Collapsed Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors group"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {status === "running" ? (
            <LoaderCircle size={14} className="animate-spin text-blue-400 shrink-0" />
          ) : status === "success" ? (
            <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          ) : (
            <Terminal size={14} className="text-red-400 shrink-0" />
          )}
          <span className="text-xs font-medium text-white/80">
            {status === "running" ? "Analyzing..." : status === "success" ? "Analysis complete" : "Execution error"}
          </span>
          <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">{language}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {expanded ? (
            <ChevronDown size={14} className="text-white/40 group-hover:text-white/70" />
          ) : (
            <ChevronRight size={14} className="text-white/40 group-hover:text-white/70" />
          )}
        </div>
      </button>

      {/* Expanded Code + Output */}
      {expanded && (
        <div className="border-t border-white/5">
          {/* Code Block */}
          <div className="relative">
            <div className="absolute top-2 right-2 z-10">
              <button
                onClick={handleCopy}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                title="Copy code"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <pre className="p-4 text-[12px] leading-relaxed font-mono text-[#d4d4d4] overflow-x-auto bg-[#111] max-h-[300px] overflow-y-auto">
              <code>{code}</code>
            </pre>
          </div>

          {/* Output Block */}
          {output && (
            <div className="border-t border-white/5">
              <div className="px-4 py-1.5 text-[10px] text-white/30 font-medium uppercase tracking-wider bg-[#0d0d0d]">
                Output
              </div>
              <pre className="p-4 text-[12px] leading-relaxed font-mono text-green-400/90 overflow-x-auto bg-[#0d0d0d] max-h-[200px] overflow-y-auto">
                <code>{output}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
