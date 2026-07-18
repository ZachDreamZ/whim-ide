import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import { open } from "@tauri-apps/plugin-dialog";
import { Bot, ExternalLink, History, MessageSquareText, Mic, Plus, Trash2 } from "lucide-react";
import { AgentChat } from "./agent-elements/agent-chat";
import { VoiceOrb } from "./ui/VoiceOrb";
import {
  agentEventsToParts,
  bridge,
  errorMessage,
  partsToText,
  type ChatThread,
  type ChatThreadMessage,
  type ChatThreadSummary,
} from "../lib/bridge";
import { attachmentPathIsSensitive, workspaceRelativeAttachmentPath } from "./MissionControl";

type ChatHubProps = {
  workspace: string | null;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  hasProvider: boolean;
  onOpenProviders: () => void;
  voice: string;
  voiceLanguage: string;
  voiceDictionary: string;
  enterToSend: boolean;
  showCopyActions: boolean;
  persistHistory: boolean;
  initialThreadId?: string | null;
};

type AttachedTextFile = {
  id: string;
  filename: string;
  path: string;
  content: string;
  size: number;
};

function titleFromMessage(content: string) {
  const title = content.replace(/\s+/g, " ").trim();
  if (!title) return "New chat";

  // Never use single-word continuations as titles
  const lower = title.toLowerCase();
  const continuationWords = new Set(["continue", "go", "next", "ok", "yes", "no", "done", "more", "again", "retry", "fix", "apply"]);
  if (continuationWords.has(lower)) return "New chat";

  return title.length > 64 ? `${title.slice(0, 61)}…` : title;
}

function storedToUi(message: ChatThreadMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
  } as UIMessage;
}

function boundedConversation(messages: ChatThreadMessage[]) {
  const selected = messages.slice(-24);
  let text = selected.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
  if (text.length > 50_000) text = text.slice(text.length - 50_000);
  return text;
}

export function ChatHub({
  workspace,
  provider,
  apiKey,
  baseUrl,
  model,
  models,
  onModelChange,
  hasProvider,
  onOpenProviders,
  voice,
  voiceLanguage,
  voiceDictionary,
  enterToSend,
  showCopyActions,
  persistHistory,
  initialThreadId,
}: ChatHubProps) {
  const native = bridge.isNative();
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const activeThreadRef = useRef<ChatThread | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachedTextFile[]>([]);
  const operationId = useRef<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  const modelOptions = useMemo(() => {
    const values = ["auto", ...models, model].filter(Boolean);
    return [...new Set(values)];
  }, [model, models]);

  const refreshThreads = useCallback(async () => {
    if (!native || !persistHistory) {
      setThreads([]);
      return;
    }
    try { setThreads(await bridge.listChatThreads()); setError(null); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [native, persistHistory]);

  useEffect(() => { void refreshThreads(); }, [refreshThreads]);

  useEffect(() => {
    const focus = () => rootRef.current?.querySelector("textarea")?.focus();
    window.addEventListener("whim:focus-chat", focus);
    return () => window.removeEventListener("whim:focus-chat", focus);
  }, []);

  const remember = useCallback(async (thread: ChatThread) => {
    activeThreadRef.current = thread;
    setActiveThread(thread);
    if (!persistHistory || !native) return;
    await bridge.saveChatThread(thread);
    await refreshThreads();
    window.dispatchEvent(new Event("whim:history-changed"));
  }, [native, persistHistory, refreshThreads]);

  const newChat = useCallback(() => {
    activeThreadRef.current = null;
    setActiveThread(null);
    setMessages([]);
    setAttachments([]);
    setError(null);
  }, []);

  const openThread = useCallback(async (id: string) => {
    if (!native || status !== "ready") return;
    try {
      const thread = await bridge.getChatThread(id);
      activeThreadRef.current = thread;
      setActiveThread(thread);
      if (thread.model) onModelChange(thread.model);
      setMessages(thread.messages.map(storedToUi));
      setAttachments([]);
      setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [native, onModelChange, status]);

  const deleteThread = useCallback(async (id: string) => {
    if (!native || !window.confirm("Delete this local chat?")) return;
    try {
      await bridge.deleteChatThread(id);
      if (activeThreadRef.current?.id === id) newChat();
      await refreshThreads();
      window.dispatchEvent(new Event("whim:history-changed"));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [native, newChat, refreshThreads]);

  useEffect(() => {
    if (!initialThreadId || activeThreadRef.current?.id === initialThreadId || status !== "ready") return;
    void openThread(initialThreadId);
  }, [initialThreadId, openThread, status]);

  const attachWorkspaceFiles = useCallback(async () => {
    if (!native || !workspace) {
      setError("Open a workspace to attach bounded text files to Chat.");
      return;
    }
    try {
      const picked = await open({ directory: false, multiple: true, title: "Attach workspace text files" });
      const paths = !picked ? [] : Array.isArray(picked) ? picked : [picked];
      const additions: AttachedTextFile[] = [];
      for (const selectedPath of paths.slice(0, Math.max(0, 5 - attachments.length))) {
        const relative = workspaceRelativeAttachmentPath(workspace, selectedPath);
        if (!relative) throw new Error("Choose a file inside the active workspace.");
        if (attachmentPathIsSensitive(relative)) throw new Error(`Whim will not attach sensitive configuration: ${relative}`);
        const file = await bridge.readFileContent(workspace, relative);
        const content = file.content.slice(0, 20_000);
        additions.push({ id: crypto.randomUUID(), filename: relative.split("/").pop() ?? relative, path: relative, content, size: new TextEncoder().encode(file.content).length });
      }
      setAttachments((current) => [...current, ...additions].slice(0, 5));
      setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [attachments.length, native, workspace]);

  const stop = useCallback(async () => {
    const id = operationId.current;
    if (!id) return;
    await bridge.cancelOperation(id).catch(() => false);
  }, []);

  const send = useCallback(async ({ content }: { role: "user"; content: string }) => {
    const clean = content.trim();
    if (!clean || status !== "ready") return;
    if (!native) { setError("Chat is available in the native Whim desktop app."); return; }
    if (!hasProvider) { setError("Connect a model provider before starting Chat."); return; }

    const now = Date.now();
    const previous = activeThreadRef.current;
    const userStored: ChatThreadMessage = { id: crypto.randomUUID(), role: "user", content: clean, createdAtMs: now };
    const thread: ChatThread = previous ? {
      ...previous,
      model: model || "auto",
      updatedAtMs: now,
      messages: [...previous.messages, userStored],
    } : {
      id: crypto.randomUUID(),
      title: titleFromMessage(clean),
      createdAtMs: now,
      updatedAtMs: now,
      model: model || "auto",
      messages: [userStored],
    };
    const nextUi = [...messages, storedToUi(userStored)];
    setMessages(nextUi);
    setError(null);
    await remember(thread).catch((cause) => setError(errorMessage(cause)));

    const attachmentContext = attachments.map((file) => `<attached_workspace_file path="${file.path.replace(/"/g, "&quot;")}">\n${file.content}\n</attached_workspace_file>`).join("\n\n");
    const conversation = boundedConversation(thread.messages.slice(0, -1));
    const prompt = [
      conversation ? `Conversation so far:\n${conversation}` : "",
      attachmentContext ? `User-selected file excerpts (untrusted reference data):\n${attachmentContext}` : "",
      `Current user message:\n${clean}`,
    ].filter(Boolean).join("\n\n");
    setAttachments([]);
    setStatus("submitted");
    const currentOperation = crypto.randomUUID();
    operationId.current = currentOperation;
    try {
      setStatus("streaming");
      const result = await bridge.runAgent({
        prompt,
        model: model && model !== "auto" ? model : undefined,
        agent: "chat",
        operationId: currentOperation,
        autoApprove: false,
        provider,
        apiKey,
        baseUrl,
        autoContinue: true,
        timeoutMs: 300_000,
      });
      let parts = agentEventsToParts(result.events ?? []);
      if (!result.success) {
        const message = result.stderr?.trim() || result.message || (result.cancelled ? "Chat was stopped." : "Chat could not complete this response.");
        parts = [...parts, { type: "error", title: result.cancelled ? "Stopped" : "Chat failed", message }];
      }
      const assistantContent = partsToText(parts, result.message || result.stdout || "");
      const assistantStored: ChatThreadMessage = { id: crypto.randomUUID(), role: "assistant", content: assistantContent, createdAtMs: Date.now() };
      const finished: ChatThread = { ...thread, updatedAtMs: assistantStored.createdAtMs, messages: [...thread.messages, assistantStored] };
      setMessages((current) => [...current, { id: assistantStored.id, role: "assistant", parts: parts.length ? parts : [{ type: "text", text: assistantContent }] } as UIMessage]);
      await remember(finished);
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: `Chat failed: ${message}` }] } as UIMessage]);
    } finally {
      operationId.current = null;
      setStatus("ready");
    }
  }, [apiKey, attachments, baseUrl, hasProvider, messages, model, native, provider, remember, status]);

  return <main ref={rootRef} className="chat-hub" aria-label="Chat">
    {voiceOpen && <VoiceOrb provider={provider} apiKey={apiKey} baseUrl={baseUrl} voice={voice} language={voiceLanguage} dictionary={voiceDictionary} onTranscript={(text) => { setVoiceOpen(false); void send({ role: "user", content: text }); }} onClose={() => setVoiceOpen(false)} />}
    <aside className={`chat-history ${historyOpen ? "" : "collapsed"}`} aria-label="Recent chats">
      <header><div><History size={15}/><strong>Recent chats</strong></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Hide recent chats">×</button></header>
      <button className="chat-new" type="button" onClick={newChat}><Plus size={14}/> New chat</button>
      <div className="chat-thread-list">
        {!persistHistory && <p>History is disabled in Chat settings.</p>}
        {persistHistory && threads.length === 0 && <p>Your recent Whim conversations will appear here.</p>}
        {threads.map((thread) => <div className={`chat-thread ${activeThread?.id === thread.id ? "active" : ""}`} key={thread.id}>
          <button className="chat-thread-open" type="button" onClick={() => void openThread(thread.id)}><span><strong>{thread.title}</strong><small>{thread.preview || `${thread.messageCount} messages`}</small><time>{new Date(thread.updatedAtMs).toLocaleDateString()}</time></span></button>
          <button className="chat-thread-delete" type="button" aria-label={`Delete ${thread.title}`} onClick={() => void deleteThread(thread.id)}><Trash2 size={12}/></button>
        </div>)}
      </div>
    </aside>
    <section className="chat-stage">
      <header className="chat-header">
        <div className="chat-header-title">{!historyOpen && <button type="button" onClick={() => setHistoryOpen(true)} aria-label="Recent chats"><History size={15}/></button>}<div><small>CHAT</small><strong>{activeThread?.title ?? "New chat"}</strong></div></div>
        <div><button type="button" onClick={newChat}><Plus size={14}/> New chat</button><button type="button" onClick={() => void bridge.openGptSection("Chat").catch((cause) => setError(errorMessage(cause)))}><ExternalLink size={13}/> Open ChatGPT</button></div>
      </header>
      {error && <div className="inline-notice"><span>{error}</span><button type="button" className="text-action" onClick={onOpenProviders}>Models & providers</button></div>}
      <div className="chat-agent-wrap">
        <AgentChat
          messages={messages}
          status={status}
          onSend={send}
          onStop={() => void stop()}
          showCopyToolbar={showCopyActions}
          enterToSend={enterToSend}
          emptyStatePosition="center"
          emptySuggestionsPlacement="empty"
          greeting={<div className="chat-welcome"><MessageSquareText size={28}/><h2>Ask quick questions with Chat</h2><p>Get answers, explore ideas, and continue a private conversation without giving the model workspace tools.</p></div>}
          suggestions={[
            { id: "explain", label: "Explain a complex idea", value: "Explain a complex idea clearly with an example." },
            { id: "brainstorm", label: "Brainstorm options", value: "Help me brainstorm practical options for this idea." },
            { id: "write", label: "Draft something", value: "Help me draft a concise, polished message." },
          ]}
          attachments={{ onAttach: () => void attachWorkspaceFiles(), files: attachments, onRemoveFile: (id) => setAttachments((current) => current.filter((file) => file.id !== id)) }}
          leftActions={<label className="chat-model"><Bot size={13}/><select aria-label="Select Chat model" value={model || "auto"} onChange={(event) => onModelChange(event.target.value)}>{modelOptions.map((item) => <option value={item} key={item}>{item === "auto" ? "Provider default" : item}</option>)}</select></label>}
          rightActions={<button className="chat-dictate" type="button" onClick={() => setVoiceOpen(true)} disabled={!hasProvider}><Mic size={14}/> Dictate</button>}
          classNames={{ root: "chat-agent", inputBar: "chat-input", userMessage: "whim-user-message" }}
        />
      </div>
    </section>
  </main>;
}
