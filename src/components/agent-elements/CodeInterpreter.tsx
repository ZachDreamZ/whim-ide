import { useState } from "react";
import { TerminalSquare, ChevronDown, ChevronUp, Loader2, PieChart } from "lucide-react";

export function CodeInterpreter({ status = "finished" }: { status?: "analyzing" | "finished" }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2 my-4 max-w-2xl">
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between bg-black/20 hover:bg-black/30 border border-white/5 rounded-lg px-4 py-3 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded bg-blue-500/10 ${status === "analyzing" ? "text-blue-400" : "text-green-400"}`}>
            {status === "analyzing" ? <Loader2 size={16} className="animate-spin" /> : <TerminalSquare size={16} />}
          </div>
          <span className="text-sm font-medium text-white/90">
            {status === "analyzing" ? "Analyzing data..." : "Analyzed dataset"}
          </span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </div>

      {expanded && (
        <div className="bg-[#1e1e1e] border border-white/10 rounded-lg overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="bg-[#2d2d2d] px-4 py-2 text-xs font-mono text-white/50 border-b border-white/5">
            python
          </div>
          <div className="p-4 text-xs font-mono text-blue-300 whitespace-pre overflow-x-auto">
            {`import pandas as pd
import matplotlib.pyplot as plt

# Load the attached dataset
df = pd.read_csv('/mnt/data/metrics.csv')

# Calculate weekly growth and output summary
growth = df.groupby('week')['active_users'].sum().pct_change()
print(f"Average weekly growth: {growth.mean():.2%}")

# Generate visualization
plt.figure(figsize=(10, 5))
growth.plot(kind='bar', color='#3b82f6')
plt.title('Weekly Active User Growth')
plt.show()`}
          </div>
          <div className="bg-black/40 border-t border-white/5 p-4 flex flex-col gap-3">
             <div className="text-xs font-mono text-white/70">
               Average weekly growth: 12.40%
             </div>
             {/* Mock chart output */}
             <div className="w-full h-48 bg-[#2d2d2d] rounded border border-white/10 flex items-center justify-center">
               <PieChart size={48} className="text-blue-400/50" />
               <span className="text-white/30 ml-2 text-sm font-medium">Chart Output Generated</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
