import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import VideoInput from './components/VideoInput';
import JobProgress from './components/JobProgress';
import ClipCard from './components/ClipCard';
import ClipEditorModal from './components/ClipEditorModal';
import TranscriptViewer from './components/TranscriptViewer';
import HistoryDrawer from './components/HistoryDrawer';

import {
  Film,
  Download,
  FileText,
  Sparkles,
  Play,
  RotateCcw,
  CheckCircle2,
  FolderArchive,
  Layers,
  ArrowRight,
  AlertTriangle,
  Info
} from 'lucide-react';

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [clips, setClips] = useState([]);
  const [activeEditingClip, setActiveEditingClip] = useState(null);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isBatchRendering, setIsBatchRendering] = useState(false);
  const [systemDeps, setSystemDeps] = useState(null);

  const eventSourceRef = useRef(null);

  // Load jobs and system health on initial mount
  useEffect(() => {
    fetchJobs();
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setSystemDeps(data.dependencies || null);
      }
    } catch (e) {
      console.warn('Could not fetch health diagnostics:', e);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
        // If no job is currently selected, select the latest one
        if (!currentJob && data.jobs.length > 0) {
          selectJob(data.jobs[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  const selectJob = async (jobId) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCurrentJob(data.job);
      setClips(data.clips || []);
    } catch (err) {
      console.error(`Failed to select job ${jobId}:`, err);
    }
  };

  // SSE subscription to current job
  useEffect(() => {
    if (!currentJob?.id) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(`/api/jobs/${currentJob.id}/events`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'initial') {
          setCurrentJob(data.job);
          setClips(data.clips || []);
        } else if (data.type === 'progress') {
          setCurrentJob((prev) => (prev ? { ...prev, ...data } : prev));
          if (data.stage === 'awaiting_approval' || data.status === 'completed' || data.stage === 'ready_for_review') {
            refreshClips(data.jobId);
          }
        } else if (data.type === 'candidates_ready') {
          refreshClips(data.jobId);
          fetchJobs();
        } else if (data.type === 'clip_progress') {
          setClips((prev) =>
            prev.map((c) =>
              c.id === data.clipId
                ? { ...c, render_status: data.status, render_progress: data.progress }
                : c
            )
          );
        } else if (data.type === 'clip_completed') {
          setClips((prev) =>
            prev.map((c) =>
              c.id === data.clipId
                ? {
                    ...c,
                    render_status: 'completed',
                    render_progress: 100,
                    output_path: data.outputPath,
                    output_size: data.size
                  }
                : c
            )
          );
        } else if (data.type === 'clip_error') {
          setClips((prev) =>
            prev.map((c) =>
              c.id === data.clipId
                ? { ...c, render_status: 'failed', render_progress: 0, error: data.error }
                : c
            )
          );
        } else if (data.type === 'completed') {
          refreshClips(data.jobId);
          fetchJobs();
        }
      } catch (err) {
        console.error('SSE message parse error:', err);
      }
    };

    sse.onerror = () => {
      // SSE error or stream closed
    };

    return () => {
      sse.close();
    };
  }, [currentJob?.id]);

  const refreshClips = async (jobId) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/clips`);
      const data = await res.json();
      if (data.clips) {
        setClips(data.clips);
      }
    } catch (e) {
      console.error('Error refreshing clips:', e);
    }
  };

  const handleJobCreated = (newJob) => {
    setJobs((prev) => [newJob, ...prev]);
    setCurrentJob(newJob);
    setClips([]);
  };

  const handleRetryJob = async (jobId) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      if (res.ok) {
        selectJob(jobId);
        fetchJobs();
      }
    } catch (e) {
      alert(`Retry failed: ${e.message}`);
    }
  };

  const handleCancelJob = async (jobId) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      fetchJobs();
      if (currentJob?.id === jobId) {
        setCurrentJob(null);
        setClips([]);
      }
    } catch (e) {
      alert(`Cancel failed: ${e.message}`);
    }
  };

  const handleDeleteJob = async (jobId) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (currentJob?.id === jobId) {
        setCurrentJob(null);
        setClips([]);
      }
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const handleRenderSingleClip = async (clipId) => {
    try {
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, render_status: 'rendering', render_progress: 10, error: null } : c
        )
      );

      const res = await fetch(`/api/clips/${clipId}/render`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start render');
      }
    } catch (err) {
      alert(`Rendering failed: ${err.message}`);
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, render_status: 'failed', error: err.message } : c
        )
      );
    }
  };

  const handleRenderAllApproved = async () => {
    if (!currentJob) return;
    setIsBatchRendering(true);

    try {
      const res = await fetch(`/api/jobs/${currentJob.id}/render-all`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Batch render failed');
      }
    } catch (err) {
      alert(`Batch render failed: ${err.message}`);
    } finally {
      setIsBatchRendering(false);
    }
  };

  const handleDownloadClip = async (clipId) => {
    try {
      const res = await fetch(`/api/clips/${clipId}/download`);
      const contentType = res.headers.get('content-type') || '';

      if (res.status === 404) {
        throw new Error('Video file is not available for this clip yet. Please click "Render Short" first.');
      }

      if (!res.ok || contentType.includes('application/json')) {
        let errorMsg = 'Video file is not available for this clip.';
        try {
          const errorData = await res.json();
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          errorMsg = `Download failed with status ${res.status}`;
        }
        throw new Error(errorMsg);
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Downloaded video file is empty.');
      }

      // Extract filename from Content-Disposition header if available
      let filename = `${clipId}.mp4`;
      const disposition = res.headers.get('content-disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          filename = match[1].replace(/['"]/g, '').trim();
        }
      }

      // Trigger actual MP4 file download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Download error for clip:', clipId, err);
      throw err;
    }
  };

  const handleExportZip = () => {
    if (!currentJob) return;
    window.location.href = `/api/jobs/${currentJob.id}/export.zip`;
  };

  const completedClipsCount = clips.filter((c) => c.render_status === 'completed').length;
  const pendingClipsCount = clips.filter((c) => c.render_status !== 'completed').length;
  const isJobProcessing =
    currentJob && (currentJob.status === 'processing' || currentJob.status === 'pending');

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Header */}
      <Header onOpenHistory={() => setIsHistoryOpen(true)} historyCount={jobs.length} />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        {/* System Dependency Status Alert (if faster-whisper is missing) */}
        {systemDeps && !systemDeps.faster_whisper?.available && (
          <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-200 flex items-start space-x-3">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-300 block">Whisper AI Dependency Notice</span>
              <p className="text-amber-200/90 leading-relaxed">
                faster-whisper is not currently active in Python ({systemDeps.python?.path || 'python'}).
                Jobs will automatically execute in DEMO mode with synthetic transcript segments for testing.
                To enable genuine speech recognition: install Python 3.10–3.12 (64-bit with x86-64-v2 instructions), run <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300">pip install faster-whisper</code>, and set <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300">PYTHON_PATH</code> in .env.
              </p>
            </div>
          </div>
        )}

        {/* Video Input Hero */}
        <VideoInput onJobCreated={handleJobCreated} isProcessing={isJobProcessing} />

        {/* Active Job Progress */}
        {currentJob && (
          <JobProgress
            job={currentJob}
            onRetry={handleRetryJob}
            onCancel={handleCancelJob}
          />
        )}

        {/* Candidates & Highlights Section */}
        {currentJob && clips.length > 0 && (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="bg-[#0f172a] p-5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Suggested Shorts</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-rose-400 font-extrabold border border-slate-700">
                      {clips.length} Candidates
                    </span>
                    {completedClipsCount > 0 ? (
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                        {completedClipsCount} Ready for Download
                      </span>
                    ) : (
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20">
                        Awaiting Render
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Moments scored across hook strength, dialogue coherence, and retention. Preview, render vertical MP4s, and download.
                  </p>
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-2.5">
                <button
                  onClick={() => setIsTranscriptOpen(true)}
                  className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span>Transcript</span>
                </button>

                {pendingClipsCount > 0 && (
                  <button
                    disabled={isBatchRendering || currentJob?.status === 'rendering'}
                    onClick={handleRenderAllApproved}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-md shadow-rose-600/20 transition cursor-pointer"
                  >
                    <Film className={`w-3.5 h-3.5 ${currentJob?.status === 'rendering' ? 'animate-spin' : ''}`} />
                    <span>{currentJob?.status === 'rendering' ? 'Rendering Shorts...' : `Render All Shorts (${pendingClipsCount})`}</span>
                  </button>
                )}

                {completedClipsCount > 0 && (
                  <button
                    onClick={handleExportZip}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition"
                  >
                    <FolderArchive className="w-3.5 h-3.5" />
                    <span>Download All ZIP ({completedClipsCount})</span>
                  </button>
                )}
              </div>
            </div>

            {/* Clips Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onEdit={(c) => setActiveEditingClip(c)}
                  onRender={handleRenderSingleClip}
                  onDownload={handleDownloadClip}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State when no jobs exist */}
        {!currentJob && jobs.length === 0 && (
          <div className="text-center py-16 border-2 border-dashed border-slate-800 rounded-3xl bg-[#0f172a]/30">
            <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h4 className="text-base font-bold text-slate-300">No Video Ingested Yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Select or drop an authorized video file above to generate high-retention 9:16 vertical YouTube Shorts automatically.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        ViralCut AI • Runs 100% locally on Windows with FFmpeg & faster-whisper • No external API fees
      </footer>

      {/* Modals & Drawers */}
      {activeEditingClip && (
        <ClipEditorModal
          clip={activeEditingClip}
          job={currentJob}
          onClose={(updatedClip) => {
            if (updatedClip) {
              setClips((prev) =>
                prev.map((c) => (c.id === updatedClip.id ? updatedClip : c))
              );
            }
            setActiveEditingClip(null);
          }}
          onDownload={handleDownloadClip}
          onRender={handleRenderSingleClip}
        />
      )}

      {isTranscriptOpen && currentJob && (
        <TranscriptViewer
          jobId={currentJob.id}
          onClose={() => setIsTranscriptOpen(false)}
        />
      )}

      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        jobs={jobs}
        currentJobId={currentJob?.id}
        onSelectJob={(id) => selectJob(id)}
        onDeleteJob={handleDeleteJob}
      />
    </div>
  );
}
