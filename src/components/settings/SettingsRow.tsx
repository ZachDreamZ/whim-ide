import { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type ControlType = 
  | { type: "toggle"; value: boolean; onChange: (val: boolean) => void }
  | { type: "select"; value: string; options: string[]; onChange: (val: string) => void }
  | { type: "segmented"; value: string; options: string[]; onChange: (val: string) => void };

export interface SettingsRowProps {
  label: string;
  description?: string;
  control: ControlType;
  children?: ReactNode;
  borderBottom?: boolean;
}

export function SettingsRow({ label, description, control, children, borderBottom = true }: SettingsRowProps) {
  return (
    <div className={`flex items-center justify-between py-4 ${borderBottom ? "border-b border-white/5" : ""}`}>
      <div className="flex-1 pr-6">
        <div className="text-sm font-medium text-[#ececf1]">{label}</div>
        {description && <div className="text-[13px] text-[#a3a3a3] mt-1 leading-relaxed">{description}</div>}
        {children && <div className="mt-2 text-[13px] text-[#a3a3a3]">{children}</div>}
      </div>
      <div className="flex-shrink-0 flex items-center">
        {control.type === "toggle" && (
          <button
            type="button"
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${control.value ? "bg-[#3498db]" : "bg-[#404040]"}`}
            onClick={() => control.onChange(!control.value)}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${control.value ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        )}
        {control.type === "select" && (
          <div className="relative">
            <select
              value={control.value}
              onChange={(e) => control.onChange(e.target.value)}
              className="appearance-none bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 rounded-md pl-3 pr-8 py-1.5 text-sm outline-none transition-colors cursor-pointer text-[#ececf1] min-w-[120px]"
            >
              {control.options.map((opt) => (
                <option key={opt} value={opt} className="bg-[#171717]">{opt}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a3a3a3] pointer-events-none" />
          </div>
        )}
        {control.type === "segmented" && (
          <div className="flex bg-white/5 p-0.5 rounded-md border border-white/5">
            {control.options.map((opt) => (
              <button
                key={opt}
                onClick={() => control.onChange(opt)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                  control.value === opt
                    ? "bg-[#2f2f2f] text-white shadow-sm"
                    : "text-[#a3a3a3] hover:text-[#ececf1]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
