import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, Mic, Cpu } from "lucide-react";
import { Button } from "./ui/button";
import { bridge } from "../lib/bridge";

type MessageComposerProps = {
  onSend: (content: string) => void;
  onStop?: () => void;
  isRunning?: boolean;
  placeholder?: string;
  projectName?: string;
  modelLabel?: string;
  micSupported?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  onOpenProviders?: () => void;
};

export function MessageComposer({
  onSend,
  onStop,
  isRunning = false,
  placeholder = "What do you want to build?",
  modelLabel,
  micSupported = false,
  provider,
  apiKey,
  baseUrl,
  onOpenProviders,
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingSupported =
    micSupported &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!isRunning && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isRunning]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed);
    setValue("");
  }, [value, isRunning, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!recordingSupported || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const buffer = new Uint8Array(await blob.arrayBuffer());
        setTranscribing(true);
        try {
          const transcript = await bridge.transcribeVoice({
            audio: Array.from(buffer),
            mimeType: blob.type,
            provider,
            apiKey,
            baseUrl,
          });
          if (transcript.trim()) {
            setValue((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
          }
        } catch {
          // Voice transcription failed; keep any existing draft text.
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      // Microphone permission denied or unavailable.
    }
  }, [recordingSupported, recording, provider, apiKey, baseUrl]);

  return (
    <div className="message-composer">
      <div className="message-composer-inner">
        <button
          type="button"
          className="composer-attach-button"
          aria-label="Attach files"
        >
          <Paperclip size={16} />
        </button>
        {modelLabel && (
          <button
            type="button"
            className="composer-model-chip"
            onClick={onOpenProviders}
            aria-label={`Model: ${modelLabel}. Click to change.`}
          >
            <Cpu size={13} />
            <span>{modelLabel}</span>
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Auto-resize
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isRunning}
        />
        {recordingSupported && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Record voice"}
            className={recording ? "composer-mic-button composer-mic-button--active" : "composer-mic-button"}
            disabled={transcribing}
          >
            <Mic size={16} />
          </Button>
        )}
        {isRunning ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onStop}
            aria-label="Stop"
            className="composer-stop-button"
          >
            <Square size={16} />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon-sm"
            onClick={handleSend}
            disabled={!value.trim() || transcribing}
            aria-label="Send"
            className="composer-send-button"
          >
            <ArrowUp size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
