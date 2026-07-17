import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode2, LoaderCircle, Search, SearchX, X } from "lucide-react";
import { bridge, type SearchResult } from "../lib/bridge";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

type SearchPanelProps = {
  workspace: string;
  open: boolean;
  onClose: () => void;
  onOpenFile: (path: string, line?: number) => void;
};

export function SearchPanel({ workspace, open, onClose, onOpenFile }: SearchPanelProps) {
  const native = bridge.isNative();
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const doSearch = useCallback((q: string, regex: boolean, cs: boolean) => {
    if (!q.trim() || !native) {
      setResults([]);
      setDone(false);
      return;
    }
    const id = ++searchRef.current;
    setSearching(true);
    setDone(false);
    bridge.searchWorkspace(workspace, q.trim(), {
      useRegex: regex, caseSensitive: cs, contextLines: 0, maxResults: 200,
    }).then((res) => {
      if (id === searchRef.current) {
        setResults(res);
        setSearching(false);
        setDone(true);
      }
    }).catch(() => {
      if (id === searchRef.current) {
        setResults([]);
        setSearching(false);
        setDone(true);
      }
    });
  }, [workspace, native]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      doSearch(query, useRegex, caseSensitive);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, useRegex, caseSensitive, doSearch]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!open) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open, onClose]);

  if (!open) return null;

  // Group results by file
  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = grouped.get(r.path) ?? [];
    existing.push(r);
    grouped.set(r.path, existing);
  }

  return (
    <div className="search-panel-overlay">
      <div className="search-panel">
        <div className="search-panel-header">
          <div className="search-panel-input-row">
            <Search className="search-panel-icon" />
            <Input
              ref={inputRef}
              className="search-panel-input"
              placeholder="Search workspace files..."
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            {searching && <LoaderCircle className="search-panel-spinner" />}
            <button className="search-panel-close" onClick={onClose} aria-label="Close search">
              <X />
            </button>
          </div>
          <div className="search-panel-options">
            <label className={`search-panel-option ${useRegex ? "active" : ""}`}>
              <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
              Regex
            </label>
            <label className={`search-panel-option ${caseSensitive ? "active" : ""}`}>
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              Case
            </label>
            {done && <span className="search-panel-count">{results.length} result{results.length !== 1 ? "s" : ""}</span>}
          </div>
        </div>

        <ScrollArea className="search-panel-results">
          {!query.trim() && (
            <div className="search-panel-empty">
              <Search className="search-panel-empty-icon" />
              <p>Type to search across workspace files</p>
            </div>
          )}
          {query.trim() && done && results.length === 0 && (
            <div className="search-panel-empty">
              <SearchX className="search-panel-empty-icon" />
              <p>No results for <strong>"{query}"</strong></p>
            </div>
          )}
          {[...grouped.entries()].map(([filePath, matches]) => (
            <div key={filePath} className="search-panel-file-group">
              <div className="search-panel-file-header" onClick={() => onOpenFile(filePath)}>
                <FileCode2 className="search-panel-file-icon" />
                <span className="search-panel-file-name">{filePath.replace(/\\/g, "/")}</span>
                <span className="search-panel-file-count">{matches.length}</span>
              </div>
              {matches.slice(0, 50).map((m, i) => (
                <div
                  key={`${m.path}:${m.line}:${i}`}
                  className="search-panel-result"
                  onClick={() => onOpenFile(m.path, m.line)}
                  title={`${m.path}:${m.line}:${m.column}`}
                >
                  <span className="search-panel-line-num">{m.line}</span>
                  <span className="search-panel-line-text">{m.lineText}</span>
                </div>
              ))}
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}
