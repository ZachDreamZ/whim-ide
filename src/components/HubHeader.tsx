import type { ReactNode } from "react";

type HubHeaderProps = {
  /** Small uppercase label above the title, e.g. "Models & providers". */
  kicker: string;
  title: string;
  description: string;
  /** Optional inline icon rendered next to the kicker. */
  icon?: ReactNode;
  /** Optional action buttons rendered on the right of the hero. */
  actions?: ReactNode;
};

/**
 * Consistent hero header for every workspace hub. Mirrors the
 * `integration-hero` pattern so Ship, Ecosystem, Providers, and Autopilot
 * read the same as Plugins, Sites, Pull requests, and Services.
 */
export function HubHeader({ kicker, title, description, icon, actions }: HubHeaderProps) {
  return (
    <header className="integration-hero hub-hero">
      <div>
        <span className="section-kicker">{icon}{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="integration-actions">{actions}</div>}
    </header>
  );
}
