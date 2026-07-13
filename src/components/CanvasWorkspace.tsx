import { useEffect, useMemo, useReducer, useState } from "react";
import { Code2, Globe, LoaderCircle, Redo2, RefreshCw, Save, Undo2, X, GitCompare, Rocket } from "lucide-react";
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react";
import { bridge, errorMessage } from "../lib/bridge";
import type { WorkspaceEntry } from "../types/workbench";
import { DeploymentModal } from "./DeploymentModal";

type Props = { workspace: string; entries: readonly WorkspaceEntry[]; initialPath?: string; onClose?: () => void; onSaved?: () => void };
type DocumentState = { content: string; saved: string; past: string[]; future: string[]; modifiedMs: number | null };
type Action = { type: "load"; content: string; modifiedMs: number | null } | { type: "edit"; content: string } | { type: "undo" } | { type: "redo" } | { type: "saved"; modifiedMs: number | null };
const initialDocument: DocumentState = { content: "", saved: "", past: [], future: [], modifiedMs: null };
const BINARY_EXTENSIONS = /\.(?:7z|avi|bin|bmp|class|dll|docx?|exe|gif|gz|ico|jpe?g|lockb|mov|mp3|mp4|pdf|png|pptx?|so|tar|webp|woff2?|xlsx?|zip)$/i;
const editable = (entry: WorkspaceEntry) => entry.kind === "file" && (entry.size ?? 0) <= 2_000_000 && !BINARY_EXTENSIONS.test(entry.path);

function documentReducer(state: DocumentState, action: Action): DocumentState {
  if (action.type === "load") return { content: action.content, saved: action.content, past: [], future: [], modifiedMs: action.modifiedMs };
  if (action.type === "edit") return action.content === state.content ? state : { ...state, content: action.content, past: [...state.past.slice(-49), state.content], future: [] };
  if (action.type === "undo") { const content = state.past[state.past.length - 1]; return content === undefined ? state : { ...state, content, past: state.past.slice(0, -1), future: [state.content, ...state.future] }; }
  if (action.type === "redo") { const content = state.future[0]; return content === undefined ? state : { ...state, content, past: [...state.past, state.content], future: state.future.slice(1) }; }
  return { ...state, saved: state.content, modifiedMs: action.modifiedMs, past: [], future: [] };
}

function escapedPreview(content: string) {
  return content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function CanvasWorkspace({ workspace, entries, initialPath, onClose, onSaved }: Props) {
  const files = useMemo(() => entries.filter(editable).sort((a, b) => a.path.localeCompare(b.path)), [entries]);
  const fileKey = useMemo(() => files.map((file) => file.path).join("\n"), [files]);
  const [path, setPath] = useState(""); const [document, dispatch] = useReducer(documentReducer, initialDocument);
  const [view, setView] = useState<"code" | "preview" | "diff">("code"); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const dirty = document.content !== document.saved;

  useEffect(() => { const preferred = initialPath && files.some((file) => file.path === initialPath) ? initialPath : files[0]?.path ?? ""; setPath(preferred); dispatch({ type: "load", content: "", modifiedMs: null }); }, [workspace, initialPath, fileKey]);
  const load = async (selectedPath: string) => { if (!selectedPath) return; setBusy(true); setMessage(""); try { const file = await bridge.readFileContent(workspace, selectedPath); dispatch({ type: "load", content: file.content, modifiedMs: file.modifiedMs ?? null }); } catch (cause) { setMessage(errorMessage(cause)); } finally { setBusy(false); } };
  useEffect(() => { void load(path); }, [path, workspace]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const save = async () => { setBusy(true); setMessage(""); try { const result = await bridge.writeFile(workspace, path, document.content, false, document.modifiedMs); dispatch({ type: "saved", modifiedMs: result.modifiedMs ?? null }); setMessage("Saved"); onSaved?.(); } catch (cause) { setMessage(errorMessage(cause)); } finally { setBusy(false); } };
  const selectPath = (next: string) => { if (!dirty || window.confirm("Discard unsaved Canvas changes?")) setPath(next); };
  const close = () => { if (!dirty || window.confirm("Discard unsaved Canvas changes?")) onClose?.(); };
  const htmlCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; media-src data: blob:">`;
  const preview = /\.html?$/i.test(path) ? `${htmlCsp}${document.content}` : `<pre style="white-space:pre-wrap;font:13px monospace">${escapedPreview(document.content)}</pre>`;
  
  const diffOldFile: FileContents = { name: path, contents: document.saved };
  const diffNewFile: FileContents = { name: path, contents: document.content };
  
  return <section className="flex flex-col w-full h-full bg-[#1e1e1e] rounded-xl border border-white/10 overflow-hidden shadow-2xl relative">
    <header className="flex items-center gap-2 px-3 py-2 bg-[#2d2d2d] border-b border-white/5"><select aria-label="Canvas file" value={path} onChange={(event) => selectPath(event.target.value)} className="min-w-0 flex-1 bg-black/25 text-xs text-white rounded px-2 py-1.5 border border-white/10">{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select>
      <button onClick={() => setView("code")} className={`p-1.5 rounded ${view === "code" ? "bg-white/15 text-white" : "text-white/50"}`} title="Code"><Code2 size={14}/></button>
      <button onClick={() => setView("preview")} className={`p-1.5 rounded ${view === "preview" ? "bg-white/15 text-white" : "text-white/50"}`} title="Preview"><Globe size={14}/></button>
      <button onClick={() => setView("diff")} className={`p-1.5 rounded ${view === "diff" ? "bg-white/15 text-white" : "text-white/50"} ${!dirty ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!dirty} title="Semantic Diff"><GitCompare size={14}/></button>
      <button onClick={() => dispatch({ type: "undo" })} disabled={!document.past.length} className="p-1.5 text-white/60 disabled:opacity-25" title="Undo"><Undo2 size={14}/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!document.future.length} className="p-1.5 text-white/60 disabled:opacity-25" title="Redo"><Redo2 size={14}/></button><button onClick={() => void load(path)} disabled={busy || !path} className="p-1.5 text-white/60 disabled:opacity-25" title="Reload from disk"><RefreshCw size={14}/></button>
      <button onClick={() => setDeployModalOpen(true)} className="flex items-center gap-1 px-2 py-1.5 rounded bg-fuchsia-600/80 hover:bg-fuchsia-600 text-white text-xs transition-colors"><Rocket size={13}/> Ship It</button>
      <button onClick={() => void save()} disabled={busy || !dirty || !path} className="flex items-center gap-1 px-2 py-1.5 rounded bg-blue-500 text-white text-xs disabled:opacity-30"><Save size={13}/> Save</button>{onClose && <button onClick={close} className="p-1.5 text-white/50" title="Close Canvas"><X size={14}/></button>}
    </header><div className="h-6 px-3 flex items-center text-[11px] text-white/40 border-b border-white/5">{busy && <LoaderCircle size={11} className="animate-spin mr-1"/>}{message || (dirty ? "Unsaved changes" : path || "No editable text files")}</div>
    {view === "code" ? <textarea aria-label="Canvas editor" value={document.content} onChange={(event) => dispatch({ type: "edit", content: event.target.value })} spellCheck={false} className="flex-1 resize-none bg-[#1a1a1a] text-[#d4d4d4] p-4 font-mono text-[13px] leading-relaxed outline-none" /> : view === "diff" ? (
      <div className="flex-1 overflow-auto bg-[#1a1a1a] text-[12px] p-4 dark:bg-black dark:[--diffs-bg:#000] dark:[--diffs-bg-buffer-override:#000] dark:[--diffs-bg-context-override:#000] dark:[--diffs-bg-hover-override:#0a0a0a] dark:[--diffs-bg-separator-override:#0f0f0f]">
        <MultiFileDiff oldFile={diffOldFile} newFile={diffNewFile} options={{ theme: { dark: "github-dark", light: "github-light" }, themeType: "dark", diffStyle: "split", disableFileHeader: true }} />
      </div>
    ) : <iframe title="Canvas preview" sandbox={/\.html?$/i.test(path) ? "allow-scripts" : ""} srcDoc={preview} className="flex-1 w-full bg-white" />}
    {deployModalOpen && <DeploymentModal workspace={workspace} onClose={() => setDeployModalOpen(false)} />}
  </section>;
}
