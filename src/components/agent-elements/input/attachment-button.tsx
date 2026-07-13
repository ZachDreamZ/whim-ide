import { memo, useState, useRef, useEffect, type ReactNode } from "react";
import { IconPaperclip, IconPlus, IconFile, IconPhoto, IconBrandFigma, IconBrandGoogleDrive } from "@tabler/icons-react";

export type AttachmentButtonIcon = "plus" | "paperclip";

export type AttachmentButtonProps = {
  onClick?: () => void;
  icon?: AttachmentButtonIcon | ReactNode;
};

function isIconName(value: unknown): value is AttachmentButtonIcon {
  return value === "plus" || value === "paperclip";
}

export const AttachmentButton = memo(function AttachmentButton({
  onClick,
  icon = "plus",
}: AttachmentButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const iconClassName = "w-4 h-4 text-neutral-400 dark:text-neutral-600";
  let iconNode: ReactNode;
  if (isIconName(icon)) {
    iconNode =
      icon === "paperclip" ? (
        <IconPaperclip className={iconClassName} strokeWidth={2} />
      ) : (
        <IconPlus className={iconClassName} strokeWidth={2} />
      );
  } else {
    iconNode = icon;
  }

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onClick?.();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`size-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${isOpen ? "bg-white/10" : "hover:bg-muted"}`}
        aria-label="Attach"
      >
        {iconNode}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg bg-[#2d2d2d] border border-white/10 shadow-2xl py-1 z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button onClick={handleSelect} className="flex items-center gap-3 px-3 py-2 text-sm text-[#ececf1] hover:bg-white/10 transition-colors w-full text-left">
            <IconFile size={16} className="text-white/50" /> Upload from computer
          </button>
          <button onClick={handleSelect} className="flex items-center gap-3 px-3 py-2 text-sm text-[#ececf1] hover:bg-white/10 transition-colors w-full text-left">
            <IconPhoto size={16} className="text-white/50" /> Attach image
          </button>
          <div className="h-px w-full bg-white/10 my-1"></div>
          <button onClick={handleSelect} className="flex items-center gap-3 px-3 py-2 text-sm text-[#ececf1] hover:bg-white/10 transition-colors w-full text-left">
            <IconBrandGoogleDrive size={16} className="text-white/50" /> Connect Google Drive
          </button>
          <button onClick={handleSelect} className="flex items-center gap-3 px-3 py-2 text-sm text-[#ececf1] hover:bg-white/10 transition-colors w-full text-left">
            <IconBrandFigma size={16} className="text-white/50" /> Paste from Figma
          </button>
        </div>
      )}
    </div>
  );
});
