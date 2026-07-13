import { memo, useEffect, useRef } from "react";
import { IconFile, IconFolder } from "@tabler/icons-react";

export type MentionItem = {
  type: "workspace" | "file";
  path: string;
};

export type MentionMenuProps = {
  items: MentionItem[];
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
};

export const MentionMenu = memo(function MentionMenu({
  items,
  selectedIndex,
  onSelect,
  onClose,
}: MentionMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const selectedEl = containerRef.current?.children[selectedIndex] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 w-72 max-h-64 overflow-y-auto rounded-lg bg-[#2d2d2d] border border-white/10 shadow-2xl py-1 z-50 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      {items.map((item, index) => (
        <button
          key={item.path}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onSelect(item);
          }}
          className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors w-full text-left ${index === selectedIndex ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`}
        >
          {item.type === "workspace" ? (
            <IconFolder size={16} className="text-white/50 shrink-0" />
          ) : (
            <IconFile size={16} className="text-white/50 shrink-0" />
          )}
          <span className="truncate">{item.path}</span>
        </button>
      ))}
    </div>
  );
});
