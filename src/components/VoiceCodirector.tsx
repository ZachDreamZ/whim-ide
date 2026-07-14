import { useState } from 'react';
import { Mic, Loader2, Volume2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export function VoiceCodirector() {
  const [state, setState] = useState<VoiceState>('idle');
  const [isOpen, setIsOpen] = useState(true);

  // Simulate pushing to talk
  const handleMouseDown = () => {
    if (state !== 'idle' && state !== 'speaking') return;
    setState('listening');
    // In a real app, initialize microphone and start recording via Tauri command or browser API
  };

  const handleMouseUp = () => {
    if (state !== 'listening') return;
    setState('processing');

    // Simulate processing delay then speaking
    setTimeout(() => {
      setState('speaking');

      // Simulate speaking duration
      setTimeout(() => {
        setState('idle');
      }, 4000);
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <div className="bg-[#1e1e2e] rounded-2xl shadow-2xl border border-white/10 p-4 w-72 flex flex-col items-center gap-4 relative overflow-hidden group">

        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-2 right-2 p-1 text-white/30 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center w-full mt-2">
          <h3 className="text-sm font-semibold text-white">Voice Co-Director</h3>
          <p className="text-xs text-white/50 h-4 mt-1">
            {state === 'idle' && 'Hold to talk'}
            {state === 'listening' && 'Listening...'}
            {state === 'processing' && 'Thinking...'}
            {state === 'speaking' && 'Agent is speaking...'}
          </p>
        </div>

        <div className="relative flex justify-center items-center w-24 h-24 mb-2">
          {/* Pulsing background circles for listening/speaking */}
          <AnimatePresence>
            {(state === 'listening' || state === 'speaking') && (
              <>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1.5, opacity: 0.2 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
                  className={`absolute inset-0 rounded-full ${state === 'listening' ? 'bg-red-500' : 'bg-purple-500'}`}
                />
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1.8, opacity: 0.1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut", delay: 0.3 }}
                  className={`absolute inset-0 rounded-full ${state === 'listening' ? 'bg-red-500' : 'bg-purple-500'}`}
                />
              </>
            )}
          </AnimatePresence>

          {/* Main Button */}
          <button
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
              state === 'idle' ? 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 hover:border-white/20 hover:scale-105' :
              state === 'listening' ? 'bg-red-500 text-white scale-110 shadow-red-500/50' :
              state === 'processing' ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30' :
              'bg-purple-500 text-white shadow-purple-500/50'
            }`}
          >
            {state === 'idle' && <Mic className="w-6 h-6" />}
            {state === 'listening' && <Mic className="w-6 h-6 animate-pulse" />}
            {state === 'processing' && <Loader2 className="w-6 h-6 animate-spin" />}
            {state === 'speaking' && <Volume2 className="w-6 h-6 animate-pulse" />}
          </button>
        </div>

        {/* Audio Visualizer Mock */}
        <div className="w-full flex justify-center items-end gap-1 h-8 px-4 opacity-50">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className={`w-1.5 rounded-t-sm ${state === 'listening' ? 'bg-red-400' : state === 'speaking' ? 'bg-purple-400' : 'bg-white/20'}`}
              initial={{ height: '4px' }}
              animate={{
                height: (state === 'listening' || state === 'speaking') ? `${Math.random() * 24 + 4}px` : '4px'
              }}
              transition={{
                repeat: Infinity,
                duration: 0.2,
                repeatType: 'reverse',
                delay: i * 0.05
              }}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
