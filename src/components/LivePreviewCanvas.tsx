import { useState } from "react";
import { Monitor, Smartphone, Tablet, MousePointer2, SplitSquareHorizontal, MousePointerClick, Maximize2 } from "lucide-react";

export function LivePreviewCanvas({ url = "http://localhost:5173", title = "Vibe Preview" }: { url?: string; title?: string }) {
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [mode, setMode] = useState<"single" | "split">("single");
  const [inspectMode, setInspectMode] = useState(false);

  const getWidth = () => {
    switch (device) {
      case "mobile": return "w-[375px]";
      case "tablet": return "w-[768px]";
      default: return "w-full";
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-card rounded-md border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="text-xs font-semibold text-white/80">{title}</div>
          
          <div className="h-4 w-[1px] bg-white/10"></div>
          
          <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg">
            <button 
              onClick={() => setDevice("desktop")}
              className={`p-1.5 rounded-md transition-colors ${device === "desktop" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              title="Desktop (100%)"
            >
              <Monitor size={14} />
            </button>
            <button 
              onClick={() => setDevice("tablet")}
              className={`p-1.5 rounded-md transition-colors ${device === "tablet" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              title="Tablet (768px)"
            >
              <Tablet size={14} />
            </button>
            <button 
              onClick={() => setDevice("mobile")}
              className={`p-1.5 rounded-md transition-colors ${device === "mobile" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              title="Mobile (375px)"
            >
              <Smartphone size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button 
             onClick={() => setMode(mode === "single" ? "split" : "single")}
             className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${mode === "split" ? "bg-primary/10 text-primary" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
           >
             <SplitSquareHorizontal size={14} />
             {mode === "split" ? "Exit Split" : "Before/After"}
           </button>
           
           <button 
             onClick={() => setInspectMode(!inspectMode)}
             className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${inspectMode ? "bg-primary/10 text-primary" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
           >
             {inspectMode ? <MousePointerClick size={14} /> : <MousePointer2 size={14} />}
             {inspectMode ? "Inspecting" : "Select Element"}
           </button>
           
           <button className="p-1.5 text-white/50 hover:text-white ml-2">
             <Maximize2 size={14} />
           </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-auto bg-[#1a1a1a] p-8 flex items-center justify-center relative">
        {mode === "single" ? (
          <div className={`h-full ${getWidth()} bg-white rounded-md overflow-hidden shadow-lg transition-all duration-300 border border-white/20 relative`}>
             <iframe src={url} className="w-full h-full bg-white pointer-events-none" title="preview" />
             {inspectMode && (
               <div className="absolute inset-0 bg-primary/10 cursor-crosshair border border-primary/50 flex items-center justify-center z-10">
                 <div className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded pointer-events-none">
                   Select an element to annotate
                 </div>
               </div>
             )}
             
             {/* Canvas Action Bar */}
             <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-popover border border-border rounded-md px-2 py-1.5 z-20">
                <button className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-medium rounded-full transition-colors">Debug</button>
                <div className="w-[1px] h-4 bg-white/10" />
                <button className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-medium rounded-full transition-colors">Code Review</button>
                <div className="w-[1px] h-4 bg-white/10" />
                <button className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-medium rounded-full transition-colors">Add Comments</button>
             </div>
          </div>
        ) : (
          <div className="flex w-full h-full gap-8">
             <div className="flex-1 flex flex-col items-center gap-2 relative">
               <span className="text-xs text-white/50 font-medium uppercase tracking-wider">Before</span>
               <div className="w-full h-full bg-white rounded-md overflow-hidden shadow-lg border border-white/20 opacity-70 grayscale-[50%]">
                 <iframe src={url} className="w-full h-full bg-white pointer-events-none" title="preview-before" />
               </div>
             </div>
             <div className="flex-1 flex flex-col items-center gap-2 relative">
               <span className="text-xs text-primary font-medium uppercase tracking-wider">After (Proposed)</span>
               <div className="w-full h-full bg-white rounded-md overflow-hidden border border-primary/50">
                 <iframe src={url} className="w-full h-full bg-white pointer-events-none" title="preview-after" />
               </div>
               {/* Action Bar for the After view */}
               <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-popover border border-border rounded-md px-2 py-1.5 z-20">
                  <button className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-medium rounded-full transition-colors">Final Polish</button>
               </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
