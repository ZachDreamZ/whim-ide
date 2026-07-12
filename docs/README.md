# Whim IDE documentation

**Build at the speed of intent.**

Whim IDE is a Windows-first, provider-neutral product concept for turning an idea into working, verified, deployable software without making the user assemble the development stack by hand.

These documents describe both the implemented prototype and the intended product. Each technical document distinguishes connected behavior from interface/spec-only capability.

## Implemented snapshot

The prototype now includes the Windows/Tauri workbench, Monaco editing, agent send flow, provider and environment discovery, ecosystem catalog, deploy preflight hub, persisted Autopilot controls, command palette, and a guarded Rust bridge for workspace, native agent, command, and deployment operations.

The frontend build passes; Rust formatting, compilation, and all 3 Rust tests pass. The Windows x64 release app and NSIS setup executable were built, and the release app passed a native launch/accessibility/close smoke test. No provider credentials, real AI run, production deployment, or MSI artifact were part of the verified snapshot.

## Read in this order

1. [Product](./product.md) — thesis, values, experience loop, features, and success measures.
2. [Architecture](./architecture.md) — current technical baseline and target system boundaries.
3. [Ecosystem](./ecosystem.md) — model providers, plugins, and universal deployment.
4. [Trust and automation](./trust-and-automation.md) — autonomy tiers, verification, permissions, and reversibility.
5. [Research](./research.md) — the primary and official sources behind the product decisions.

## Product in one sentence

Whim IDE keeps the joyful, conversational flow of vibe coding while automatically adding the context, verification, portability, and safety required to ship software responsibly.
