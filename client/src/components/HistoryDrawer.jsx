import React from 'react';
import { X, Clock, Video, Trash2, ArrowUpRight, CheckCircle2, AlertCircle } from 'lucide-react';

export default function HistoryDrawer({ isOpen, onClose, jobs = [], currentJobId, onSelectJob, onDeleteJob }) {
  if (!isOpen) return null;

  const formatDate = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-md bg-[#0f172a] border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-white">Processing History</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Jobs List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {jobs.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs">
              No processing jobs recorded yet.
            </div>
          ) : (
            jobs.map((j) => {
              const isSelected = j.id === currentJobId;
              const isCompleted = j.status === 'completed';
              const isFailed = j.status === 'failed';

              return (
                <div
                  key={j.id}
                  className={`p-4 rounded-2xl border transition flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'bg-rose-500/10 border-rose-500/40 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-white">#{j.id}</span>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.2 rounded-full ${
                            isCompleted
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : isFailed
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {j.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                        {j.source_name || j.url || 'Local Video'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {formatDate(j.created_at)} {j.duration > 0 && `• ${Math.round(j.duration)}s`}
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete job ${j.id} and cleanup files?`)) {
                          onDeleteJob(j.id);
                        }
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition"
                      title="Delete job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {j.stage_message || j.stage}
                    </span>

                    <button
                      onClick={() => {
                        onSelectJob(j.id);
                        onClose();
                      }}
                      className="flex items-center space-x-1 text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
                    >
                      <span>Load Clips</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
