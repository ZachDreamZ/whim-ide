import { Braces } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="Whim IDE">
      <div className="brand-mark" aria-hidden="true">
        <Braces size={14} strokeWidth={1.8} />
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
