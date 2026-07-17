import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RefreshCw, X } from "lucide-react";
import { bridge, errorMessage, type NativeBrowserState } from "../lib/bridge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const initialState: NativeBrowserState = { open: false, url: null };

export function NativeBrowserHub() {
  const native = bridge.isNative();
  const [address, setAddress] = useState("https://www.google.com");
  const [browser, setBrowser] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(async (action: Parameters<typeof bridge.nativeBrowserAction>[0], url?: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await bridge.nativeBrowserAction(action, url);
      setBrowser(next);
      if (next.url) setAddress(next.url);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (native) void act("state");
  }, [act, native]);

  const navigate = () => void act(browser.open ? "navigate" : "open", address);

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col bg-background" aria-label="Native browser">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary"><Globe2 className="size-4.5" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-base font-semibold tracking-tight">Whim Browser</h1>
            <p className="text-xs text-muted-foreground">A persistent native WebView with no workspace or command permissions.</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-[10px] ${browser.open ? "bg-emerald-500/12 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
            {browser.open ? "Open" : "Closed"}
          </span>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-4 px-6 py-8">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" aria-label="Back" disabled={!browser.open || busy} onClick={() => void act("back")}><ArrowLeft /></Button>
            <Button variant="ghost" size="icon" aria-label="Forward" disabled={!browser.open || busy} onClick={() => void act("forward")}><ArrowRight /></Button>
            <Button variant="ghost" size="icon" aria-label="Reload" disabled={!browser.open || busy} onClick={() => void act("reload")}><RefreshCw className={busy ? "animate-spin" : ""} /></Button>
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
              <Input aria-label="Web address" value={address} onChange={(event) => setAddress(event.currentTarget.value)} placeholder="Search or enter an address" disabled={!native || busy} />
              <Button type="submit" disabled={!native || busy}><ExternalLink /> {browser.open ? "Go" : "Open"}</Button>
            </form>
            {browser.open && <Button variant="ghost" size="icon" aria-label="Close browser" disabled={busy} onClick={() => void act("close")}><X /></Button>}
          </div>
          {error && <p className="px-2 pt-2 text-xs text-destructive">{error}</p>}
        </div>

        <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <div className="max-w-md space-y-2">
            <Globe2 className="mx-auto size-7 text-muted-foreground" />
            <p className="text-sm font-medium">{native ? (browser.open ? "The native browser is ready in its own window." : "Open a site without leaving your Whim task.") : "Install and run the Windows app to use the native browser."}</p>
            <p className="text-xs leading-5 text-muted-foreground">The browser keeps its own cookies and browsing session. Web pages cannot call Whim file, process, agent, or credential commands.</p>
            {browser.open && <Button variant="outline" className="mt-2" onClick={() => void act("focus")}><ExternalLink /> Focus browser window</Button>}
          </div>
        </div>
      </section>
    </main>
  );
}
