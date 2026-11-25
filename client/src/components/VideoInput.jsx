import React, { useState, useRef } from 'react';
import { UploadCloud, Youtube, AlertCircle, FileVideo, CheckCircle2, ArrowRight, ShieldAlert, Sparkles, Sliders, Clock } from 'lucide-react';

export default function VideoInput({ onJobCreated, isProcessing }) {
  const [tab, setTab] = useState('local'); // 'local' or 'youtube'
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [urlGuidance, setUrlGuidance] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Configurable clip duration settings
  const [minDuration, setMinDuration] = useState(60);
  const [maxDuration, setMaxDuration] = useState(180);
  const [showSettings, setShowSettings] = useState(false);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file) => {
    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo'];
    const validExtensions = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
      alert('Please upload a valid video file (.mp4, .mov, .mkv, .webm)');
      return;
    }

    setSelectedFile(file);
    setUrlGuidance(null);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('min_duration', minDuration);
    formData.append('max_duration', maxDuration);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/jobs/upload', true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        if (xhr.status === 201) {
          const res = JSON.parse(xhr.responseText);
          setSelectedFile(null);
          onJobCreated(res.job);
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            alert(`Upload failed: ${err.error || 'Server error'}`);
          } catch (e) {
            alert('Upload failed. Please try again.');
          }
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        alert('Network error during video upload.');
      };

      xhr.send(formData);

    } catch (err) {
      setIsUploading(false);
      alert(`Error starting upload: ${err.message}`);
    }
  };

  const handleYoutubeSubmit = async (e) => {
    e.preventDefault();
    setUrlError('');
    setUrlGuidance(null);

    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setUrlError('Please enter a YouTube video URL.');
      return;
    }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          min_duration: minDuration,
          max_duration: maxDuration
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.requires_local_upload) {
          setUrlGuidance(data);
        } else {
          setUrlError(data.error || 'Failed to validate YouTube URL.');
        }
        return;
      }

      setYoutubeUrl('');
      onJobCreated(data.job);

    } catch (err) {
      setUrlError(`Connection error: ${err.message}`);
    }
  };

  return (
    <div className="bg-[#0f172a] rounded-2xl border border-slate-800 shadow-xl overflow-hidden p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-800/80 gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-rose-500" />
            <span>Select Long-Form Video Source</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Feed any long video. Our AI pipeline finds 60–90s compelling highlight moments (up to 180s platform maximum) and formats them into vertical 9:16 Shorts.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex p-1 bg-slate-900 rounded-xl border border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setTab('local')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'local'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Authorized Video</span>
          </button>
          <button
            onClick={() => setTab('youtube')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
              tab === 'youtube'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Youtube className="w-4 h-4" />
            <span>YouTube URL</span>
          </button>
        </div>
      </div>

      {/* Duration Configuration Widget */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowSettings(!showSettings)}>
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-rose-400" />
            <span className="text-xs font-bold text-slate-200">Clip Duration Settings</span>
            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              Target: 60–90s • Min: {minDuration}s • Max: {maxDuration}s
            </span>
          </div>
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 font-medium"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showSettings ? 'Hide Options' : 'Configure Durations'}</span>
          </button>
        </div>

        {showSettings && (
          <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Minimum Duration</span>
                <span className="font-mono font-bold text-rose-400">{minDuration}s</span>
              </div>
              <input
                type="range"
                min="30"
                max="90"
                step="5"
                value={minDuration}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMinDuration(val);
                  if (val > maxDuration) setMaxDuration(val);
                }}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Clips will sustain at least {minDuration}s without padding.</span>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Maximum Duration (YouTube Shorts Limit: 180s)</span>
                <span className="font-mono font-bold text-rose-400">{maxDuration}s</span>
              </div>
              <input
                type="range"
                min="60"
                max="180"
                step="5"
                value={maxDuration}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMaxDuration(val);
                  if (val < minDuration) setMinDuration(val);
                }}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <span className="text-[11px] text-slate-500">Extend moments naturally up to {maxDuration}s to complete explanations.</span>
            </div>
          </div>
        )}
      </div>

      {/* Tab 1: Local Authorized Upload */}
      {tab === 'local' && (
        <div>
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 ${
              dragActive
                ? 'border-rose-500 bg-rose-500/10 scale-[1.01]'
                : selectedFile
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-slate-700/80 hover:border-slate-600 bg-slate-900/50 hover:bg-slate-900'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
              onChange={handleFileChange}
              className="hidden"
            />

            {selectedFile ? (
              <div className="flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h4 className="text-lg font-bold text-white mb-1">{selectedFile.name}</h4>
                <p className="text-xs text-slate-400">
                  Size: {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • Click or drag another file to replace
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 text-rose-400 flex items-center justify-center mb-4 group-hover:scale-110 transition shadow-inner">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">
                  Drag and drop your video file here, or <span className="text-rose-400 underline underline-offset-4">browse files</span>
                </h4>
                <p className="text-xs text-slate-400 max-w-md">
                  Supports MP4, MOV, MKV, WebM up to 2GB. Requires suitable content for 60–90s Shorts.
                </p>
              </div>
            )}
          </div>

          {selectedFile && (
            <div className="mt-5 flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center space-x-3">
                <FileVideo className="w-5 h-5 text-rose-400" />
                <div>
                  <p className="text-sm font-semibold text-white">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">Targeting 60–90s Shorts (up to {maxDuration}s)</p>
                </div>
              </div>

              <button
                disabled={isUploading || isProcessing}
                onClick={handleUploadSubmit}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-bold text-sm shadow-lg shadow-rose-600/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{isUploading ? `Uploading (${uploadProgress}%)` : 'Start AI Analysis'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: YouTube URL Workflow */}
      {tab === 'youtube' && (
        <div>
          <form onSubmit={handleYoutubeSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                YouTube Video Link
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Youtube className="w-5 h-5 text-rose-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => {
                      setYoutubeUrl(e.target.value);
                      setUrlError('');
                      setUrlGuidance(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full pl-12 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-rose-600/20 disabled:opacity-50"
                >
                  <span>Verify & Ingest</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {urlError && (
              <div className="flex items-start space-x-3 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{urlError}</span>
              </div>
            )}

            {urlGuidance && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-3">
                <div className="flex items-start space-x-3">
                  <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="text-sm font-bold text-amber-300">Media Authorization Notice</h5>
                    <p className="text-xs text-amber-200/80 mt-1">{urlGuidance.error}</p>
                    <p className="text-xs text-amber-300 mt-2 font-medium">{urlGuidance.guidance}</p>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('local');
                      fileInputRef.current?.click();
                    }}
                    className="px-4 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-lg hover:bg-amber-400 transition"
                  >
                    Switch to Authorized Local File
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
