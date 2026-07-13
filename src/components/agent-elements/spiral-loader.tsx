import { LoaderCircle } from "lucide-react";
import { cn } from "./utils/cn";

export type SpiralLoaderProps = {
  size?: number;
  className?: string;
};

export function SpiralLoader({ size = 16, className }: SpiralLoaderProps) {
  return (
    <div
      className={cn("relative shrink-0 flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <LoaderCircle size={size} className="animate-spin text-white/50" />
    </div>
  );
}
