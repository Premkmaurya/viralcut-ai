import React, { useState, useRef, useEffect } from 'react';
import { X, Play, Pause, Save, Download, Palette, Scissors, Sparkles, Check, AlertCircle, Loader2 } from 'lucide-react';

export default function ClipEditorModal({ clip, job, onClose, onDownload, onRender }) {
  if (!clip) return null;

  const isCompleted = clip.render_status === 'completed';

  const [startTime, setStartTime] = useState(clip.start_time);
  const [endTime, setEndTime] = useState(clip.end_time);
  const [title, setTitle] = useState(clip.title);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.start_time);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Caption Styling State
  let initialStyle = {
    fontSize: 56,
    primaryColor: '#FFFF00',
    outlineColor: '#000000',
    marginV: 320
  };

  if (clip.caption_style) {
    try {
      const parsed = typeof clip.caption_style === 'string'
        ? JSON.parse(clip.caption_style)
        : clip.caption_style;
      initialStyle = { ...initialStyle, ...parsed };
    } catch (e) {
      // Default style
    }
  }

  const [captionStyle, setCaptionStyle] = useState(initialStyle);
  const videoRef = useRef(null);

  const duration = Math.max(0, endTime - startTime);
  const maxVideoDuration = job?.duration || 3600;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
    }
  }, [startTime]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    setCurrentTime(curr);

    // Loop back to start if it crosses end
    if (curr >= endTime) {
      videoRef.current.currentTime = startTime;
      if (!isPlaying) videoRef.current.pause();
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < startTime || videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSave = async () => {
    setValidationError('');

    if (endTime <= startTime) {
      setValidationError('End time must be greater than start time.');
      return;
    }

    if (duration < 10) {
      setValidationError('Clip duration must be at least 10 seconds.');
      return;
    }

    if (duration > 180) {
      setValidationError('YouTube Shorts cannot exceed 180 seconds (3 minutes) under current platform rules.');
      return;
    }

    setIsSaving(true);

    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          start_time: startTime,
          end_time: endTime,
          caption_style: captionStyle
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update clip');
      }

      const data = await res.json();
      setIsSaving(false);
      onClose(data.clip);

    } catch (err) {
      setIsSaving(false);
      setValidationError(err.message);
    }
  };

  const handleDownloadShort = async () => {
    if (!isCompleted) {
      setValidationError('Video file is not available yet.');
      return;
    }

    setIsDownloading(true);
    setValidationError('');

    try {
      if (onDownload) {
        await onDownload(clip.id);
      }
    } catch (err) {
      setValidationError(err.message || 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const colorOptions = [
    { label: 'Viral Yellow', hex: '#FFFF00' },
    { label: 'Clean White', hex: '#FFFFFF' },
    { label: 'Cyan Glow', hex: '#00FFFF' },
    { label: 'Neon Green', hex: '#39FF14' },
    { label: 'Hot Pink', hex: '#FF1493' }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0f172a] border border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Scissors className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-white">Clip Trimmer & Caption Studio</h3>
          </div>
          <button
            onClick={() => onClose()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Video Preview Player */}
          <div className="md:col-span-7 flex flex-col items-center">
            <div className="relative w-full max-w-[340px] aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex items-center justify-center">
              {job?.id ? (
                <video
                  ref={videoRef}
                  src={`/api/jobs/${job.id}/video`}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="w-full h-full object-contain"
                  playsInline
                />
              ) : (
                <div className="text-slate-500 text-xs">Video unavailable</div>
              )}

              {/* Subtitle Overlay Mockup */}
              <div
                className="absolute inset-x-4 text-center pointer-events-none select-none font-bold uppercase transition-all"
                style={{
                  bottom: `${captionStyle.marginV ? Math.round(captionStyle.marginV * 0.18) : 55}px`,
                  fontSize: `${Math.round(captionStyle.fontSize * 0.35)}px`,
                  color: captionStyle.primaryColor,
                  textShadow: `-1.5px -1.5px 0 ${captionStyle.outlineColor}, 1.5px -1.5px 0 ${captionStyle.outlineColor}, -1.5px 1.5px 0 ${captionStyle.outlineColor}, 1.5px 1.5px 0 ${captionStyle.outlineColor}, 0 2px 4px rgba(0,0,0,0.8)`
                }}
              >
                {clip.hook ? clip.hook.slice(0, 35) : "VIRAL CAPTION PREVIEW"}
              </div>

              {/* Overlay Play Button */}
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition group"
              >
                <div className="w-14 h-14 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition">
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                </div>
              </button>
            </div>

            {/* Current playback time */}
            <div className="mt-3 text-xs font-mono text-slate-400">
              Position: <span className="text-rose-400 font-bold">{currentTime.toFixed(1)}s</span> / {duration.toFixed(1)}s
            </div>
          </div>

          {/* Right Column: Controls */}
          <div className="md:col-span-5 space-y-5">
            {/* Title edit */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Clip Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* Trim Timestamps */}
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-rose-500" /> Trim Range
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-extrabold text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/20">
                    {duration.toFixed(1)}s Duration
                  </span>
                  {duration >= 60 && duration <= 90 && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Sweet Spot (60–90s)
                    </span>
                  )}
                  {duration > 90 && duration <= 180 && (
                    <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                      Extended (≤180s)
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Start (Seconds)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={maxVideoDuration}
                    value={startTime}
                    onChange={(e) => setStartTime(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">End (Seconds)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={maxVideoDuration}
                    value={endTime}
                    onChange={(e) => setEndTime(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* Caption Customization */}
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 space-y-4">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-rose-500" /> Caption Styling
              </span>

              {/* Color Selector */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1.5">Primary Caption Color</label>
                <div className="flex gap-2">
                  {colorOptions.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => setCaptionStyle({ ...captionStyle, primaryColor: c.hex })}
                      className={`w-7 h-7 rounded-full border-2 transition ${
                        captionStyle.primaryColor === c.hex ? 'border-white scale-110 shadow-md' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Font Size</span>
                  <span className="font-mono text-white">{captionStyle.fontSize}pt</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="76"
                  step="2"
                  value={captionStyle.fontSize}
                  onChange={(e) => setCaptionStyle({ ...captionStyle, fontSize: parseInt(e.target.value, 10) })}
                  className="w-full accent-rose-500 cursor-pointer"
                />
              </div>

              {/* Vertical Position */}
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Vertical Position (Bottom Offset)</span>
                  <span className="font-mono text-white">{captionStyle.marginV}px</span>
                </div>
                <input
                  type="range"
                  min="160"
                  max="460"
                  step="20"
                  value={captionStyle.marginV}
                  onChange={(e) => setCaptionStyle({ ...captionStyle, marginV: parseInt(e.target.value, 10) })}
                  className="w-full accent-rose-500 cursor-pointer"
                />
              </div>
            </div>

            {!isCompleted && (
              <div className="flex items-center space-x-2 text-xs text-amber-400 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Video file is not available yet.</span>
              </div>
            )}

            {validationError && (
              <div className="flex items-center space-x-2 text-xs text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={() => onClose()}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>

          <div className="flex items-center space-x-3">
            <button
              disabled={isSaving}
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition"
            >
              <Save className="w-4 h-4" />
              <span>Save Trim</span>
            </button>

            {isCompleted ? (
              <button
                disabled={isDownloading}
                onClick={handleDownloadShort}
                className="flex items-center space-x-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition cursor-pointer"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Short</span>
                  </>
                )}
              </button>
            ) : (
              <>
                {onRender && (
                  <button
                    onClick={async () => {
                      await handleSave();
                      onRender(clip.id);
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl shadow-md shadow-rose-600/20 transition cursor-pointer"
                  >
                    <span>Save & Render</span>
                  </button>
                )}
                <button
                  disabled
                  className="flex items-center space-x-2 px-5 py-2 bg-slate-800 text-slate-500 cursor-not-allowed text-xs font-semibold rounded-xl border border-slate-700/50"
                  title="Render this clip first to make it available for download"
                >
                  <Download className="w-4 h-4 text-slate-500" />
                  <span>Download Short</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
