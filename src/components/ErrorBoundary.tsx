import { Component, type ErrorInfo, type ReactNode } from "react";
import { whimError } from "@/lib/bridge";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCategory: string | null;
  recoveryHint: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorCategory: null, recoveryHint: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const parsedError = whimError(error);
    const errorCategory = parsedError.code || "UNKNOWN";
    const recoveryHint = this.extractRecoveryHint(parsedError.message);
    
    return { 
      hasError: true, 
      error,
      errorCategory,
      recoveryHint
    };
  }

  static extractRecoveryHint(message: string): string | null {
    const hintMatch = /Recovery hint:\s*(.+?)(?:\n\n|$)/s.exec(message);
    return hintMatch ? hintMatch[1].trim() : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  getErrorTitle(): string {
    switch (this.state.errorCategory) {
      case "WORKSPACE_NOT_FOUND":
        return "Workspace Not Selected";
      case "WORKSPACE_INVALID":
        return "Invalid Workspace";
      case "JOB_NOT_FOUND":
        return "Task Not Found";
      case "JOB_STATE_INVALID":
        return "Invalid Task State";
      case "PERMISSION_DENIED":
        return "Permission Denied";
      case "TIMEOUT":
        return "Operation Timed Out";
      case "NETWORK_ERROR":
        return "Network Error";
      case "PROVIDER_AUTH":
        return "Provider Authentication Error";
      case "PROVIDER_TRANSIENT":
        return "Provider Temporarily Unavailable";
      case "TOOL_PERMISSION":
        return "Tool Permission Error";
      default:
        return "Something went wrong";
    }
  }

  getErrorIcon(): string {
    switch (this.state.errorCategory) {
      case "WORKSPACE_NOT_FOUND":
      case "WORKSPACE_INVALID":
        return "📁";
      case "JOB_NOT_FOUND":
      case "JOB_STATE_INVALID":
        return "📋";
      case "PERMISSION_DENIED":
      case "TOOL_PERMISSION":
        return "🔒";
      case "TIMEOUT":
        return "⏱️";
      case "NETWORK_ERROR":
        return "🌐";
      case "PROVIDER_AUTH":
      case "PROVIDER_TRANSIENT":
        return "🔑";
      default:
        return "⚠️";
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh w-dvh items-center justify-center bg-[#0f0f0f] p-8">
          <div className="max-w-md text-center">
            <div className="mb-4 text-4xl">{this.getErrorIcon()}</div>
            <h1 className="mb-2 text-lg font-semibold text-[#e0e0e0]">
              {this.getErrorTitle()}
            </h1>
            <p className="mb-4 text-sm text-[#888]">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            {this.state.recoveryHint && (
              <div className="mb-6 rounded-md bg-[#1a1a1a] p-4 text-left">
                <p className="mb-2 text-xs font-medium text-[#5adf9a]">Recovery hint:</p>
                <p className="text-xs text-[#e0e0e0]">{this.state.recoveryHint}</p>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-[#5adf9a] px-4 py-2 text-sm font-medium text-[#0f0f0f] transition-colors hover:bg-[#4bcb88]"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
