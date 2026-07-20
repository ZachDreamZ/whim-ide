import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  bridge,
  type MediaGenerateResult,
  type MediaRuntimeStatus,
} from "../lib/bridge";

type Mode = "image" | "ugc-video";

const unavailableRuntime: MediaRuntimeStatus = {
  codexAvailable: false,
  ffmpegAvailable: false,
  windowsVoiceAvailable: false,
};

const prompts: Record<Mode, string[]> = {
  image: [
    "A polished product hero shot with clean negative space",
    "A candid creator-style lifestyle ad for a productivity app",
    "A cinematic launch visual with original branding-free treatment",
  ],
  "ugc-video": [
    "Problem-solution testimonial for a time-saving app",
    "Founder-style product demo with a specific hook and honest CTA",
    "Three-scene creator ad showing before, discovery, and result",
  ],
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function CreativeStudio({ workspace, onOpenConfiguration }: { workspace: string; onOpenConfiguration?: () => void }) {
  const [mode, setMode] = useState<Mode>("image");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16">("9:16");
  const [durationSeconds, setDurationSeconds] = useState(18);
  const [runtime, setRuntime] = useState<MediaRuntimeStatus>(unavailableRuntime);
  const [loadingRuntime, setLoadingRuntime] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("Ready to create");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaGenerateResult | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const refreshRuntime = useCallback(async () => {
    setLoadingRuntime(true);
    try { setRuntime(await bridge.mediaRuntimeStatus()); }
    catch { setRuntime(unavailableRuntime); }
    finally { setLoadingRuntime(false); }
  }, []);

  useEffect(() => { void refreshRuntime(); }, [refreshRuntime]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setPreviews({});
    if (!result) return () => undefined;
    void Promise.all(result.artifacts.filter((artifact) => ["image", "video", "audio"].includes(artifact.kind)).map(async (artifact) => {
      const bytes = await bridge.readMediaArtifact(workspace, artifact.path);
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: artifact.mimeType }));
      urls.push(url);
      if (active) setPreviews((current) => ({ ...current, [artifact.path]: url }));
    })).catch((previewError) => {
      if (active) setError(`Output was created, but preview loading failed: ${previewError instanceof Error ? previewError.message : String(previewError)}`);
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [result, workspace]);

  const ready = runtime.codexAvailable
    && (mode === "image" || (runtime.ffmpegAvailable && runtime.windowsVoiceAvailable));
  const requirements = useMemo(() => [
    { label: "Codex CLI", ready: runtime.codexAvailable, detail: runtime.codexAvailable ? "Available" : "Not installed" },
    ...(mode === "ugc-video" ? [
      { label: "FFmpeg renderer", ready: runtime.ffmpegAvailable, detail: runtime.ffmpegAvailable ? "Available" : "Not installed" },
      { label: "Windows voice", ready: runtime.windowsVoiceAvailable, detail: runtime.windowsVoiceAvailable ? "Local" : "Unavailable" },
    ] : []),
  ], [mode, runtime]);

  const generate = async () => {
    if (!prompt.trim() || running || !ready) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress("Preparing isolated media workspace…");
    try {
      const next = await bridge.generateMedia({
        workspace,
        operationId: crypto.randomUUID(),
        mode,
        prompt: prompt.trim(),
        title: title.trim() || undefined,
        aspectRatio,
        durationSeconds: mode === "ugc-video" ? durationSeconds : undefined,
        onEvent: (event) => setProgress(event.message),
      });
      setResult(next);
      setProgress(next.summary);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : String(generationError));
      setProgress("Generation stopped");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="creative-studio" aria-label="Creative Studio">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow"><Sparkles size={13}/> Subscription-powered media agent</span>
          <h1>Creative Studio</h1>
          <p>Generate project images with Codex, or render a complete UGC video with an AI storyboard, original scenes, local voiceover, and captions.</p>
        </div>
        <button type="button" className="creative-refresh" onClick={() => void refreshRuntime()} disabled={loadingRuntime}>
          {loadingRuntime ? <LoaderCircle className="animate-spin" size={14}/> : <RefreshCw size={14}/>} Check runtimes
        </button>
      </header>

      <div className="creative-grid">
        <section className="creative-composer">
          <div className="creative-mode-tabs" role="tablist" aria-label="Media type">
            <button type="button" role="tab" aria-selected={mode === "image"} onClick={() => setMode("image")}><ImageIcon size={15}/> Image</button>
            <button type="button" role="tab" aria-selected={mode === "ugc-video"} onClick={() => setMode("ugc-video")}><Film size={15}/> UGC video</button>
          </div>

          <label className="creative-field"><span>Project title <small>optional</small></span><input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder={mode === "image" ? "Campaign visual" : "Creator launch ad"}/></label>
          <label className="creative-field"><span>Creative brief</span><textarea value={prompt} maxLength={8000} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "image" ? "Describe the subject, scene, audience, composition, and constraints…" : "Describe the product, audience, proof points, tone, and desired call to action…"}/></label>

          <div className="creative-suggestions">
            {prompts[mode].map((suggestion) => <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
          </div>

          <div className="creative-options">
            <label><span>Aspect</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}><option value="9:16">9:16 vertical</option><option value="16:9">16:9 landscape</option><option value="1:1">1:1 square</option></select></label>
            {mode === "ugc-video" && <label><span>Length</span><select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}><option value={12}>12 seconds</option><option value={18}>18 seconds</option><option value={24}>24 seconds</option><option value={30}>30 seconds</option></select></label>}
          </div>

          <div className="creative-requirements">
            {requirements.map((requirement) => <span key={requirement.label} className={requirement.ready ? "ready" : "missing"}>{requirement.ready ? <CheckCircle2 size={12}/> : <span className="requirement-dot"/>}<strong>{requirement.label}</strong><em>{requirement.detail}</em></span>)}
          </div>

          {!ready && <div className="creative-runtime-note">Whim never copies OAuth tokens. Sign in through the external harness itself, then refresh. {onOpenConfiguration && <button type="button" onClick={onOpenConfiguration}>Open configuration</button>}</div>}
          <button type="button" className="creative-generate" onClick={() => void generate()} disabled={!ready || !prompt.trim() || running}>
            {running ? <LoaderCircle className="animate-spin" size={17}/> : mode === "image" ? <ImageIcon size={17}/> : <Play size={17}/>} {running ? "Creating…" : mode === "image" ? "Generate image" : "Create UGC video"}
          </button>
          <div className="creative-progress" role="status"><span className={running ? "active" : ""}/>{progress}</div>
          {error && <div className="creative-error" role="alert">{error}</div>}
        </section>

        <section className="creative-output" aria-label="Generated media">
          {!result && <div className="creative-empty"><span>{mode === "image" ? <ImageIcon size={28}/> : <Film size={28}/>}</span><h2>{mode === "image" ? "Your image appears here" : "Your rendered campaign appears here"}</h2><p>Outputs are written under <code>.whim/media/</code> in the selected workspace.</p></div>}
          {result && <>
            <div className="creative-result-head"><div><span>Completed</span><h2>{result.title}</h2><p>{result.summary}</p></div><button type="button" onClick={() => void bridge.reveal(`${workspace}\\${result.outputDirectory.replace(/\//g, "\\")}`)}><FolderOpen size={14}/> Reveal</button></div>
            <div className="creative-artifacts">
              {result.artifacts.map((artifact) => <article key={artifact.path} className={`creative-artifact ${artifact.kind}`}>
                {artifact.kind === "image" && previews[artifact.path] && <img src={previews[artifact.path]} alt={`${result.title} generated scene`}/>}
                {artifact.kind === "video" && previews[artifact.path] && <video src={previews[artifact.path]} controls preload="metadata"/>}
                {artifact.kind === "audio" && previews[artifact.path] && <audio src={previews[artifact.path]} controls/>}
                <footer><span>{artifact.kind === "audio" ? <Volume2 size={13}/> : artifact.kind === "video" ? <Film size={13}/> : <ImageIcon size={13}/>} {artifact.kind}</span><code>{artifact.path}</code><em>{formatSize(artifact.sizeBytes)}</em></footer>
              </article>)}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}
