import { Sparkles } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="Whim IDE">
      <div className="brand-mark" aria-hidden="true">
        <span className="brand-orbit brand-orbit-a" />
        <span className="brand-orbit brand-orbit-b" />
        <Sparkles size={15} strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="brand-wordmark">
          <span>Whim</span>
          <small>IDE</small>
        </div>
      )}
    </div>
  );
}
