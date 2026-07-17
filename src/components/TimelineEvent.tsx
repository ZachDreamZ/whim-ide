import { useState } from "react";
import {
  LoaderCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  Square,
  Users,
} from "lucide-react";

export type TimelineEventStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "warning"
  | "failed"
  | "cancelled";

export type TimelineEventType =
  | "user_message"
  | "assistant_text"
  | "tool_invocation"
  | "tool_result"
  | "file_change"
  | "test_result"
  | "delegation"
  | "warning"
  | "error"
  | "run_completion";

export type TimelineEventData = {
  id: string;
  type: TimelineEventType;
  status: TimelineEventStatus;
  label: string;
  detail?: string;
  duration?: string;
  defaultExpanded?: boolean;
};

const StatusIcon = {
  pending: LoaderCircle,
  running: LoaderCircle,
  succeeded: CheckCircle2,
  warning: AlertTriangle,
  failed: XCircle,
  cancelled: Square,
  delegation: Users,
} as const;



type TimelineEventProps = {
  event: TimelineEventData;
};

export function TimelineEvent({ event }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(event.defaultExpanded ?? false);
  const IconComponent = StatusIcon[event.status];
  const hasDetail = Boolean(event.detail);

  return (
    <div className={`timeline-event timeline-event--${event.status}`}>
      <div
        className="timeline-event-header"
        onClick={() => hasDetail && setExpanded(!expanded)}
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onKeyDown={
          hasDetail
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded(!expanded);
                }
              }
            : undefined
        }
      >
        <span className="timeline-event-icon">
          {event.status === "running" ? (
            <LoaderCircle className="animate-spin" size={14} />
          ) : (
            <IconComponent size={14} />
          )}
        </span>
        <span className="timeline-event-label">{event.label}</span>
        {event.duration && (
          <span className="timeline-event-duration">{event.duration}</span>
        )}
        {hasDetail && (
          <span className="timeline-event-view-details">
            {expanded ? "Hide details" : "View details"}
          </span>
        )}
        {hasDetail && (
          <ChevronDown
            size={12}
            className={`timeline-event-chevron ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </div>
      {expanded && hasDetail && (
        <div className="timeline-event-detail">{event.detail}</div>
      )}
    </div>
  );
}
