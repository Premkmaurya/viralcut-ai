import React, { useState } from 'react';
import { Download, Settings, Clock, Sparkles, Check, Loader2, AlertCircle, Film, CheckCircle2 } from 'lucide-react';

export default function ClipCard({ clip, onEdit, onDownload, onRender }) {
  const isRendering = clip.render_status === 'rendering';
  const isCompleted = clip.render_status === 'completed';
  const isFailed = clip.render_status === 'failed';

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const formatTime = (secs) => {
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  const formatDuration = (secs) => {
    const s = Math.round(secs);
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return `${m}m ${rem}s`;
    }
    return `${s}s`;
  };

  const getScoreBadgeColor = (score) => {
    if (score >= 85) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (score >= 70) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
  };

  const handleDownloadClick = async () => {
    if (!isCompleted) {
      setDownloadError('Video file is not available yet. Please render the short first.');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    try {
      if (onDownload) {
        await onDownload(clip.id);
      }
    } catch (err) {
      setDownloadError(err.message || 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="bg-[#0f172a] rounded-2xl border border-slate-800 hover:border-slate-700 p-5 shadow-lg flex flex-col justify-between transition-all duration-200 group">
      <div>
        {/* Top Header: Score, Status & Duration */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center space-x-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getScoreBadgeColor(
                clip.score
              )}`}
            >
              ★ {Math.round(clip.score)} Score
            </span>
            <span className="text-[11px] font-semibold text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
              {clip.topic || 'General'}
            </span>
          </div>

          <div className="flex items-center space-x-1 text-xs text-slate-400 font-mono">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>
              {formatTime(clip.start_time)} - {formatTime(clip.end_time)}
            </span>
            <span className="text-rose-400 font-semibold">({formatDuration(clip.duration)})</span>
          </div>
        </div>

        {/* Title */}
        <h4 className="text-base font-bold text-white group-hover:text-rose-400 transition mb-2 line-clamp-2">
          {clip.title}
        </h4>

        {/* Opening Hook */}
        {clip.hook && (
          <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/80 mb-3 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block mb-1">
              Opening Hook
            </span>
            <p className="text-slate-300 italic line-clamp-2 font-serif">"{clip.hook}"</p>
          </div>
        )}

        {/* Rationale */}
        <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
          {clip.reason}
        </p>
      </div>

      {/* Footer / Status / Actions */}
      <div className="pt-3 border-t border-slate-800/80 space-y-3">
        {/* Rendering progress bar */}
        {isRendering && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-rose-400 font-semibold">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Rendering vertical MP4...
              </span>
              <span>{clip.render_progress || 10}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-rose-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${clip.render_progress || 10}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Completed status banner */}
        {isCompleted && (
          <div className="flex items-center justify-between text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20">
            <span className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              <span>MP4 Ready to Download</span>
            </span>
            {clip.output_size > 0 && (
              <span className="text-[10px] text-emerald-300/80 font-mono">
                {(clip.output_size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </div>
        )}

        {/* Notice when video file is not yet rendered */}
        {!isCompleted && !isRendering && !isFailed && (
          <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-slate-800">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
              <span>Candidate moment (Not rendered yet)</span>
            </span>
            {onRender && (
              <button
                onClick={() => onRender(clip.id)}
                className="text-[11px] font-bold text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1"
              >
                <Film className="w-3 h-3" /> Render Now
              </button>
            )}
          </div>
        )}

        {/* Failed render notice */}
        {isFailed && (
          <div className="flex items-center justify-between text-[11px] text-red-400 bg-red-500/10 px-2.5 py-1.5 rounded-xl border border-red-500/20">
            <span className="flex items-center gap-1.5 truncate">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Render failed: {clip.error || 'Check server logs'}</span>
            </span>
            {onRender && (
              <button
                onClick={() => onRender(clip.id)}
                className="text-[10px] font-bold uppercase underline ml-2 text-red-300 hover:text-white shrink-0"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Download error notice */}
        {downloadError && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 p-2.5 rounded-xl border border-red-500/20">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{downloadError}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => onEdit(clip)}
            className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            <span>Trim & Style</span>
          </button>

          {isCompleted ? (
            <button
              disabled={isDownloading}
              onClick={handleDownloadClick}
              className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Short</span>
                </>
              )}
            </button>
          ) : (
            <button
              disabled
              className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-800/80 text-slate-500 cursor-not-allowed text-xs font-semibold rounded-xl border border-slate-700/50"
              title="Render the Short first before downloading"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Download Short</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
