import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Volume2, X } from "lucide-react";
import { bridge, errorMessage } from "../../lib/bridge";

type Props = {
  enabled: boolean;
  wakePhrase: string;
  autoSpeak: boolean;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  voice?: string;
  language?: string;
  dictionary?: string;
};

type Phase = "idle" | "listening" | "transcribing" | "speaking" | "error";

const SEGMENT_MS = 4_000;

export function AmbientVoiceBar(props: Props) {
  const { enabled, wakePhrase, autoSpeak, provider, apiKey, baseUrl, voice, language, dictionary } = props;
  const [phase, setPhase] = useState<Phase>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const running = useRef(false);
  const loop = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    void start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!autoSpeak) return;
    const off = bridge.onAssistantText((text) => {
      setPhase("speaking");
      setHint("Speaking response…");
      void bridge.speakText({ text, provider, apiKey, baseUrl, voice }).finally(() => {
        if (running.current) setPhase("listening");
      });
    });
    return off;
  }, [autoSpeak, provider, apiKey, baseUrl, voice]);

  const stop = () => {
    running.current = false;
    if (loop.current) { window.clearTimeout(loop.current); loop.current = null; }
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setPhase("idle");
  };

  const start = async () => {
    if (running.current || !enabled) return;
    running.current = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      running.current = false;
      setPhase("error");
      setHint("Audio recording is unavailable on this device.");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      running.current = false;
      // Torn down (e.g. toggled off) while the permission prompt was pending:
      // don't surface or keep a stream.
      if (!enabled) return;
      setPhase("error");
      setHint(errorMessage(cause));
      return;
    }
    if (!enabled) {
      running.current = false;
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = media;
    setPhase("listening");
    setHint(wakePhrase.trim() ? `Listening for “${wakePhrase.trim()}”…` : "Listening…");
    void captureLoop();
  };

  const captureLoop = async () => {
    if (!running.current || !stream.current) return;
    chunks.current = [];
    const next = new MediaRecorder(stream.current);
    recorder.current = next;
    next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    next.onstop = () => void processSegment();
    next.start();
    loop.current = window.setTimeout(() => {
      if (recorder.current?.state === "recording") recorder.current.stop();
    }, SEGMENT_MS);
  };

  const processSegment = async () => {
    if (!running.current) return;
    const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || "audio/webm" });
    chunks.current = [];
    if (blob.size > 1_000) {
      setPhase("transcribing");
      try {
        const audio = [...new Uint8Array(await blob.arrayBuffer())];
        const text = await bridge.transcribeVoice({
          audio,
          mimeType: blob.type,
          provider,
          apiKey,
          baseUrl,
          language,
          prompt: dictionary?.trim() || undefined,
        });
        const trimmed = text.trim();
        const wake = wakePhrase.trim();
        if (trimmed) {
          if (wake) {
            const match = trimmed.toLowerCase().indexOf(wake.toLowerCase());
            if (match >= 0) {
              const command = (trimmed.slice(0, match) + trimmed.slice(match + wake.length)).trim();
              if (command) { setHint(`Heard: ${command}`); bridge.emitAmbientCommand(command); }
            }
          } else {
            setHint(`Heard: ${trimmed.slice(0, 80)}`);
            bridge.emitAmbientCommand(trimmed);
          }
        }
      } catch (cause) {
        setHint(errorMessage(cause));
      }
    }
    if (running.current) {
      setPhase("listening");
      void captureLoop();
    }
  };

  if (!enabled) return null;

  return (
    <div className={`ambient-voice ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="ambient-toggle focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setExpanded((value) => !value)}
        aria-label={expanded ? "Collapse ambient voice" : "Expand ambient voice"}
        title="Ambient voice mode"
      >
        {phase === "transcribing" && <LoaderCircle className="spin" size={14} />}
        {phase === "speaking" && <Volume2 size={14} />}
        {(phase === "listening" || phase === "idle") && <Mic size={14} />}
        {phase === "error" && <X size={14} />}
        <span className={`ambient-dot ambient-${phase}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="ambient-panel" role="status">
          <div className="ambient-row">
            <strong>Ambient voice</strong>
            <button type="button" className="ambient-close focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => setExpanded(false)} aria-label="Close"><X size={13} /></button>
          </div>
          <p>{hint ?? "Active"}</p>
          <small>{autoSpeak ? "Speaks responses aloud." : "Listening only."}</small>
        </div>
      )}
    </div>
  );
}
