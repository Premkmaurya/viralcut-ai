import React from 'react';
import { Scissors, History, Cpu, ShieldCheck } from 'lucide-react';

export default function Header({ onOpenHistory, historyCount = 0 }) {
  return (
    <header className="border-b border-slate-800 bg-[#0c1222]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 via-rose-500 to-amber-400 p-[1px] shadow-lg shadow-rose-500/20">
            <div className="w-full h-full bg-[#090d16] rounded-[11px] flex items-center justify-center">
              <Scissors className="w-5 h-5 text-rose-500 -rotate-45" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                ViralCut <span className="text-rose-500">AI</span>
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                Local v1.0
              </span>
            </div>
            <p className="text-xs text-slate-400">Long-Form to Vertical YouTube Shorts</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-medium text-slate-400">Engine:</span>
            <span className="font-semibold text-emerald-400">100% Local (Free)</span>
          </div>

          <button
            onClick={onOpenHistory}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700/60 transition shadow-sm"
          >
            <History className="w-4 h-4 text-slate-400" />
            <span>Jobs</span>
            {historyCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 text-[11px] bg-rose-500/20 text-rose-300 rounded-full font-bold">
                {historyCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
