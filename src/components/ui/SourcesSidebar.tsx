import { X, ExternalLink, Quote, Globe, FileText } from "lucide-react";
import type { CitationSource } from "../../lib/citations";

/** Inline citation chip — rendered inside markdown content. */
export function CitationChip({ id, onClick }: { id: number; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors cursor-pointer align-middle mx-0.5 leading-none" title={`Source [${id}]`}>{id}</button>;
}

export function SourcesSidebar({ onClose, sources = [], activeId }: { onClose: () => void; sources?: CitationSource[]; activeId?: number | null }) {
  return <div className="w-80 h-full bg-[#1e1e1e] border-l border-white/10 flex flex-col animate-in slide-in-from-right-8 fade-in duration-300 shrink-0">
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
      <div className="flex items-center gap-2"><Globe size={14} className="text-primary"/><h2 className="text-sm font-semibold text-white">Sources</h2></div>
      <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors"><X size={16}/></button>
    </div>
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <div className="text-xs text-white/40 mb-1 flex items-center gap-1.5"><FileText size={12}/>{sources.length} source{sources.length === 1 ? "" : "s"} cited in this conversation</div>
      {sources.map((source) => <a key={source.id} id={`whim-source-${source.id}`} href={source.url} target="_blank" rel="noopener noreferrer" className={`block rounded-md p-3.5 transition-all cursor-pointer border group ${activeId === source.id ? "bg-primary/10 border-primary/50" : "bg-white/[0.03] hover:bg-white/[0.07] border-white/5 hover:border-white/10"}`}>
        <div className="flex items-center gap-2.5 mb-2"><div className="w-5 h-5 rounded-sm bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{source.id}</div><span className="text-[11px] text-white/40 truncate flex-1 font-mono">{source.domain}</span><ExternalLink size={12} className="text-white/20 group-hover:text-white/60 shrink-0 transition-colors"/></div>
        <h3 className="text-[13px] text-white font-medium mb-1.5 line-clamp-1 group-hover:text-primary transition-colors">{source.title}</h3>
        <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed"><Quote size={9} className="inline mr-1 text-white/20"/>{source.snippet}</p>
      </a>)}
      {sources.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/40">No linked sources yet. URLs cited by assistant responses will appear here.</div>}
    </div>
    <div className="px-4 py-3 border-t border-white/5 text-[10px] text-white/30 text-center">Sources shown here come from this conversation</div>
  </div>;
}
