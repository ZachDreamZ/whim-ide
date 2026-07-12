import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, ShieldCheck, Square, TestTube2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, errorMessage, type NativeResult, type VerificationCheck, type VerificationPlan, type OrchestrationJob, type OrchestrationJobEvent } from "../lib/bridge";
 
type VerificationCardProps = {
  native: boolean;
  workspace: string | null;
  activeJob?: OrchestrationJob | null;
  events?: OrchestrationJobEvent[];
  onRunComplete?: () => void;
};


type ActiveCheck = { id: string; operationId: string };

function trimOutput(result: NativeResult) {
  const output = result.success ? result.stdout : result.stderr || result.stdout;
  return String(output ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, "")
    .slice(0, 1_800)
    .trim();
}

function resultLabel(result: NativeResult) {
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timed out";
  return result.success ? "passed" : "failed";
}

/** A neutral checker: it discovers fixed entry points natively, then runs only
 * commands explicitly selected by the user in the current execution target. */
export function VerificationCard({ native, workspace, activeJob, events, onRunComplete }: VerificationCardProps) {
  const [plan, setPlan] = useState<VerificationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ActiveCheck | null>(null);
  const [results, setResults] = useState<Record<string, NativeResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!native || !workspace) {
      setPlan(null);
      setNotice(null);
      return;
    }
    setLoading(true);
    try {
      const next = await bridge.verificationPlan(workspace);
      if (request !== requestId.current) return;
      setPlan(next);
      setNotice(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setPlan(null);
      setNotice(errorMessage(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [native, workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (events && events.length > 0) {
      const nextResults: Record<string, NativeResult> = {};
      for (const event of events) {
        if (event.kind === "evidence" && event.message.includes("Verification check")) {
          const match = /Verification check '([^']+)' \(([^)]+)\) (passed|failed)\./.exec(event.message);
          if (match) {
            const checkId = match[1];
            const status = match[3];
            nextResults[checkId] = {
              success: status === "passed",
              stdout: `Verification recorded as ${status} in task history.`,
            };
          }
        }
      }
      setResults(nextResults);
    } else {
      setResults({});
    }
  }, [events]);

  const run = async (checks: VerificationCheck[]) => {
    if (!workspace || !native || active || checks.length === 0) return;
    setNotice(null);
    for (const check of checks) {
      const operationId = `verify-${crypto.randomUUID()}`;
      setActive({ id: check.id, operationId });
      const started = Date.now();
      try {
        const result = await bridge.runCommand(workspace, check.command, {
          operationId,
          timeoutMs: check.timeoutMs,
        });
        const durationMs = Date.now() - started;
        setResults((current) => ({ ...current, [check.id]: result }));

        if (activeJob) {
          await bridge.recordVerificationResult({
            workspace,
            jobId: activeJob.id,
            checkId: check.id,
            command: check.command,
            success: result.success,
            durationMs,
          }).catch(() => {
            // Best-effort recording
          });
        }

        if (result.cancelled) break;
      } catch (cause) {
        const durationMs = Date.now() - started;
        const errMsg = errorMessage(cause);
        setResults((current) => ({
          ...current,
          [check.id]: { success: false, stderr: errMsg, operationId },
        }));

        if (activeJob) {
          await bridge.recordVerificationResult({
            workspace,
            jobId: activeJob.id,
            checkId: check.id,
            command: check.command,
            success: false,
            durationMs,
          }).catch(() => {
            // Best-effort recording
          });
        }

        break;
      } finally {
        setActive(null);
      }
    }
    onRunComplete?.();
  };


  const cancel = async () => {
    if (!active) return;
    await bridge.cancelOperation(active.operationId);
  };

  const coreChecks = plan?.checks.filter((check) => check.tier === "core") ?? [];

  return (
    <section className="verification-card" aria-label="Neutral verification">
      <div className="verification-heading">
        <span><TestTube2 size={12} /> Verification <small>{native ? "native" : "Windows app"}</small></span>
        <button type="button" onClick={() => void refresh()} title="Refresh verification plan" aria-label="Refresh verification plan" disabled={!native || !workspace || loading || Boolean(active)}>
          <RefreshCw className={loading ? "spin" : ""} size={12} />
        </button>
      </div>

      {!native ? (
        <div className="verification-notice"><ShieldCheck size={11} /> Real checks are available in the installed Windows app.</div>
      ) : !workspace ? (
        <div className="verification-notice"><TestTube2 size={11} /> Open a project to discover its verification commands.</div>
      ) : notice ? (
        <div className="verification-notice verification-error"><CircleAlert size={11} /> {notice}</div>
      ) : loading && !plan ? (
        <div className="verification-notice"><LoaderCircle className="spin" size={11} /> Inspecting project entry points…</div>
      ) : (
        <>
          <div className="verification-actions">
            <span>Commands are detected natively and only run when you choose them.</span>
            {active ? (
              <button type="button" className="verification-stop" onClick={() => void cancel()}><Square size={9} /> Stop</button>
            ) : (
              <button type="button" onClick={() => void run(coreChecks)} disabled={coreChecks.length === 0}>Run core</button>
            )}
          </div>

          {(plan?.warnings ?? []).map((warning) => <p className="verification-warning" key={warning}>{warning}</p>)}

          <div className="verification-list">
            {(plan?.checks ?? []).map((check) => {
              const result = results[check.id];
              const running = active?.id === check.id;
              return (
                <div className="verification-check" key={check.id}>
                  <div className="verification-check-main">
                    <span className={`verification-status ${running ? "running" : result ? resultLabel(result) : "idle"}`}>
                      {running ? <LoaderCircle className="spin" size={9} /> : result?.success ? <CheckCircle2 size={9} /> : <TestTube2 size={9} />}
                      {running ? "running" : result ? resultLabel(result) : check.tier}
                    </span>
                    <span><strong>{check.label}</strong><small>{check.source} · {Math.round(check.timeoutMs / 1000)}s limit</small></span>
                    <button type="button" onClick={() => void run([check])} disabled={Boolean(active)} aria-label={`Run ${check.label}`}>Run</button>
                  </div>
                  <code>{check.command}</code>
                  {result && trimOutput(result) && (
                    <details>
                      <summary>Evidence</summary>
                      <pre>{trimOutput(result)}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
