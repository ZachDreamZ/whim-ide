import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, MicOff, Volume2, X } from "lucide-react";
import { bridge, errorMessage } from "../../lib/bridge";

type Props = {
  onClose: () => void;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  voice?: string;
  language?: string;
  dictionary?: string;
  onTranscript: (text: string) => void;
  speakText?: string;
};

export function VoiceOrb({ onClose, provider, apiKey, baseUrl, voice, language, dictionary, onTranscript, speakText }: Props) {
  const [phase, setPhase] = useState<"listening" | "thinking" | "speaking" | "error">("listening");
  const [message, setMessage] = useState("Listening…");
  const [muted, setMuted] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrl = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("error");
      setMessage("Audio recording is unavailable on this device.");
      return;
    }
    chunks.current = [];
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((media) => {
      if (!active) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const next = new MediaRecorder(media);
      recorder.current = next;
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.start();
    }).catch((cause) => {
      setPhase("error");
      setMessage(errorMessage(cause));
    });
    return () => {
      active = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      activeAudio.current?.pause();
      if (activeAudioUrl.current) URL.revokeObjectURL(activeAudioUrl.current);
    };
  }, []);

  const finish = async () => {
    const current = recorder.current;
    if (!current || current.state !== "recording") return;
    setPhase("thinking");
    setMessage("Transcribing…");
    const blob = await new Promise<Blob>((resolve) => {
      current.onstop = () => resolve(new Blob(chunks.current, { type: current.mimeType || "audio/webm" }));
      current.stop();
    });
    stream.current?.getTracks().forEach((track) => track.stop());
    try {
      const audio = [...new Uint8Array(await blob.arrayBuffer())];
      const text = await bridge.transcribeVoice({ audio, mimeType: blob.type, provider, apiKey, baseUrl, language, prompt: dictionary?.trim() || undefined });
      setMessage(text);
      onTranscript(text);
    } catch (cause) {
      setPhase("error");
      setMessage(errorMessage(cause));
    }
  };

  const speak = async () => {
    if (!speakText) return;
    setPhase("speaking");
    setMessage("Speaking…");
    let objectUrl = "";
    try {
      const bytes = await bridge.synthesizeVoice({ text: [...speakText].slice(0, 4_096).join(""), provider, apiKey, baseUrl, voice });
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
      activeAudioUrl.current = objectUrl;
      const audio = new Audio(objectUrl);
      activeAudio.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(objectUrl);
        activeAudio.current = null;
        activeAudioUrl.current = null;
        setPhase("listening");
        setMessage("Finished");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        activeAudio.current = null;
        activeAudioUrl.current = null;
        setPhase("error");
        setMessage("The generated audio could not be played.");
      };
      await audio.play();
    } catch (cause) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      activeAudioUrl.current = null;
      setPhase("error");
      setMessage(errorMessage(cause));
    }
  };

  return <div className="voice-panel-overlay">
    <section className="voice-panel" aria-label="Voice session">
      <header><div><small>VOICE / {phase.toUpperCase()}</small><strong>Native audio session</strong></div><button onClick={onClose} title="Close voice"><X size={15}/></button></header>
      <div className={`voice-meter voice-meter-${phase}`} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <i key={`meter-${index}`} />)}
        {phase === "thinking" && <LoaderCircle className="spin" size={18}/>} 
      </div>
      <p>{message}</p>
      <div className="voice-controls">
        <button className="focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => { setMuted(!muted); stream.current?.getAudioTracks().forEach((track) => { track.enabled = muted; }); }}>{muted ? <MicOff size={15}/> : <Mic size={15}/>} {muted ? "Unmute" : "Mute"}</button>
        <button className="voice-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => void finish()} disabled={phase !== "listening"}>Transcribe</button>
        <button className="focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => void speak()} disabled={!speakText || phase === "thinking"}><Volume2 size={15}/> Read response</button>
      </div>
    </section>
  </div>;
}
