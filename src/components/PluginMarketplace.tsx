import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plug, Download, Check, X } from 'lucide-react';

export interface AgentPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  repository: string;
}

export function PluginMarketplace({ onClose }: { onClose: () => void }) {
  const [available, setAvailable] = useState<AgentPlugin[]>([]);
  const [installed, setInstalled] = useState<AgentPlugin[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    try {
      const avail = await invoke<AgentPlugin[]>('fetch_available_plugins');
      const inst = await invoke<AgentPlugin[]>('get_installed_plugins');
      setAvailable(avail);
      setInstalled(inst);
    } catch (e) {
      console.error("Failed to load plugins:", e);
    }
  };

  const handleInstall = async (pluginId: string) => {
    setInstalling(pluginId);
    try {
      await invoke('install_plugin', { pluginId });
      await loadPlugins();
    } catch (e) {
      console.error("Install failed:", e);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1e1e2e] w-[800px] max-h-[80vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-purple-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Plug className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Agent Plugin Marketplace</h2>
              <p className="text-sm text-white/50">Equip your agents with new tools and skills.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-[#1e1e2e]/50">
          <div className="grid grid-cols-2 gap-4">
            {available.map(plugin => {
              const isInstalled = installed.some(p => p.id === plugin.id);
              const isInstalling = installing === plugin.id;

              return (
                <div key={plugin.id} className="bg-[#2a2a3c] border border-white/5 rounded-xl p-5 hover:border-purple-500/30 transition-all flex flex-col group">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">{plugin.name}</h3>
                    <span className="text-xs px-2 py-1 bg-black/30 rounded-full text-white/50 font-mono">{plugin.version}</span>
                  </div>
                  <p className="text-sm text-white/60 mb-6 flex-1">{plugin.description}</p>

                  <div className="flex justify-between items-center mt-auto pt-4 border-t border-white/5">
                    <span className="text-xs text-white/40">By {plugin.author}</span>
                    <button
                      onClick={() => !isInstalled && !isInstalling && handleInstall(plugin.id)}
                      disabled={isInstalled || isInstalling}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        isInstalled
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : isInstalling
                            ? 'bg-purple-500/50 text-white animate-pulse'
                            : 'bg-white/5 hover:bg-purple-500 hover:text-white border border-white/10 hover:border-purple-400'
                      }`}
                    >
                      {isInstalled ? (
                        <><Check className="w-4 h-4" /> Installed</>
                      ) : isInstalling ? (
                        <><Download className="w-4 h-4 animate-bounce" /> Installing...</>
                      ) : (
                        <><Download className="w-4 h-4" /> Install</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
