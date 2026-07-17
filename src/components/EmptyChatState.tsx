import { Sparkles, Code2, Blocks, Wand2 } from "lucide-react";

type EmptyChatStateProps = {
  onSend: (content: string) => void;
};

const suggestions = [
  { icon: Code2, text: "Analyze the current project structure and suggest improvements" },
  { icon: Blocks, text: "Add a new feature to handle user authentication" },
  { icon: Wand2, text: "Fix TypeScript compilation errors in the codebase" },
  { icon: Sparkles, text: "Write tests for the main components" },
];

export function EmptyChatState({ onSend }: EmptyChatStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-8">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          What do you want to build?
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Describe your task and the agent will analyze your codebase,
          make changes, and verify the results.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left text-xs hover:bg-accent transition-colors cursor-pointer"
            onClick={() => onSend(text)}
          >
            <Icon size={16} className="shrink-0 mt-0.5 text-muted-foreground" />
            <span className="text-foreground/90 leading-relaxed">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
