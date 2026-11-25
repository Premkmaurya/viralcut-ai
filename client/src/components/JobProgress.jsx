import React from 'react';
import { Loader2, CheckCircle, AlertTriangle, XCircle, RotateCcw, Video, Mic, FileText, Sparkles, Film, CheckCircle2 } from 'lucide-react';

export default function JobProgress({ job, onRetry, onCancel }) {
  if (!job) return null;

  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';
  const isCompleted = job.status === 'completed';
  const isAwaitingApproval = job.status === 'awaiting_approval' || job.stage === 'awaiting_approval';
  const isRendering = job.status === 'rendering' || job.stage === 'rendering';
  const isProcessing = job.status === 'processing' || job.status === 'pending';
  const isDemo = job.is_demo === 1 || (job.stage_message && job.stage_message.includes('DEMO MODE'));

  const stages = [
    { key: 'probing', label: '1. Probing', icon: Video },
    { key: 'extracting_audio', label: '2. Audio Extr.', icon: Mic },
    { key: 'transcribing', label: '3. Whisper AI', icon: FileText },
    { key: 'analyzing', label: '4. AI Analysis', icon: Sparkles },
    { key: 'awaiting_approval', label: '5. Candidates', icon: Film },
    { key: 'completed', label: '6. Verified MP4', icon: CheckCircle2 }
  ];

  const getStageStatus = (stageKey) => {
    if (isFailed && job.stage === stageKey) return 'error';

    if (stageKey === 'probing') {
      if (job.stage === 'probing') return 'current';
      return (job.duration > 0 || job.stage !== 'queued') ? 'completed' : 'upcoming';
    }

    if (stageKey === 'extracting_audio') {
      if (job.stage === 'extracting_audio') return 'current';
      if (['transcribing', 'analyzing', 'awaiting_approval', 'rendering', 'completed'].includes(job.stage)) return 'completed';
      return 'upcoming';
    }

    if (stageKey === 'transcribing') {
      if (job.stage === 'transcribing') return 'current';
      if (['analyzing', 'awaiting_approval', 'rendering', 'completed'].includes(job.stage)) return 'completed';
      return 'upcoming';
    }

    if (stageKey === 'analyzing') {
      if (job.stage === 'analyzing') return 'current';
      if (['awaiting_approval', 'rendering', 'completed'].includes(job.stage)) return 'completed';
      return 'upcoming';
    }

    if (stageKey === 'awaiting_approval') {
      if (isAwaitingApproval) return 'current';
      if (isRendering || isCompleted) return 'completed';
      return 'upcoming';
    }

    if (stageKey === 'completed') {
      if (isCompleted) return 'completed';
      if (isRendering) return 'current';
      return 'upcoming';
    }

    return 'upcoming';
  };

  const getStatusBadge = () => {
    if (isCompleted) {
      return {
        text: 'COMPLETED & VERIFIED',
        classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      };
    }
    if (isAwaitingApproval) {
      return {
        text: 'CANDIDATES READY (AWAITING RENDER)',
        classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      };
    }
    if (isRendering) {
      return {
        text: 'RENDERING SHORTS',
        classes: 'bg-rose-500/10 text-rose-300 border-rose-500/30 animate-pulse'
      };
    }
    if (isFailed) {
      return {
        text: 'FAILED',
        classes: 'bg-red-500/10 text-red-400 border-red-500/30'
      };
    }
    if (isCancelled) {
      return {
        text: 'CANCELLED',
        classes: 'bg-slate-700 text-slate-300 border-slate-600'
      };
    }
    return {
      text: (job.status || 'PROCESSING').toUpperCase(),
      classes: 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    };
  };

  const badge = getStatusBadge();

  return (
    <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <span>Job #{job.id}</span>
              {(isProcessing || isRendering) && (
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
              )}
            </h3>
            <span className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${badge.classes}`}>
              {badge.text}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Source: <span className="text-slate-200 font-medium">{job.source_name || job.url || 'Local Video'}</span>
            {job.duration > 0 && ` • Source Duration: ${Math.round(job.duration)}s`}
            {job.width > 0 && ` • Resolution: ${job.width}x${job.height}`}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {isFailed && (
            <button
              onClick={() => onRetry(job.id)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold rounded-lg border border-rose-500/30 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Pipeline</span>
            </button>
          )}

          {(isProcessing || isRendering) && (
            <button
              onClick={() => onCancel(job.id)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>

      {/* Demo Mode Notice Banner */}
      {isDemo && (
        <div className="flex items-start space-x-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider text-[11px] text-amber-200 block">DEMO MODE ACTIVE</span>
            <p className="mt-0.5 text-amber-300/90 leading-relaxed">
              faster-whisper is not available in the current Python environment. Synthetic transcript segments were generated for pipeline testing. To enable real Whisper AI transcription, install faster-whisper in Python with x86-64-v2 support.
            </p>
          </div>
        </div>
      )}

      {/* Stage Flow Indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2">
        {stages.map((st) => {
          const status = getStageStatus(st.key);
          const Icon = st.icon;

          return (
            <div
              key={st.key}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${
                status === 'completed'
                  ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
                  : status === 'current'
                  ? 'bg-rose-500/10 border-rose-500/40 text-rose-300 shadow-sm'
                  : status === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-slate-900/60 border-slate-800 text-slate-500'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                  status === 'completed'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : status === 'current'
                    ? 'bg-rose-500 text-white animate-pulse'
                    : status === 'error'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {status === 'completed' ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : status === 'current' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Icon className="w-3 h-3" />
                )}
              </div>
              <span className="font-semibold truncate text-[11px]">{st.label}</span>
            </div>
          );
        })}
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-300 font-medium">
            {job.stage_message || 'Processing video pipeline...'}
          </span>
          <span className="font-bold text-rose-400">{job.progress || 0}%</span>
        </div>
        <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden p-[1px] border border-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFailed
                ? 'bg-red-500'
                : isCompleted
                ? 'bg-emerald-500'
                : isAwaitingApproval
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-400'
            }`}
            style={{ width: `${Math.max(4, job.progress || 0)}%` }}
          ></div>
        </div>
      </div>

      {isFailed && (
        <div className="flex items-start space-x-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
          <div>
            <h5 className="font-bold text-red-200">Pipeline Execution Error</h5>
            <p className="mt-0.5 text-red-300/90">{job.error || 'An unexpected error occurred during processing.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
